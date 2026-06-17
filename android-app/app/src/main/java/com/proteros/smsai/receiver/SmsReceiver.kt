package com.proteros.smsai.receiver

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import com.proteros.smsai.AutoShopApp
import com.proteros.smsai.util.SecurePrefs
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

class SmsReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return
        if (!SecurePrefs.isEnabled(context)) return

        val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent)
        val grouped = messages.groupBy { it.displayOriginatingAddress }

        val app = context.applicationContext as AutoShopApp

        for ((sender, parts) in grouped) {
            if (sender == null) continue
            val existing = kotlinx.coroutines.runBlocking {
                app.repository.conversationDao.getByPhone(
                    com.proteros.smsai.util.PhoneUtils.normalize(sender)
                )
            } ?: continue

            val body = parts.joinToString("") { it.displayMessageBody ?: "" }
            val pending = goAsync()
            CoroutineScope(Dispatchers.IO).launch {
                try {
                    app.repository.handleIncomingSms(sender, body)
                } finally {
                    pending.finish()
                }
            }
        }
    }
}
