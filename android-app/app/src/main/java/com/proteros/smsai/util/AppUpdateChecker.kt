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
import com.google.api.client.googleapis.extensions.android.gms.auth.GoogleAccountCredential
import com.google.api.client.http.javanet.NetHttpTransport
import com.google.api.client.json.gson.GsonFactory
import com.google.api.services.drive.Drive
import com.google.api.services.drive.DriveScopes
import com.google.api.services.sheets.v4.Sheets
import com.google.api.services.sheets.v4.SheetsScopes
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

object AppUpdateChecker {

    private const val TAG = "AppUpdateChecker"
    private const val STATUS_SHEET = "Statusas"

    data class UpdateInfo(val versionName: String, val downloadUrl: String)

    private fun extractFileId(url: String): String? {
        return Regex("/d/([a-zA-Z0-9_-]+)").find(url)?.groupValues?.get(1)
            ?: Regex("[?&]id=([a-zA-Z0-9_-]+)").find(url)?.groupValues?.get(1)
    }

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

        Thread {
            try {
                context.getExternalFilesDir(null)?.listFiles()?.forEach {
                    if (it.name.endsWith(".apk")) it.delete()
                }

                val fileId = extractFileId(update.downloadUrl)
                if (fileId == null) {
                    AppLog.e(TAG, "Cannot extract file ID from: ${update.downloadUrl}")
                    mainHandler.post {
                        Toast.makeText(context, "Neteisingas atsisiuntimo adresas", Toast.LENGTH_LONG).show()
                    }
                    return@Thread
                }

                val accountName = SecurePrefs.getGoogleAccount(context)
                if (accountName == null) {
                    AppLog.e(TAG, "No Google account for Drive download")
                    mainHandler.post {
                        Toast.makeText(context, "Neprisijungta Google paskyra", Toast.LENGTH_LONG).show()
                    }
                    return@Thread
                }

                AppLog.i(TAG, "Downloading APK via Drive API, fileId=$fileId")

                val credential = GoogleAccountCredential.usingOAuth2(
                    context, listOf(DriveScopes.DRIVE_READONLY)
                ).apply { selectedAccountName = accountName }

                val driveService = Drive.Builder(
                    NetHttpTransport(), GsonFactory.getDefaultInstance(), credential
                ).setApplicationName("Proteros SMS AI").build()

                driveService.files().get(fileId)
                    .executeMediaAndDownloadTo(apkFile.outputStream())

                AppLog.i(TAG, "APK downloaded: ${apkFile.length()} bytes")

                if (apkFile.length() < 100_000) {
                    AppLog.e(TAG, "APK too small (${apkFile.length()} bytes)")
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
                    Toast.makeText(context, "Atsisiuntimo klaida: ${e.message}", Toast.LENGTH_LONG).show()
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
