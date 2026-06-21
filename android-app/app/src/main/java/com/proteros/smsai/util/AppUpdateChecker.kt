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
import com.proteros.smsai.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.io.File
import java.util.concurrent.TimeUnit

object AppUpdateChecker {

    private const val TAG = "AppUpdateChecker"
    private const val GITHUB_API = "https://api.github.com/repos/GitHubProgramming/autoshop-sms-ai/releases/latest"

    data class UpdateInfo(val versionName: String, val downloadUrl: String)

    var pendingUpdate: UpdateInfo? = null
        private set

    private fun getToken(): String? {
        val pat = BuildConfig.GITHUB_PAT
        return if (pat.isNotBlank()) pat else null
    }

    private fun buildClient(): OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(120, TimeUnit.SECONDS)
        .followRedirects(true)
        .build()

    suspend fun checkForUpdate(context: Context): UpdateInfo? = withContext(Dispatchers.IO) {
        try {
            val currentVersion = context.packageManager
                .getPackageInfo(context.packageName, 0).versionName ?: return@withContext null

            val token = getToken()
            if (token == null) {
                AppLog.e(TAG, "No GitHub PAT configured")
                return@withContext null
            }

            val request = Request.Builder()
                .url(GITHUB_API)
                .header("Authorization", "Bearer $token")
                .header("Accept", "application/vnd.github+json")
                .build()

            val response = buildClient().newCall(request).execute()
            if (!response.isSuccessful) {
                AppLog.e(TAG, "GitHub API failed: ${response.code}")
                return@withContext null
            }

            val json = JSONObject(response.body?.string() ?: return@withContext null)
            val tagName = json.optString("tag_name", "").removePrefix("v")
            val assets = json.optJSONArray("assets")
            if (tagName.isBlank() || assets == null || assets.length() == 0) {
                AppLog.i(TAG, "No release assets found")
                return@withContext null
            }

            val apkAsset = (0 until assets.length())
                .map { assets.getJSONObject(it) }
                .firstOrNull { it.optString("name", "").endsWith(".apk") }

            if (apkAsset == null) {
                AppLog.i(TAG, "No APK asset in latest release")
                return@withContext null
            }

            val downloadUrl = apkAsset.optString("url", "")
            if (downloadUrl.isBlank()) return@withContext null

            if (isNewer(tagName, currentVersion)) {
                AppLog.i(TAG, "Update available: $currentVersion -> $tagName")
                return@withContext UpdateInfo(tagName, downloadUrl)
            }

            AppLog.i(TAG, "No update available (current=$currentVersion, latest=$tagName)")
            null
        } catch (e: Exception) {
            AppLog.e(TAG, "Update check failed: ${e.message}")
            null
        }
    }

    fun downloadAndInstall(context: Context, update: UpdateInfo) {
        val mainHandler = Handler(Looper.getMainLooper())

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (!context.packageManager.canRequestPackageInstalls()) {
                pendingUpdate = update
                AppLog.i(TAG, "Unknown sources not enabled, saving pending update and opening settings")
                mainHandler.post {
                    Toast.makeText(context, "Leiskite diegti programas iš šio šaltinio, tada atnaujinimas prasidės automatiškai", Toast.LENGTH_LONG).show()
                    val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES).apply {
                        data = Uri.parse("package:${context.packageName}")
                        flags = Intent.FLAG_ACTIVITY_NEW_TASK
                    }
                    context.startActivity(intent)
                }
                return
            }
        }

        pendingUpdate = null
        startDownload(context, update)
    }

    fun retryPendingIfReady(context: Context) {
        val update = pendingUpdate ?: return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !context.packageManager.canRequestPackageInstalls()) {
            AppLog.i(TAG, "Permission still not granted, keeping pending update")
            return
        }
        AppLog.i(TAG, "Permission granted, auto-retrying update to ${update.versionName}")
        pendingUpdate = null
        startDownload(context, update)
    }

    private fun startDownload(context: Context, update: UpdateInfo) {
        val fileName = "ProterosServisas-v${update.versionName}.apk"
        val apkFile = File(context.getExternalFilesDir(null), fileName)
        val mainHandler = Handler(Looper.getMainLooper())

        mainHandler.post {
            Toast.makeText(context, "Atsisiunčiama v${update.versionName}...", Toast.LENGTH_LONG).show()
        }

        Thread {
            try {
                context.getExternalFilesDir(null)?.listFiles()?.forEach {
                    if (it.name.endsWith(".apk")) it.delete()
                }

                val token = getToken()
                if (token == null) {
                    AppLog.e(TAG, "No GitHub PAT for download")
                    return@Thread
                }

                AppLog.i(TAG, "Downloading APK from GitHub Release")

                val request = Request.Builder()
                    .url(update.downloadUrl)
                    .header("Authorization", "Bearer $token")
                    .header("Accept", "application/octet-stream")
                    .build()

                val response = buildClient().newCall(request).execute()

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
                    AppLog.e(TAG, "APK too small (${apkFile.length()} bytes), likely error page")
                    apkFile.delete()
                    mainHandler.post {
                        Toast.makeText(context, "Parsisiuntimo klaida — failas per mažas", Toast.LENGTH_LONG).show()
                    }
                    return@Thread
                }

                mainHandler.post {
                    Toast.makeText(context, "Diegiama v${update.versionName}...", Toast.LENGTH_SHORT).show()
                    installApk(context, apkFile)
                }
            } catch (e: Exception) {
                AppLog.e(TAG, "Download failed: ${e.message}", e)
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
            val remoteParts = remote.replace(',', '.').split(".").map { it.toIntOrNull() ?: 0 }
            val localParts = local.replace(',', '.').split(".").map { it.toIntOrNull() ?: 0 }
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
