package com.proteros.smsai.util

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.telephony.SmsManager
import android.telephony.SubscriptionManager
import android.app.Activity
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeout
import kotlin.coroutines.resume

class SmsSender(private val context: Context) {

    private fun getSmsManager(): SmsManager {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val subId = SubscriptionManager.getDefaultSmsSubscriptionId()
            if (subId != SubscriptionManager.INVALID_SUBSCRIPTION_ID) {
                return context.getSystemService(SmsManager::class.java)
                    .createForSubscriptionId(subId)
            }
        }
        return context.getSystemService(SmsManager::class.java)
    }

    suspend fun send(phone: String, text: String): Result<Unit> {
        return try {
            withTimeout(30_000) {
                suspendCancellableCoroutine { cont ->
                    val action = "SMS_SENT_${System.currentTimeMillis()}"
                    val sentIntent = PendingIntent.getBroadcast(
                        context, 0, Intent(action),
                        PendingIntent.FLAG_ONE_SHOT or PendingIntent.FLAG_IMMUTABLE
                    )

                    val receiver = object : BroadcastReceiver() {
                        override fun onReceive(ctx: Context, intent: Intent) {
                            context.unregisterReceiver(this)
                            when (resultCode) {
                                Activity.RESULT_OK -> cont.resume(Result.success(Unit))
                                SmsManager.RESULT_ERROR_NO_SERVICE -> cont.resume(Result.failure(Exception("Nėra tinklo ryšio")))
                                SmsManager.RESULT_ERROR_RADIO_OFF -> cont.resume(Result.failure(Exception("Radijo modulis išjungtas")))
                                SmsManager.RESULT_ERROR_NULL_PDU -> cont.resume(Result.failure(Exception("SMS formato klaida")))
                                else -> cont.resume(Result.failure(Exception("SMS klaida: $resultCode")))
                            }
                        }
                    }

                    val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU)
                        Context.RECEIVER_NOT_EXPORTED else 0
                    context.registerReceiver(receiver, IntentFilter(action), flags)

                    cont.invokeOnCancellation {
                        try { context.unregisterReceiver(receiver) } catch (_: Exception) {}
                    }

                    val mgr = getSmsManager()
                    val parts = mgr.divideMessage(text)
                    if (parts.size == 1) {
                        mgr.sendTextMessage(phone, null, text, sentIntent, null)
                    } else {
                        mgr.sendMultipartTextMessage(phone, null, parts,
                            arrayListOf(sentIntent).apply {
                                repeat(parts.size - 1) { add(null) }
                            }, null)
                    }
                }
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }
}
