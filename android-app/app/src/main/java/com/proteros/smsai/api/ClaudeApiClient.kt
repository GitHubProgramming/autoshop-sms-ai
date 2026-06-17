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

    private val systemPrompt = """
        Tu esi Proteros autoserviso SMS asistentas Panevėžyje.
        Adresas: Pramonės g. 2, Panevėžys.
        Darbo laikas: I-V 8:00-17:00, VI 9:00-14:00.

        Paslaugos: važiuoklės remontas, variklio diagnostika, stabdžių sistema,
        pakabos remontas, techninė apžiūra, kompiuterinė diagnostika, tepalų keitimas.

        Tavo tikslas: mandagiai susitarti dėl vizito laiko.
        Atsakyk trumpai (max 160 simbolių SMS).
        Kai klientas sutinka su laiku, atsakyk formatu:
        [BOOKING:paslauga|data ir laikas]
        Pvz: [BOOKING:Stabdžių remontas|2024-03-15 10:00]

        Rašyk lietuviškai, mandagiai, profesionaliai.
    """.trimIndent()

    suspend fun generateGreeting(phone: String): String = withContext(Dispatchers.IO) {
        val apiKey = SecurePrefs.getApiKey(context)
        AppLog.i(TAG, "generateGreeting for $phone, hasApiKey=${!apiKey.isNullOrBlank()}")
        if (apiKey.isNullOrBlank()) return@withContext "Sveiki! Matėme praleistą skambutį. Kuo galime padėti? Proteros autoservisas."

        try {
            val response = callClaude(apiKey, listOf(
                JSONObject().put("role", "user").put("content", "Klientas numeriu $phone ką tik skambino bet neprisiskambino. Parašyk jam trumpą SMS pasisveikinimą.")
            ))
            AppLog.i(TAG, "Greeting generated: $response")
            response
        } catch (e: Exception) {
            AppLog.e(TAG, "generateGreeting failed", e)
            "Sveiki! Matėme praleistą skambutį. Kuo galime padėti? Proteros autoservisas."
        }
    }

    data class AiReply(
        val text: String,
        val bookingDetected: Boolean = false,
        val service: String? = null,
        val dateTime: String? = null
    )

    suspend fun generateReply(phone: String, history: List<Message>, latestMessage: String): AiReply = withContext(Dispatchers.IO) {
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
            val responseText = callClaude(apiKey, (0 until messages.length()).map { messages.getJSONObject(it) })
            AppLog.i(TAG, "Reply: $responseText")

            val bookingRegex = """\[BOOKING:(.+?)\|(.+?)]""".toRegex()
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

    private fun callClaude(apiKey: String, messages: List<JSONObject>): String {
        val messagesArray = JSONArray()
        messages.forEach { messagesArray.put(it) }

        val bodyJson = JSONObject()
            .put("model", "claude-sonnet-4-20250514")
            .put("max_tokens", 256)
            .put("system", systemPrompt)
            .put("messages", messagesArray)

        AppLog.i(TAG, "Request body: $bodyJson")

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
        return json.getJSONArray("content").getJSONObject(0).getString("text")
    }

    companion object {
        private const val TAG = "ClaudeApiClient"
    }
}
