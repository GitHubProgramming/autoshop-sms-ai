package com.proteros.smsai.receiver

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import android.util.Log
import com.proteros.smsai.AutoShopApp
import com.proteros.smsai.util.PhoneUtils
import com.proteros.smsai.util.SecurePrefs
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

class SmsReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return
        if (!SecurePrefs.isEnabled(context)) return

        val messages = try {
            Telephony.Sms.Intents.getMessagesFromIntent(intent)
        } catch (e: Exception) {
            Log.e("SmsReceiver", "Failed to parse SMS", e)
            return
        }
        val grouped = messages.groupBy { it.displayOriginatingAddress }
        Log.i("SmsReceiver", "Received SMS from ${grouped.keys}")

        val app = context.applicationContext as AutoShopApp

        for ((sender, parts) in grouped) {
            if (sender == null) continue
            val body = parts.joinToString("") { it.displayMessageBody ?: "" }
            Log.i("SmsReceiver", "Processing SMS from $sender: $body")

            val pending = goAsync()
            CoroutineScope(Dispatchers.IO).launch {
                try {
                    app.repository.handleIncomingSms(sender, body)
                } catch (e: Exception) {
                    Log.e("SmsReceiver", "Error handling SMS from $sender", e)
                } finally {
                    pending.finish()
                }
            }
        }
    }
}
