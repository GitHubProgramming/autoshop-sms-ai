package com.proteros.smsai.receiver

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.proteros.smsai.service.SmsAgentService
import com.proteros.smsai.util.SecurePrefs

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED && SecurePrefs.isEnabled(context)) {
            SmsAgentService.start(context)
        }
    }
}
