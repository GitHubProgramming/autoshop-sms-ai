package com.proteros.smsai.service

import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.IBinder
import android.telephony.TelephonyManager
import android.util.Log
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
        Log.i(TAG, "SmsAgentService created")
        startForeground(NOTIFICATION_ID, buildNotification())
        registerDynamicReceivers()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.i(TAG, "SmsAgentService started")
        return START_STICKY
    }

    override fun onDestroy() {
        super.onDestroy()
        Log.i(TAG, "SmsAgentService destroyed")
        unregisterDynamicReceivers()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun registerDynamicReceivers() {
        try {
            callReceiver = MissedCallReceiver()
            registerReceiver(
                callReceiver,
                IntentFilter(TelephonyManager.ACTION_PHONE_STATE_CHANGED)
            )
            Log.i(TAG, "Dynamic MissedCallReceiver registered")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to register MissedCallReceiver", e)
        }

        try {
            smsReceiver = SmsReceiver()
            registerReceiver(
                smsReceiver,
                IntentFilter("android.provider.Telephony.SMS_RECEIVED")
            )
            Log.i(TAG, "Dynamic SmsReceiver registered")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to register SmsReceiver", e)
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
            Log.i(TAG, "Starting SmsAgentService")
            val intent = Intent(context, SmsAgentService::class.java)
            context.startForegroundService(intent)
        }

        fun stop(context: Context) {
            Log.i(TAG, "Stopping SmsAgentService")
            context.stopService(Intent(context, SmsAgentService::class.java))
        }
    }
}
