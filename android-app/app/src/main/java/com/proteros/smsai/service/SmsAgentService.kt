package com.proteros.smsai.service

import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import com.proteros.smsai.api.GoogleSheetsClient
import com.proteros.smsai.data.AppDatabase
import com.proteros.smsai.data.AppRepository
import com.proteros.smsai.util.AppLog
import androidx.core.app.NotificationCompat
import com.proteros.smsai.AutoShopApp
import com.proteros.smsai.R
import com.proteros.smsai.ui.MainActivity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

class SmsAgentService : Service() {

    private val refreshHandler = Handler(Looper.getMainLooper())
    private val refreshCheckInterval = 5 * 60 * 1000L
    private val serviceScope = CoroutineScope(Dispatchers.IO)

    private val refreshCheckRunnable = object : Runnable {
        override fun run() {
            serviceScope.launch {
                try {
                    val sheetsClient = GoogleSheetsClient(applicationContext)
                    if (sheetsClient.checkRefreshRequested(applicationContext)) {
                        AppLog.i(TAG, "Refresh requested from Sheet, reporting status")
                        sheetsClient.reportDeviceStatus(applicationContext)
                    }
                } catch (e: Exception) {
                    AppLog.e(TAG, "Refresh check failed", e)
                }
                try {
                    val repo = AppRepository(applicationContext, AppDatabase.getInstance(applicationContext))
                    repo.checkInactiveConversations()
                } catch (e: Exception) {
                    AppLog.e(TAG, "Inactivity check failed", e)
                }
            }
            refreshHandler.postDelayed(this, refreshCheckInterval)
        }
    }

    override fun onCreate() {
        super.onCreate()
        AppLog.i(TAG, "SmsAgentService created")
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                startForeground(NOTIFICATION_ID, buildNotification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
            } else {
                startForeground(NOTIFICATION_ID, buildNotification())
            }
        } catch (e: Exception) {
            AppLog.e(TAG, "startForeground failed", e)
        }
        serviceScope.launch {
            try {
                val sheetsClient = GoogleSheetsClient(applicationContext)
                sheetsClient.reportDeviceStatus(applicationContext)
                sheetsClient.initializeSheets()
            } catch (e: Exception) { AppLog.e(TAG, "Initial status report failed", e) }
        }
        refreshHandler.postDelayed(refreshCheckRunnable, refreshCheckInterval)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        AppLog.i(TAG, "SmsAgentService started")
        return START_STICKY
    }

    override fun onDestroy() {
        refreshHandler.removeCallbacks(refreshCheckRunnable)
        super.onDestroy()
        AppLog.i(TAG, "SmsAgentService destroyed")
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun buildNotification(): Notification {
        val pendingIntent = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE
        )
        return NotificationCompat.Builder(this, AutoShopApp.CHANNEL_SERVICE)
            .setContentTitle("Proteros SMS Agentas")
            .setContentText("Laukiu praleistų skambučių...")
            .setSmallIcon(R.drawable.ic_notification)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .build()
    }

    companion object {
        private const val TAG = "SmsAgentService"
        private const val NOTIFICATION_ID = 1

        fun start(context: Context) {
            try {
                AppLog.i(TAG, "Starting SmsAgentService")
                val intent = Intent(context, SmsAgentService::class.java)
                context.startForegroundService(intent)
            } catch (e: Exception) {
                AppLog.e(TAG, "Failed to start service", e)
            }
        }

        fun stop(context: Context) {
            try {
                AppLog.i(TAG, "Stopping SmsAgentService")
                context.stopService(Intent(context, SmsAgentService::class.java))
            } catch (e: Exception) {
                AppLog.e(TAG, "Failed to stop service", e)
            }
        }
    }
}
