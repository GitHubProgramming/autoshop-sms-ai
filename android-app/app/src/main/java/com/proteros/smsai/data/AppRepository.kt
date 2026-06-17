package com.proteros.smsai.data

import android.content.Context
import com.proteros.smsai.api.ClaudeApiClient
import com.proteros.smsai.api.GoogleCalendarClient
import com.proteros.smsai.util.PhoneUtils
import com.proteros.smsai.util.SecurePrefs
import com.proteros.smsai.util.SmsSender
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

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

        val existing = conversationDao.getByPhone(phone)
        if (existing != null && existing.status == Conversation.STATUS_ACTIVE) return

        conversationDao.upsert(
            Conversation(phoneNumber = phone, status = Conversation.STATUS_ACTIVE)
        )

        val greeting = claudeClient.generateGreeting(phone)

        messageDao.insert(
            Message(conversationPhone = phone, sender = Message.SENDER_SYSTEM, body = "Praleistas skambutis aptiktas")
        )

        val result = smsSender.send(phone, greeting)
        if (result.isSuccess) {
            messageDao.insert(
                Message(conversationPhone = phone, sender = Message.SENDER_AI, body = greeting)
            )
            conversationDao.upsert(
                Conversation(phoneNumber = phone, status = Conversation.STATUS_ACTIVE, lastMessage = greeting)
            )
        } else {
            val error = result.exceptionOrNull()?.message ?: "Nežinoma klaida"
            messageDao.insert(
                Message(conversationPhone = phone, sender = Message.SENDER_SYSTEM, body = "SMS klaida: $error")
            )
            conversationDao.updateStatus(phone, Conversation.STATUS_ERROR, error)
        }
    }

    suspend fun handleIncomingSms(rawPhone: String, body: String) {
        val phone = PhoneUtils.normalize(rawPhone)

        val convo = conversationDao.getByPhone(phone) ?: return

        messageDao.insert(
            Message(conversationPhone = phone, sender = Message.SENDER_CLIENT, body = body)
        )

        if (convo.ownerTakeover) return

        val history = messageDao.getForConversation(phone)
        val aiResponse = claudeClient.generateReply(phone, history, body)

        if (aiResponse.bookingDetected) {
            val eventId = calendarClient.createAppointment(
                clientPhone = phone,
                service = aiResponse.service ?: "Nenurodyta",
                dateTime = aiResponse.dateTime ?: ""
            )
            if (eventId != null) {
                conversationDao.setBooked(phone, eventId)
                messageDao.insert(
                    Message(conversationPhone = phone, sender = Message.SENDER_SYSTEM, body = "Vizitas užregistruotas kalendoriuje")
                )
            }
        }

        val sendResult = smsSender.send(phone, aiResponse.text)
        if (sendResult.isSuccess) {
            messageDao.insert(
                Message(conversationPhone = phone, sender = Message.SENDER_AI, body = aiResponse.text)
            )
            conversationDao.upsert(convo.copy(lastMessage = aiResponse.text, updatedAt = System.currentTimeMillis()))
        } else {
            conversationDao.updateStatus(phone, Conversation.STATUS_ERROR, sendResult.exceptionOrNull()?.message)
        }
    }

    suspend fun sendOwnerMessage(phone: String, text: String) {
        val result = smsSender.send(phone, text)
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
