package com.proteros.smsai.receiver

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.proteros.smsai.service.SmsAgentService
import com.proteros.smsai.util.AppLog
import com.proteros.smsai.util.SecurePrefs

class ServiceRestartReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (!SecurePrefs.isEnabled(context)) return

        val isWatchdog = intent.getBooleanExtra("watchdog", false)
        if (isWatchdog) {
            AppLog.i(TAG, "Watchdog check — ensuring service is running")
        } else {
            AppLog.w(TAG, "Restart triggered — starting service")
        }

        val startIntent = Intent(context, SmsAgentService::class.java).apply {
            putExtra(SmsAgentService.EXTRA_RESTARTED, !isWatchdog)
        }
        context.startForegroundService(startIntent)
    }

    companion object {
        private const val TAG = "ServiceRestartReceiver"
    }
}
