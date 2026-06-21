package com.proteros.smsai.api

import android.content.Context
import com.proteros.smsai.data.Message
import com.proteros.smsai.util.AppLog
import com.proteros.smsai.util.BusinessCalendar
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

    private val sheetsClient by lazy { GoogleSheetsClient(context) }
    private var knowledgeBase: GoogleSheetsClient.KnowledgeBase = GoogleSheetsClient.defaultKnowledgeBase()

    private fun buildSystemPrompt(): String {
        val kb = knowledgeBase
        val now = java.time.LocalDateTime.now()
        val formatter = java.time.format.DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm")
        val dayFormatter = java.time.format.DateTimeFormatter.ofPattern("EEEE", java.util.Locale("lt"))
        val slot1 = BusinessCalendar.findNextSlot(now)
        val slot2 = BusinessCalendar.findNextSlot(slot1.plusHours(1))
        val slot1Str = "${slot1.format(dayFormatter)} ${slot1.format(formatter)}"
        val slot2Str = "${slot2.format(dayFormatter)} ${slot2.format(formatter)}"

        val servicesList = kb.services.joinToString("\n") { s ->
            val priceInfo = if (s.price.isNotBlank() && s.price != "Pagal apžiūrą") " (${s.price})" else ""
            val descInfo = if (s.description.isNotBlank()) " — ${s.description}" else ""
            "- ${s.name}$descInfo$priceInfo"
        }

        val faqBlock = if (kb.faq.isNotEmpty()) {
            "\nDUK (dažnai užduodami klausimai):\n" + kb.faq.joinToString("\n") {
                "- Jei klausia: \"${it.first}\" → Atsakyk: \"${it.second}\""
            }
        } else ""

        val rulesBlock = kb.rules.joinToString("\n") { "- $it" }

        val warrantyBlock = if (kb.warranties.isNotEmpty()) {
            "\nGarantijos ir sąlygos:\n" + kb.warranties.joinToString("\n") { "- ${it.first}: ${it.second}" }
        } else ""

        val customBlock = if (kb.customPrompt.isNotBlank()) "\n${kb.customPrompt}" else ""

        return """
Tu esi ${kb.businessName} SMS asistentas.
Adresas: ${kb.address}.
Darbo laikas: ${kb.workingHours}. Šeštadieniais, sekmadieniais ir per Lietuvos šventes NEDIRBAME.
Lietuvos šventės (nedarbo dienos): Naujieji metai (01-01), Valstybės atkūrimo diena (02-16), Nepriklausomybės diena (03-11), Velykos (sekmadienis+pirmadienis), Darbo diena (05-01), Joninės (06-24), Valstybės diena (07-06), Žolinė (08-15), Visų Šventųjų (11-01), Vėlinės (11-02), Kūčios (12-24), Kalėdos (12-25, 12-26).
Jei klientas nori registruotis šventinę dieną — paaiškink kad tą dieną nedirbame ir pasiūlyk kitą artimiausią darbo dieną.${if (kb.phone.isNotBlank()) "\nTelefonas: ${kb.phone}." else ""}
Dabar yra: ${now.format(formatter)}.

Paslaugos:
$servicesList
$faqBlock$warrantyBlock

SVARBIOS TAISYKLĖS:
$rulesBlock
- Priimk BET KOKIĄ su automobiliu susijusią užklausą. Jei klientas aprašo paslaugą kitais žodžiais nei sąraše (pvz "padangos" = "Ratų montavimas", "alyvos keitimas" = "Tepalų keitimas") — suprask ką turi omenyje ir registruok. NIEKADA nesakyk kad paslaugos neteikiame.
- Kiekvienas vizitas trunka ${kb.visitDuration} min.
- Kai klientas parašo problemą — iškart pasiūlyk 2 artimiausius laisvus laikus: $slot1Str arba $slot2Str.
- Jei klientas nurodo pageidaujamą dieną (pvz "penktadienį") — pasiūlyk 2 laisvus laikus tą dieną arba artimiausią darbo dieną.
- Jei klientas sutinka su vienu iš pasiūlytų laikų — iškart registruok.
- Registracijos patvirtinime NERAŠYK adreso — sistema automatiškai pridės adresą ir žemėlapio nuorodą.

Tavo tikslas: ${kb.agentGoal}.
Datą SMS tekste VISADA rašyk formatu: MM-dd, pvz "06-18 10:00" (mėnuo-diena).
Kai klientas sutinka su laiku arba nurodo laiką, atsakyk formatu:
[BOOKING:paslauga|data ir laikas]
Data formatu: YYYY-MM-DD HH:MM
Pvz: [BOOKING:Stabdžių remontas|2025-06-18 10:00]

Rašyk lietuviškai, mandagiai, profesionaliai.
NENAUDOK jokio markdown formatavimo (**, *, # ir pan.) — tai SMS žinutė, rašyk paprastu tekstu.$customBlock
        """.trim()
    }

    suspend fun refreshKnowledge() {
        knowledgeBase = sheetsClient.getKnowledge()
    }

    fun getGreeting(): String = knowledgeBase.greeting

    fun getMaxAiTurns(): Int = knowledgeBase.maxAiTurns

    fun getAddress(): String = knowledgeBase.address

    fun getAddressWithMap(): String {
        val encoded = java.net.URLEncoder.encode(knowledgeBase.address, "UTF-8")
        return "\n${knowledgeBase.address}\nhttps://maps.google.com/?q=$encoded"
    }

    fun generateGreeting(phone: String): String {
        AppLog.i(TAG, "generateGreeting for $phone")
        return knowledgeBase.greeting
    }

    companion object {
        private const val TAG = "ClaudeApiClient"
    }

    data class AiReply(
        val text: String,
        val bookingDetected: Boolean = false,
        val service: String? = null,
        val dateTime: String? = null
    )

    suspend fun generateReply(phone: String, history: List<Message>, latestMessage: String, contactName: String? = null, extraInfo: String? = null): AiReply = withContext(Dispatchers.IO) {
        refreshKnowledge()
        val apiKey = SecurePrefs.getApiKey(context)
        AppLog.i(TAG, "generateReply for $phone, hasApiKey=${!apiKey.isNullOrBlank()}, historySize=${history.size}")
        if (apiKey.isNullOrBlank()) return@withContext AiReply("Atsiprašome, šiuo metu negalime atsakyti.${if (knowledgeBase.phone.isNotBlank()) " Paskambinkite ${knowledgeBase.phone}." else ""}")

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
            val fullContext = nameContext + (extraInfo ?: "")
            val responseText = callClaude(apiKey, (0 until messages.length()).map { messages.getJSONObject(it) }, fullContext)
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
            .put("system", buildSystemPrompt() + extraContext)
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

        return client.newCall(request).execute().use { response ->
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
            content.getJSONObject(0).getString("text")
        }
    }
}
