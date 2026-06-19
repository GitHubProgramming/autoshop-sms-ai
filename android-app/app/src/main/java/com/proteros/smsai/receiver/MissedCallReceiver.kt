package com.proteros.smsai.receiver

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.telephony.TelephonyManager
import com.proteros.smsai.AutoShopApp
import com.proteros.smsai.util.AppLog
import com.proteros.smsai.util.SecurePrefs
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

class MissedCallReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "MissedCallReceiver"
    }

    override fun onReceive(context: Context, intent: Intent) {
        AppLog.i(TAG, "onReceive: action=${intent.action}")

        if (intent.action != TelephonyManager.ACTION_PHONE_STATE_CHANGED) return
        if (!SecurePrefs.isEnabled(context)) {
            AppLog.i(TAG, "Service disabled, ignoring")
            return
        }

        val state = intent.getStringExtra(TelephonyManager.EXTRA_STATE) ?: return
        val prefs = context.getSharedPreferences("call_state", Context.MODE_PRIVATE)

        AppLog.i(TAG, "Phone state: $state")

        when (state) {
            TelephonyManager.EXTRA_STATE_RINGING -> {
                @Suppress("DEPRECATION")
                val number = intent.getStringExtra(TelephonyManager.EXTRA_INCOMING_NUMBER)
                AppLog.i(TAG, "RINGING from: $number")
                prefs.edit()
                    .putString("last_state", "RINGING")
                    .putString("incoming_number", number)
                    .putLong("ring_time", System.currentTimeMillis())
                    .apply()
            }
            TelephonyManager.EXTRA_STATE_IDLE -> {
                val lastState = prefs.getString("last_state", null)
                val number = prefs.getString("incoming_number", null)
                AppLog.i(TAG, "IDLE - lastState=$lastState, number=$number")

                prefs.edit().putString("last_state", "IDLE").apply()

                if (lastState == "RINGING" && !number.isNullOrBlank()) {
                    AppLog.i(TAG, "MISSED CALL DETECTED from $number")
                    val app = context.applicationContext as AutoShopApp
                    val pending = goAsync()
                    CoroutineScope(Dispatchers.IO).launch {
                        try {
                            app.repository.handleMissedCall(number)
                            AppLog.i(TAG, "handleMissedCall completed for $number")
                        } catch (e: Exception) {
                            AppLog.e(TAG, "handleMissedCall failed for $number", e)
                        } finally {
                            pending.finish()
                        }
                    }
                }
            }
            TelephonyManager.EXTRA_STATE_OFFHOOK -> {
                AppLog.i(TAG, "OFFHOOK - call answered")
                prefs.edit().putString("last_state", "OFFHOOK").apply()
            }
        }
    }
}
