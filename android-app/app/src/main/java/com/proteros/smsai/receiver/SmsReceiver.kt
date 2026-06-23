package com.proteros.smsai.receiver

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import com.proteros.smsai.AutoShopApp
import com.proteros.smsai.util.AppLog
import com.proteros.smsai.util.PhoneUtils
import com.proteros.smsai.util.maskPhone
import com.proteros.smsai.util.SecurePrefs
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

class SmsReceiver : BroadcastReceiver() {

    companion object {
        private val recentSms = java.util.concurrent.ConcurrentHashMap<String, Long>()
        private const val DEDUP_WINDOW_MS = 15_000L

        private fun isDuplicate(key: String): Boolean {
            val now = System.currentTimeMillis()
            recentSms.entries.removeIf { now - it.value > DEDUP_WINDOW_MS }
            val lastTime = recentSms.putIfAbsent(key, now)
            return lastTime != null && now - lastTime < DEDUP_WINDOW_MS
        }
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return
        if (!SecurePrefs.isEnabled(context)) return

        val messages = try {
            Telephony.Sms.Intents.getMessagesFromIntent(intent)
        } catch (e: Exception) {
            AppLog.e("SmsReceiver", "Failed to parse SMS", e)
            return
        }
        val grouped = messages.groupBy { it.displayOriginatingAddress }
        AppLog.i("SmsReceiver", "Received SMS from ${grouped.keys.map { it?.let { maskPhone(it) } }}")

        val app = context.applicationContext as AutoShopApp

        for ((sender, parts) in grouped) {
            if (sender == null) continue
            val body = parts.joinToString("") { it.displayMessageBody ?: "" }

            val normalized = PhoneUtils.normalize(sender)

            if (isDuplicate("$normalized|$body")) {
                AppLog.i("SmsReceiver", "Duplicate SMS from ${maskPhone(normalized)}, skipping")
                continue
            }

            AppLog.i("SmsReceiver", "Processing SMS from ${maskPhone(normalized)} (${body.length} chars)")

            val pending = goAsync()
            CoroutineScope(Dispatchers.IO).launch {
                try {
                    app.repository.handleIncomingSms(normalized, body)
                } catch (e: Exception) {
                    AppLog.e("SmsReceiver", "Error handling SMS from ${maskPhone(sender)}", e)
                } finally {
                    pending.finish()
                }
            }
        }
    }
}
