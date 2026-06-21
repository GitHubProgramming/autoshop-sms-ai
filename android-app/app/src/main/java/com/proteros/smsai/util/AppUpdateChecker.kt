package com.proteros.smsai.util

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.widget.Toast
import androidx.core.content.FileProvider
import com.google.api.services.sheets.v4.SheetsScopes
import com.google.api.client.googleapis.extensions.android.gms.auth.GoogleAccountCredential
import com.google.api.client.http.javanet.NetHttpTransport
import com.google.api.client.json.gson.GsonFactory
import com.google.api.services.sheets.v4.Sheets
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.util.concurrent.TimeUnit

object AppUpdateChecker {

    private const val TAG = "AppUpdateChecker"
    private const val STATUS_SHEET = "Statusas"

    data class UpdateInfo(val versionName: String, val downloadUrl: String)

    suspend fun checkForUpdate(context: Context): UpdateInfo? = withContext(Dispatchers.IO) {
        try {
            val currentVersion = context.packageManager
                .getPackageInfo(context.packageName, 0).versionName ?: return@withContext null

            val accountName = SecurePrefs.getGoogleAccount(context) ?: return@withContext null
            val sheetId = SecurePrefs.getSheetId(context) ?: return@withContext null

            val credential = GoogleAccountCredential.usingOAuth2(
                context, listOf(SheetsScopes.SPREADSHEETS_READONLY)
            ).apply { selectedAccountName = accountName }

            val service = Sheets.Builder(
                NetHttpTransport(), GsonFactory.getDefaultInstance(), credential
            ).setApplicationName("Proteros SMS AI").build()

            val result = service.spreadsheets().values()
                .get(sheetId, "$STATUS_SHEET!A2:B2")
                .execute()

            val row = result.getValues()?.firstOrNull() ?: return@withContext null
            if (row.size < 2) return@withContext null

            val remoteVersion = row[0].toString().trim()
            val downloadUrl = row[1].toString().trim()

            if (remoteVersion.isBlank() || downloadUrl.isBlank()) return@withContext null

            if (isNewer(remoteVersion, currentVersion)) {
                AppLog.i(TAG, "Update available: $currentVersion -> $remoteVersion")
                return@withContext UpdateInfo(remoteVersion, downloadUrl)
            }

            AppLog.i(TAG, "No update available (current=$currentVersion, latest=$remoteVersion)")
            null
        } catch (e: Exception) {
            AppLog.e(TAG, "Update check failed: ${e.message}")
            null
        }
    }

    fun downloadAndInstall(context: Context, update: UpdateInfo) {
        val fileName = "ProterosServisas-v${update.versionName}.apk"
        val apkFile = File(context.getExternalFilesDir(null), fileName)
        val mainHandler = Handler(Looper.getMainLooper())

        // Check "install unknown apps" permission first
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (!context.packageManager.canRequestPackageInstalls()) {
                AppLog.i(TAG, "Unknown sources not enabled, opening settings")
                mainHandler.post {
                    Toast.makeText(context, "Leiskite diegti programas iš šio šaltinio", Toast.LENGTH_LONG).show()
                    val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES).apply {
                        data = Uri.parse("package:${context.packageName}")
                        flags = Intent.FLAG_ACTIVITY_NEW_TASK
                    }
                    context.startActivity(intent)
                }
                return
            }
        }

        val client = OkHttpClient.Builder()
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(120, TimeUnit.SECONDS)
            .followRedirects(true)
            .build()

        Thread {
            try {
                // Delete old APK files
                context.getExternalFilesDir(null)?.listFiles()?.forEach {
                    if (it.name.endsWith(".apk")) it.delete()
                }

                var url = update.downloadUrl
                if (url.contains("drive.google.com")) {
                    url = url + (if (url.contains("?")) "&" else "?") + "confirm=t"
                }

                AppLog.i(TAG, "Downloading APK from: $url")
                val request = Request.Builder().url(url).build()
                val response = client.newCall(request).execute()

                if (!response.isSuccessful) {
                    AppLog.e(TAG, "Download failed: ${response.code}")
                    mainHandler.post {
                        Toast.makeText(context, "Parsisiuntimas nepavyko (${response.code})", Toast.LENGTH_LONG).show()
                    }
                    return@Thread
                }

                response.body?.byteStream()?.use { input ->
                    apkFile.outputStream().use { output ->
                        input.copyTo(output)
                    }
                }

                AppLog.i(TAG, "APK downloaded: ${apkFile.length()} bytes")

                if (apkFile.length() < 100_000) {
                    AppLog.e(TAG, "APK too small (${apkFile.length()} bytes), likely HTML error page")
                    apkFile.delete()
                    mainHandler.post {
                        Toast.makeText(context, "Parsisiuntimo klaida — failas per mažas", Toast.LENGTH_LONG).show()
                    }
                    return@Thread
                }

                mainHandler.post {
                    installApk(context, apkFile)
                }
            } catch (e: Exception) {
                AppLog.e(TAG, "Download failed: ${e.message}")
                mainHandler.post {
                    Toast.makeText(context, "Klaida: ${e.message}", Toast.LENGTH_LONG).show()
                }
            }
        }.start()
    }

    private fun installApk(context: Context, apkFile: File) {
        try {
            val uri = FileProvider.getUriForFile(
                context, "${context.packageName}.fileprovider", apkFile
            )
            AppLog.i(TAG, "Installing APK: ${apkFile.name}, size=${apkFile.length()}, uri=$uri")
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION
            }
            context.startActivity(intent)
            AppLog.i(TAG, "Install intent launched for ${apkFile.name}")
        } catch (e: Exception) {
            AppLog.e(TAG, "Install failed: ${e.message}", e)
            Toast.makeText(context, "Diegimo klaida: ${e.message}", Toast.LENGTH_LONG).show()
        }
    }

    private fun isNewer(remote: String, local: String): Boolean {
        try {
            val remoteParts = remote.split(".").map { it.toIntOrNull() ?: 0 }
            val localParts = local.split(".").map { it.toIntOrNull() ?: 0 }
            for (i in 0 until maxOf(remoteParts.size, localParts.size)) {
                val r = remoteParts.getOrElse(i) { 0 }
                val l = localParts.getOrElse(i) { 0 }
                if (r > l) return true
                if (r < l) return false
            }
        } catch (_: Exception) {}
        return false
    }
}
