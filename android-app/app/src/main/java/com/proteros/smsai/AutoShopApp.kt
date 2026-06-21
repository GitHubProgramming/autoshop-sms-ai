package com.proteros.smsai

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build
import com.proteros.smsai.data.AppDatabase
import com.proteros.smsai.data.AppRepository
import com.proteros.smsai.util.AppLog

class AutoShopApp : Application() {

    val database by lazy { AppDatabase.getInstance(this) }
    val repository by lazy { AppRepository(this, database) }

    override fun onCreate() {
        super.onCreate()
        AppLog.init(this)
        createNotificationChannels()
    }

    private fun createNotificationChannels() {
        val serviceChannel = NotificationChannel(
            CHANNEL_SERVICE, "Servisas aktyvus",
            NotificationManager.IMPORTANCE_LOW
        ).apply { description = "Rodo kad SMS agentas veikia fone" }

        val alertChannel = NotificationChannel(
            CHANNEL_ALERTS, "Pranešimai",
            NotificationManager.IMPORTANCE_HIGH
        ).apply { description = "Praleisti skambučiai ir klientų žinutės" }

        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(serviceChannel)
        nm.createNotificationChannel(alertChannel)
    }

    companion object {
        const val CHANNEL_SERVICE = "sms_agent_service"
        const val CHANNEL_ALERTS = "sms_agent_alerts"
    }
}
