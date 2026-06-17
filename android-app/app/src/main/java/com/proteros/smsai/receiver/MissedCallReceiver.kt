package com.proteros.smsai.receiver

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.telephony.TelephonyManager
import com.proteros.smsai.AutoShopApp
import com.proteros.smsai.util.SecurePrefs
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

class MissedCallReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != TelephonyManager.ACTION_PHONE_STATE_CHANGED) return
        if (!SecurePrefs.isEnabled(context)) return

        val state = intent.getStringExtra(TelephonyManager.EXTRA_STATE) ?: return
        val prefs = context.getSharedPreferences("call_state", Context.MODE_PRIVATE)

        when (state) {
            TelephonyManager.EXTRA_STATE_RINGING -> {
                val number = intent.getStringExtra(TelephonyManager.EXTRA_INCOMING_NUMBER)
                prefs.edit()
                    .putString("last_state", "RINGING")
                    .putString("incoming_number", number)
                    .putLong("ring_time", System.currentTimeMillis())
                    .apply()
            }
            TelephonyManager.EXTRA_STATE_IDLE -> {
                val lastState = prefs.getString("last_state", null)
                val number = prefs.getString("incoming_number", null)

                prefs.edit().putString("last_state", "IDLE").apply()

                if (lastState == "RINGING" && !number.isNullOrBlank()) {
                    val app = context.applicationContext as AutoShopApp
                    val pending = goAsync()
                    CoroutineScope(Dispatchers.IO).launch {
                        try {
                            app.repository.handleMissedCall(number)
                        } finally {
                            pending.finish()
                        }
                    }
                }
            }
            TelephonyManager.EXTRA_STATE_OFFHOOK -> {
                prefs.edit().putString("last_state", "OFFHOOK").apply()
            }
        }
    }
}
