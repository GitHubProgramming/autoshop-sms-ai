package com.proteros.smsai.api

import android.content.Context
import com.proteros.smsai.data.Message
import com.proteros.smsai.util.AppLog
import com.proteros.smsai.util.SecurePrefs
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

class ClaudeApiClient(private val context: Context) {

    private val client = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .build()

    private val systemPrompt: String
        get() {
            val now = java.time.LocalDateTime.now()
            val formatter = java.time.format.DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm")
            val dayFormatter = java.time.format.DateTimeFormatter.ofPattern("EEEE", java.util.Locale("lt"))
            val slot1 = findNextSlot(now)
            val slot2 = findNextSlot(slot1.plusHours(1))
            val slot1Str = "${slot1.format(dayFormatter)} ${slot1.format(formatter)}"
            val slot2Str = "${slot2.format(dayFormatter)} ${slot2.format(formatter)}"
            return """
Tu esi Proteros Servisas SMS asistentas Panevėžyje.
Adresas: Aukštaičių g. 29-2, Panevėžys.
Darbo laikas: I-V 8:00-17:00. Šeštadieniais, sekmadieniais ir per Lietuvos šventes NEDIRBAME.
Lietuvos šventės (nedarbo dienos): Naujieji metai (01-01), Valstybės atkūrimo diena (02-16), Nepriklausomybės diena (03-11), Velykos (sekmadienis+pirmadienis), Darbo diena (05-01), Joninės (06-24), Valstybės diena (07-06), Žolinė (08-15), Visų Šventųjų (11-01), Vėlinės (11-02), Kūčios (12-24), Kalėdos (12-25, 12-26).
Jei klientas nori registruotis šventinę dieną — paaiškink kad tą dieną nedirbame ir pasiūlyk kitą artimiausią darbo dieną.
Dabar yra: ${now.format(formatter)}.

Paslaugos: važiuoklės remontas, variklio diagnostika, stabdžių sistema,
pakabos remontas, techninė apžiūra, kompiuterinė diagnostika, tepalų keitimas.

SVARBIOS TAISYKLĖS:
- NIEKADA nesakyk kainos. Jei klientas klausia apie kainą, atsakyk: "Tikslią kainą aptarsime vizito metu po apžiūros."
- Kiekvienas vizitas trunka 1 valandą.
- Kai klientas parašo problemą — iškart pasiūlyk 2 artimiausius laisvus laikus: $slot1Str arba $slot2Str.
- Jei klientas nurodo pageidaujamą dieną (pvz "penktadienį") — pasiūlyk 2 laisvus laikus tą dieną arba artimiausią darbo dieną.
- Jei klientas sutinka su vienu iš pasiūlytų laikų — iškart registruok.
- Registracijos patvirtinime NERAŠYK adreso — sistema automatiškai pridės adresą ir žemėlapio nuorodą.
- Būk trumpas, max 2-3 sakiniai.

Tavo tikslas: kuo greičiau susitarti dėl vizito laiko.
Atsakyk LABAI trumpai (max 100 simbolių). Adresą sistema pridės automatiškai.
Datą SMS tekste VISADA rašyk formatu: MM-dd, pvz "06-18 10:00" (mėnuo-diena).
Kai klientas sutinka su laiku arba nurodo laiką, atsakyk formatu:
[BOOKING:paslauga|data ir laikas]
Data formatu: YYYY-MM-DD HH:MM
Pvz: [BOOKING:Stabdžių remontas|2025-06-18 10:00]

Rašyk lietuviškai, mandagiai, profesionaliai.
NENAUDOK jokio markdown formatavimo (**, *, # ir pan.) — tai SMS žinutė, rašyk paprastu tekstu.
            """.trim()
        }

    private fun isLithuanianHoliday(date: java.time.LocalDate): Boolean {
        val year = date.year
        val fixed = setOf(
            java.time.MonthDay.of(1, 1),   // Naujieji metai
            java.time.MonthDay.of(2, 16),  // Valstybės atkūrimo diena
            java.time.MonthDay.of(3, 11),  // Nepriklausomybės atkūrimo diena
            java.time.MonthDay.of(5, 1),   // Darbo diena
            java.time.MonthDay.of(6, 24),  // Joninės / Rasos
            java.time.MonthDay.of(7, 6),   // Valstybės diena
            java.time.MonthDay.of(8, 15),  // Žolinė
            java.time.MonthDay.of(11, 1),  // Visų Šventųjų diena
            java.time.MonthDay.of(11, 2),  // Vėlinės
            java.time.MonthDay.of(12, 24), // Kūčios
            java.time.MonthDay.of(12, 25), // Kalėdos
            java.time.MonthDay.of(12, 26), // Kalėdos (antra diena)
        )
        if (fixed.contains(java.time.MonthDay.from(date))) return true
        // Velykos (Easter Sunday + Monday) - anonymous Gregorian algorithm
        val a = year % 19; val b = year / 100; val c = year % 100
        val d = b / 4; val e = b % 4; val f = (b + 8) / 25
        val g = (b - f + 1) / 3; val h = (19 * a + b - d - g + 15) % 30
        val i = c / 4; val k = c % 4; val l = (32 + 2 * e + 2 * i - h - k) % 7
        val m = (a + 11 * h + 22 * l) / 451
        val month = (h + l - 7 * m + 114) / 31; val day = (h + l - 7 * m + 114) % 31 + 1
        val easter = java.time.LocalDate.of(year, month, day)
        return date == easter || date == easter.plusDays(1)
    }

    private fun findNextSlot(from: java.time.LocalDateTime): java.time.LocalDateTime {
        var slot = from
        while (true) {
            val dow = slot.dayOfWeek
            val hour = slot.hour
            when {
                dow == java.time.DayOfWeek.SUNDAY || isLithuanianHoliday(slot.toLocalDate()) ->
                    slot = slot.plusDays(1).withHour(8).withMinute(0)
                dow == java.time.DayOfWeek.SATURDAY && hour >= 13 -> slot = slot.plusDays(2).withHour(8).withMinute(0)
                dow == java.time.DayOfWeek.SATURDAY && hour < 9 -> slot = slot.withHour(9).withMinute(0)
                hour >= 16 -> slot = slot.plusDays(1).withHour(8).withMinute(0)
                hour < 8 -> slot = slot.withHour(8).withMinute(0)
                else -> return slot.withMinute(0).withSecond(0)
            }
        }
    }

    fun generateGreeting(phone: String): String {
        AppLog.i(TAG, "generateGreeting for $phone")
        return GREETING_TEMPLATE
    }

    companion object {
        private const val TAG = "ClaudeApiClient"
        const val GREETING_TEMPLATE = "Sveiki! Čia Proteros Servisas. Atsiprašome, kad dabar negalėjome atsiliepti. Aprašykite automobilio problemą ir norimą vizito laiką — ir mes iškart pasiūlysime artimiausią laisvą laiką."
        const val ADDRESS_WITH_MAP = "\nAukštaičių g. 29-2, Panevėžys\nhttps://maps.google.com/?q=Aukstaičiu+g.+29-2,+Panevezys,+Lithuania"
    }

    data class AiReply(
        val text: String,
        val bookingDetected: Boolean = false,
        val service: String? = null,
        val dateTime: String? = null
    )

    suspend fun generateReply(phone: String, history: List<Message>, latestMessage: String, contactName: String? = null): AiReply = withContext(Dispatchers.IO) {
        val apiKey = SecurePrefs.getApiKey(context)
        AppLog.i(TAG, "generateReply for $phone, hasApiKey=${!apiKey.isNullOrBlank()}, historySize=${history.size}")
        if (apiKey.isNullOrBlank()) return@withContext AiReply("Atsiprašome, šiuo metu negalime atsakyti. Paskambinkite 8-600-12345.")

        try {
            val messages = JSONArray()
            var lastRole = ""
            for (msg in history) {
                if (msg.sender == Message.SENDER_SYSTEM) continue
                val role = if (msg.sender == Message.SENDER_CLIENT) "user" else "assistant"
                if (role == lastRole) continue
                messages.put(JSONObject().put("role", role).put("content", msg.body))
                lastRole = role
            }
            if (lastRole == "user") {
                // Don't add duplicate user message
            } else {
                messages.put(JSONObject().put("role", "user").put("content", latestMessage))
            }

            if (messages.length() == 0) {
                messages.put(JSONObject().put("role", "user").put("content", latestMessage))
            }

            AppLog.i(TAG, "Calling Claude with ${messages.length()} messages")
            val nameContext = if (!contactName.isNullOrBlank()) "\nKliento vardas: $contactName. Kreipkis vardu." else "\nKliento vardas nežinomas. Neskreipk vardu."
            val responseText = callClaude(apiKey, (0 until messages.length()).map { messages.getJSONObject(it) }, nameContext)
            AppLog.i(TAG, "Reply for $phone (${responseText.length} chars)")

            val bookingRegex = """\[BOOKING:([^|]+)\|(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})]""".toRegex()
            val match = bookingRegex.find(responseText)

            if (match != null) {
                AiReply(
                    text = responseText.replace(bookingRegex, "").trim(),
                    bookingDetected = true,
                    service = match.groupValues[1],
                    dateTime = match.groupValues[2]
                )
            } else {
                AiReply(text = responseText)
            }
        } catch (e: Exception) {
            AppLog.e(TAG, "generateReply failed for $phone", e)
            AiReply("Atsiprašome, įvyko klaida. Pabandykite vėliau arba skambinkite tiesiogiai.")
        }
    }

    private fun callClaude(apiKey: String, messages: List<JSONObject>, extraContext: String = ""): String {
        val messagesArray = JSONArray()
        messages.forEach { messagesArray.put(it) }

        val bodyJson = JSONObject()
            .put("model", "claude-sonnet-4-6")
            .put("max_tokens", 256)
            .put("system", systemPrompt + extraContext)
            .put("messages", messagesArray)

        AppLog.i(TAG, "Calling Claude API (${messagesArray.length()} messages)")

        val body = bodyJson.toString().toRequestBody("application/json".toMediaType())

        val request = Request.Builder()
            .url("https://api.anthropic.com/v1/messages")
            .addHeader("x-api-key", apiKey)
            .addHeader("anthropic-version", "2023-06-01")
            .addHeader("content-type", "application/json")
            .post(body)
            .build()

        val response = client.newCall(request).execute()
        val responseBody = response.body?.string() ?: throw Exception("Tuščias atsakymas")

        if (!response.isSuccessful) {
            AppLog.e(TAG, "Claude API error ${response.code}: $responseBody")
            throw Exception("Claude API klaida: ${response.code} - $responseBody")
        }

        val json = JSONObject(responseBody)
        val content = json.optJSONArray("content")
        if (content == null || content.length() == 0) {
            throw Exception("Tuščias Claude atsakymas")
        }
        return content.getJSONObject(0).getString("text")
    }
}
