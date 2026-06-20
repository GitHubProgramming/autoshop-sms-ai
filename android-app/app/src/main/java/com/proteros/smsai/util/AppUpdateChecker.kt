package com.proteros.smsai.util

import android.app.DownloadManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
import android.os.Build
import android.os.Environment
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject

object AppUpdateChecker {

    private const val TAG = "AppUpdateChecker"
    private const val RELEASES_URL = "https://api.github.com/repos/GitHubProgramming/autoshop-sms-ai/releases/latest"

    data class UpdateInfo(val versionName: String, val downloadUrl: String)

    suspend fun checkForUpdate(context: Context): UpdateInfo? = withContext(Dispatchers.IO) {
        try {
            val currentVersion = context.packageManager
                .getPackageInfo(context.packageName, 0).versionName ?: return@withContext null

            val client = OkHttpClient()
            val request = Request.Builder()
                .url(RELEASES_URL)
                .header("Accept", "application/vnd.github+json")
                .build()

            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    AppLog.e(TAG, "GitHub API error: ${response.code}")
                    return@withContext null
                }

                val json = JSONObject(response.body?.string() ?: return@withContext null)
                val tagName = json.optString("tag_name", "").removePrefix("v")

                if (tagName.isBlank()) return@withContext null

                if (isNewer(tagName, currentVersion)) {
                    val assets = json.optJSONArray("assets")
                    if (assets != null && assets.length() > 0) {
                        val apkAsset = (0 until assets.length())
                            .map { assets.getJSONObject(it) }
                            .firstOrNull { it.getString("name").endsWith(".apk") }

                        if (apkAsset != null) {
                            val downloadUrl = apkAsset.getString("browser_download_url")
                            AppLog.i(TAG, "Update available: $currentVersion -> $tagName")
                            return@withContext UpdateInfo(tagName, downloadUrl)
                        }
                    }
                }

                AppLog.i(TAG, "No update available (current=$currentVersion, latest=$tagName)")
                null
            }
        } catch (e: Exception) {
            AppLog.e(TAG, "Update check failed: ${e.message}")
            null
        }
    }

    fun downloadAndInstall(context: Context, update: UpdateInfo) {
        val fileName = "ProterosServisas-v${update.versionName}.apk"

        val downloadManager = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
        val request = DownloadManager.Request(Uri.parse(update.downloadUrl))
            .setTitle("Proteros Servisas v${update.versionName}")
            .setDescription("Atnaujinimas parsisiunčiamas...")
            .setDestinationInExternalFilesDir(context, Environment.DIRECTORY_DOWNLOADS, fileName)
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)

        val downloadId = downloadManager.enqueue(request)
        AppLog.i(TAG, "Download started: $downloadId")

        val receiver = object : BroadcastReceiver() {
            override fun onReceive(ctx: Context, intent: Intent) {
                val id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1)
                if (id == downloadId) {
                    ctx.unregisterReceiver(this)
                    installApk(ctx, downloadId)
                }
            }
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            context.registerReceiver(
                receiver,
                IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE),
                Context.RECEIVER_NOT_EXPORTED
            )
        } else {
            context.registerReceiver(
                receiver,
                IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE)
            )
        }
    }

    private fun installApk(context: Context, downloadId: Long) {
        try {
            val downloadManager = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
            val uri = downloadManager.getUriForDownloadedFile(downloadId)
            if (uri == null) {
                AppLog.e(TAG, "Download URI is null")
                return
            }

            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION
            }
            context.startActivity(intent)
            AppLog.i(TAG, "Install intent launched")
        } catch (e: Exception) {
            AppLog.e(TAG, "Install failed: ${e.message}")
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
