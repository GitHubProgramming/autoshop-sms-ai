package com.proteros.smsai.util

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.proteros.smsai.AutoShopApp
import com.proteros.smsai.R
import com.proteros.smsai.ui.MainActivity

object AgentNotification {

    private var nextId = 1000

    fun missedCall(context: Context, phone: String) {
        show(context, "Praleistas skambutis", "Agentas rašo SMS klientui $phone")
    }

    fun incomingSms(context: Context, phone: String, preview: String) {
        val short = if (preview.length > 40) preview.take(40) + "..." else preview
        show(context, "Klientas atsakė: $phone", short)
    }

    fun bookingMade(context: Context, phone: String, service: String?, dateTime: String?) {
        show(context, "Vizitas užregistruotas!", "$phone — ${service ?: "Paslauga"} ${dateTime ?: ""}")
    }

    fun handoverToOwner(context: Context, phone: String) {
        show(context, "Reikia dėmesio", "Pokalbis su $phone perduotas savininkui")
    }

    fun calendarSyncFailed(context: Context, phone: String, service: String?) {
        show(context, "Kalendorius nesusinchronizavo", "$phone — ${service ?: "Vizitas"} neįrašytas. Patikrinkite Google paskyrą.")
    }

    fun bookingConflict(context: Context, phone: String, dateTime: String?) {
        show(context, "Laiko konfliktas!", "$phone norėjo ${dateTime ?: "?"} — laikas užimtas. Perimkite pokalbį.")
    }

    private fun show(context: Context, title: String, text: String) {
        try {
            val intent = Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            }
            val pending = PendingIntent.getActivity(context, nextId, intent, PendingIntent.FLAG_IMMUTABLE)

            val notification = NotificationCompat.Builder(context, AutoShopApp.CHANNEL_ALERTS)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle(title)
                .setContentText(text)
                .setContentIntent(pending)
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .build()

            NotificationManagerCompat.from(context).notify(nextId++, notification)
        } catch (e: Exception) {
            AppLog.e("AgentNotification", "Failed to show notification", e)
        }
    }
}
