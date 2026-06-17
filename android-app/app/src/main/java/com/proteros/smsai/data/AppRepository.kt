package com.proteros.smsai.data

import android.content.Context
import com.proteros.smsai.util.AppLog
import com.proteros.smsai.api.ClaudeApiClient
import com.proteros.smsai.api.GoogleCalendarClient
import com.proteros.smsai.util.PhoneUtils
import com.proteros.smsai.util.SecurePrefs
import com.proteros.smsai.util.SmsSender

class AppRepository(
    private val context: Context,
    private val db: AppDatabase
) {
    val conversationDao = db.conversationDao()
    val messageDao = db.messageDao()

    private val claudeClient by lazy { ClaudeApiClient(context) }
    private val calendarClient by lazy { GoogleCalendarClient(context) }
    private val smsSender by lazy { SmsSender(context) }

    suspend fun handleMissedCall(rawPhone: String) {
        val phone = PhoneUtils.normalize(rawPhone)
        AppLog.i("AppRepo", "handleMissedCall: $phone")

        val existing = conversationDao.getByPhone(phone)
        if (existing != null && existing.status == Conversation.STATUS_ACTIVE) {
            AppLog.i("AppRepo", "Active conversation already exists for $phone, skipping")
            return
        }

        conversationDao.insertIgnore(
            Conversation(phoneNumber = phone, status = Conversation.STATUS_ACTIVE)
        )

        messageDao.insert(
            Message(conversationPhone = phone, sender = Message.SENDER_SYSTEM, body = "Praleistas skambutis aptiktas")
        )

        val greeting = claudeClient.generateGreeting(phone)
        AppLog.i("AppRepo", "Generated greeting for $phone: $greeting")

        messageDao.insert(
            Message(conversationPhone = phone, sender = Message.SENDER_AI, body = greeting)
        )
        conversationDao.updateConversation(phone, greeting, Conversation.STATUS_ACTIVE)

        val result = smsSender.sendFireAndForget(phone, greeting)
        if (result.isFailure) {
            val error = result.exceptionOrNull()?.message ?: "Nežinoma klaida"
            AppLog.e("AppRepo", "SMS send exception for $phone: $error")
            messageDao.insert(
                Message(conversationPhone = phone, sender = Message.SENDER_SYSTEM, body = "SMS klaida: $error")
            )
            conversationDao.updateStatus(phone, Conversation.STATUS_ERROR, error)
        }
    }

    suspend fun handleIncomingSms(rawPhone: String, body: String) {
        val phone = PhoneUtils.normalize(rawPhone)
        AppLog.i("AppRepo", "handleIncomingSms from $phone: $body")

        var convo = conversationDao.getByPhone(phone)
        if (convo == null) {
            AppLog.i("AppRepo", "No conversation for $phone, creating new one")
            conversationDao.insertIgnore(
                Conversation(phoneNumber = phone, status = Conversation.STATUS_ACTIVE)
            )
            convo = conversationDao.getByPhone(phone)!!
        }

        messageDao.insert(
            Message(conversationPhone = phone, sender = Message.SENDER_CLIENT, body = body)
        )

        if (convo.ownerTakeover) {
            AppLog.i("AppRepo", "Owner takeover active for $phone, skipping AI reply")
            return
        }

        val history = messageDao.getForConversation(phone)
        val historyWithoutLatest = history.dropLast(1)
        val aiResponse = claudeClient.generateReply(phone, historyWithoutLatest, body)
        AppLog.i("AppRepo", "AI reply for $phone: ${aiResponse.text}")

        if (aiResponse.bookingDetected) {
            AppLog.i("AppRepo", "Booking detected: ${aiResponse.service} at ${aiResponse.dateTime}")
            var eventId: String? = null
            try {
                eventId = calendarClient.createAppointment(
                    clientPhone = phone,
                    service = aiResponse.service ?: "Nenurodyta",
                    dateTime = aiResponse.dateTime ?: ""
                )
            } catch (e: Exception) {
                AppLog.e("AppRepo", "Calendar event creation failed", e)
            }
            conversationDao.setBooked(phone, eventId ?: "", aiResponse.service, aiResponse.dateTime)
            messageDao.insert(
                Message(
                    conversationPhone = phone,
                    sender = Message.SENDER_SYSTEM,
                    body = if (eventId != null) "Vizitas užregistruotas kalendoriuje" else "Vizitas užregistruotas (be kalendoriaus)"
                )
            )
        }

        messageDao.insert(
            Message(conversationPhone = phone, sender = Message.SENDER_AI, body = aiResponse.text)
        )
        conversationDao.updateConversation(phone, aiResponse.text, Conversation.STATUS_ACTIVE)

        val sendResult = smsSender.sendFireAndForget(phone, aiResponse.text)
        if (sendResult.isFailure) {
            conversationDao.updateStatus(phone, Conversation.STATUS_ERROR, sendResult.exceptionOrNull()?.message)
        }
    }

    suspend fun sendOwnerMessage(phone: String, text: String) {
        val result = smsSender.sendFireAndForget(phone, text)
        if (result.isSuccess) {
            messageDao.insert(
                Message(conversationPhone = phone, sender = Message.SENDER_OWNER, body = text)
            )
        } else {
            throw result.exceptionOrNull() ?: Exception("SMS siuntimas nepavyko")
        }
    }

    suspend fun setTakeover(phone: String, takeover: Boolean) {
        conversationDao.setTakeover(phone, takeover)
        val label = if (takeover) "Savininkas perėmė pokalbį" else "AI agentas vėl aktyvus"
        messageDao.insert(
            Message(conversationPhone = phone, sender = Message.SENDER_SYSTEM, body = label)
        )
    }
}
