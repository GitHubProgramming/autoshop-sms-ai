package com.proteros.smsai.api

import android.content.Context
import com.google.api.client.googleapis.extensions.android.gms.auth.GoogleAccountCredential
import com.google.api.client.http.javanet.NetHttpTransport
import com.google.api.client.json.gson.GsonFactory
import com.google.api.client.util.DateTime
import com.google.api.services.calendar.Calendar
import com.google.api.services.calendar.CalendarScopes
import com.google.api.services.calendar.model.Event
import com.google.api.services.calendar.model.EventDateTime
import com.proteros.smsai.util.SecurePrefs
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

class GoogleCalendarClient(private val context: Context) {

    private fun calendarId(): String =
        SecurePrefs.getCalendarId(context) ?: "primary"

    private fun getService(): Calendar? {
        val accountName = SecurePrefs.getGoogleAccount(context) ?: return null
        val credential = GoogleAccountCredential.usingOAuth2(
            context, listOf(CalendarScopes.CALENDAR)
        ).apply { selectedAccountName = accountName }

        return Calendar.Builder(
            NetHttpTransport(), GsonFactory.getDefaultInstance(), credential
        ).setApplicationName("Proteros SMS AI").build()
    }

    suspend fun createAppointment(
        clientPhone: String,
        service: String,
        dateTime: String,
        contactName: String? = null,
        conversationSummary: String? = null
    ): String? = withContext(Dispatchers.IO) {
        try {
            val calService = getService() ?: return@withContext null
            val sdf = SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.getDefault())
            val date = sdf.parse(dateTime) ?: return@withContext null

            val displayName = contactName ?: clientPhone.takeLast(4)
            val desc = buildString {
                append("👤 Klientas: ${contactName ?: "Nežinomas"}\n")
                append("📞 Tel: $clientPhone\n")
                append("🔧 Paslauga: $service\n")
                if (!conversationSummary.isNullOrBlank()) {
                    append("\n💬 Pokalbis:\n$conversationSummary\n")
                }
                append("\n📋 Sukurta: SMS AI agentas")
            }

            val event = Event().apply {
                summary = "$service • $displayName"
                description = desc
                start = EventDateTime().apply {
                    this.dateTime = DateTime(date, TimeZone.getTimeZone("Europe/Vilnius"))
                    this.timeZone = "Europe/Vilnius"
                }
                end = EventDateTime().apply {
                    val endTime = java.util.Date(date.time + 3600000)
                    this.dateTime = DateTime(endTime, TimeZone.getTimeZone("Europe/Vilnius"))
                    this.timeZone = "Europe/Vilnius"
                }
            }

            val created = calService.events().insert(calendarId(), event).execute()
            created.id
        } catch (e: Exception) {
            null
        }
    }

    data class TodayAppointment(
        val time: String,
        val clientPhone: String,
        val service: String,
        val contactName: String?,
        val eventId: String
    )

    data class CalendarResult(
        val appointments: List<TodayAppointment>,
        val error: String? = null
    )

    suspend fun getTodayAppointmentsWithStatus(): CalendarResult = withContext(Dispatchers.IO) {
        try {
            val calService = getService() ?: return@withContext CalendarResult(emptyList(), "Google paskyra neprisijungta")
            val now = java.util.Calendar.getInstance(TimeZone.getTimeZone("Europe/Vilnius"))
            now.set(java.util.Calendar.HOUR_OF_DAY, 0)
            now.set(java.util.Calendar.MINUTE, 0)
            val startOfDay = DateTime(now.time)
            now.add(java.util.Calendar.DAY_OF_MONTH, 1)
            val endOfDay = DateTime(now.time)

            val events = calService.events().list(calendarId())
                .setTimeMin(startOfDay)
                .setTimeMax(endOfDay)
                .setOrderBy("startTime")
                .setSingleEvents(true)
                .execute()

            val appointments = events.items?.mapNotNull { event ->
                val desc = event.description ?: return@mapNotNull null
                val phoneMatch = Regex("Tel: (\\+?\\d+)").find(desc)
                val serviceMatch = Regex("Paslauga: (.+)").find(desc)
                val nameMatch = Regex("Klientas: (.+)").find(desc)
                val time = event.start?.dateTime?.let {
                    SimpleDateFormat("HH:mm", Locale.getDefault()).format(java.util.Date(it.value))
                } ?: "--:--"

                val name = nameMatch?.groupValues?.get(1)?.takeIf { it != "Nežinomas" }
                TodayAppointment(
                    time = time,
                    clientPhone = phoneMatch?.groupValues?.get(1) ?: "Nežinomas",
                    service = serviceMatch?.groupValues?.get(1) ?: event.summary ?: "Vizitas",
                    contactName = name,
                    eventId = event.id
                )
            } ?: emptyList()
            CalendarResult(appointments)
        } catch (e: Exception) {
            CalendarResult(emptyList(), e.message ?: "Kalendoriaus klaida")
        }
    }

    suspend fun getTodayAppointments(): List<TodayAppointment> =
        getTodayAppointmentsWithStatus().appointments

    suspend fun isSlotAvailable(dateTime: String): Boolean = withContext(Dispatchers.IO) {
        try {
            val calService = getService() ?: return@withContext true
            val sdf = SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.getDefault())
            val date = sdf.parse(dateTime) ?: return@withContext true
            val startTime = DateTime(date, TimeZone.getTimeZone("Europe/Vilnius"))
            val endTime = DateTime(java.util.Date(date.time + 3600000), TimeZone.getTimeZone("Europe/Vilnius"))

            val events = calService.events().list(calendarId())
                .setTimeMin(startTime)
                .setTimeMax(endTime)
                .setSingleEvents(true)
                .execute()

            events.items.isNullOrEmpty()
        } catch (e: Exception) {
            true
        }
    }
}
