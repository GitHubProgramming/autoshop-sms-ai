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

    fun bookingMade(context: Context, phone: String, service: String?, dateTime: String?, calendarOk: Boolean = true) {
        val calendarStatus = if (calendarOk) "✓ Kalendorius" else "⚠ Kalendorius nesync"
        show(context, "Vizitas užregistruotas!", "$phone — ${service ?: "Paslauga"} ${dateTime ?: ""}\n$calendarStatus")
    }

    fun handoverToOwner(context: Context, phone: String) {
        show(context, "Reikia dėmesio", "Pokalbis su $phone perduotas savininkui")
    }

    fun inactivityAlert(context: Context, phone: String) {
        show(context, "Klientas neatsako", "Pokalbis su $phone — jau 30 min. be atsakymo. Paskambink klientui.")
    }

    fun bookingConflict(context: Context, phone: String, dateTime: String?) {
        show(context, "Laiko konfliktas!", "$phone norėjo ${dateTime ?: "?"} — laikas užimtas. Perimkite pokalbį.")
    }

    fun serviceRestarted(context: Context) {
        show(context, "Servisas perkrautas", "SMS agentas buvo sustabdytas sistemos ir automatiškai paleistas iš naujo.")
    }

    fun batteryWarning(context: Context) {
        show(context, "Baterijos optimizavimas įjungtas", "SMS agentas gali būti sustabdytas. Išjunkite baterijos optimizavimą šiai programai.")
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
                .setStyle(NotificationCompat.BigTextStyle().bigText(text))
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
