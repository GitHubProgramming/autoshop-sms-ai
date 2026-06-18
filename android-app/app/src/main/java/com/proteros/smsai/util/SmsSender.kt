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
import android.util.Log
import android.Manifest
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat

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

    fun sendFireAndForget(phone: String, text: String): Result<Unit> {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.SEND_SMS) != PackageManager.PERMISSION_GRANTED) {
            Log.e("SmsSender", "SEND_SMS permission not granted")
            return Result.failure(SecurityException("SEND_SMS permission not granted"))
        }
        return try {
            val action = "SMS_SENT_${System.currentTimeMillis()}"
            val sentIntent = PendingIntent.getBroadcast(
                context, 0, Intent(action),
                PendingIntent.FLAG_ONE_SHOT or PendingIntent.FLAG_IMMUTABLE
            )

            val receiver = object : BroadcastReceiver() {
                override fun onReceive(ctx: Context, intent: Intent) {
                    try { context.unregisterReceiver(this) } catch (_: Exception) {}
                    when (resultCode) {
                        Activity.RESULT_OK -> Log.i("SmsSender", "SMS sent OK to $phone")
                        else -> Log.e("SmsSender", "SMS send failed to $phone, code=$resultCode")
                    }
                }
            }

            val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU)
                Context.RECEIVER_NOT_EXPORTED else 0
            context.registerReceiver(receiver, IntentFilter(action), flags)

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

            Log.i("SmsSender", "SMS dispatched to $phone (${text.length} chars, ${parts.size} parts)")
            Result.success(Unit)
        } catch (e: Exception) {
            Log.e("SmsSender", "SMS exception for $phone", e)
            Result.failure(e)
        }
    }

    fun sendWithRetry(phone: String, text: String): Result<Unit> {
        val first = sendFireAndForget(phone, text)
        if (first.isSuccess) return first
        Log.i("SmsSender", "Retrying SMS to $phone in 3s...")
        Thread.sleep(3000)
        return sendFireAndForget(phone, text)
    }
}
