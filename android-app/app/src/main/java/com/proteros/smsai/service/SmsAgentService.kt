package com.proteros.smsai.service

import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.telephony.TelephonyManager
import com.proteros.smsai.util.AppLog
import androidx.core.app.NotificationCompat
import com.proteros.smsai.AutoShopApp
import com.proteros.smsai.R
import com.proteros.smsai.receiver.MissedCallReceiver
import com.proteros.smsai.receiver.SmsReceiver
import com.proteros.smsai.ui.MainActivity

class SmsAgentService : Service() {

    private var callReceiver: MissedCallReceiver? = null
    private var smsReceiver: SmsReceiver? = null

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
        registerDynamicReceivers()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        AppLog.i(TAG, "SmsAgentService started")
        return START_STICKY
    }

    override fun onDestroy() {
        super.onDestroy()
        AppLog.i(TAG, "SmsAgentService destroyed")
        unregisterDynamicReceivers()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun registerDynamicReceivers() {
        try {
            callReceiver = MissedCallReceiver()
            val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU)
                Context.RECEIVER_EXPORTED else 0
            registerReceiver(
                callReceiver,
                IntentFilter(TelephonyManager.ACTION_PHONE_STATE_CHANGED),
                flags
            )
            AppLog.i(TAG, "Dynamic MissedCallReceiver registered")
        } catch (e: Exception) {
            AppLog.e(TAG, "Failed to register MissedCallReceiver", e)
        }

        try {
            smsReceiver = SmsReceiver()
            val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU)
                Context.RECEIVER_EXPORTED else 0
            registerReceiver(
                smsReceiver,
                IntentFilter("android.provider.Telephony.SMS_RECEIVED"),
                flags
            )
            AppLog.i(TAG, "Dynamic SmsReceiver registered")
        } catch (e: Exception) {
            AppLog.e(TAG, "Failed to register SmsReceiver", e)
        }
    }

    private fun unregisterDynamicReceivers() {
        try { callReceiver?.let { unregisterReceiver(it) } } catch (_: Exception) {}
        try { smsReceiver?.let { unregisterReceiver(it) } } catch (_: Exception) {}
    }

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
