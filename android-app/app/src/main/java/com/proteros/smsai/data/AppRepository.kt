package com.proteros.smsai.data

import android.content.Context
import com.proteros.smsai.util.AgentNotification
import com.proteros.smsai.util.AppLog
import com.proteros.smsai.util.maskPhone
import com.proteros.smsai.util.BusinessCalendar
import com.proteros.smsai.api.ClaudeApiClient
import com.proteros.smsai.api.GoogleCalendarClient
import com.proteros.smsai.api.GoogleSheetsClient
import com.proteros.smsai.util.ContactLookup
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
    private val sheetsClient by lazy { GoogleSheetsClient(context) }
    private val smsSender by lazy { SmsSender(context) }

    private val lastAiCallTime = java.util.concurrent.ConcurrentHashMap<String, Long>()
    private val AI_COOLDOWN_MS = 10_000L

    private val maxAiTurns: Int get() = claudeClient.getMaxAiTurns()

    suspend fun handleMissedCall(rawPhone: String) {
        archiveOldConversations()
        val phone = PhoneUtils.normalize(rawPhone)
        AppLog.i("AppRepo", "handleMissedCall: ${maskPhone(phone)}")

        val existing = conversationDao.getByPhone(phone)
        if (existing != null && (existing.status == Conversation.STATUS_ACTIVE || existing.status == Conversation.STATUS_BOOKED)) {
            AppLog.i("AppRepo", "Conversation already exists for ${maskPhone(phone)} (${existing.status}), skipping")
            return
        }

        val contactName = ContactLookup.findName(context, phone)
        AppLog.i("AppRepo", "Contact lookup for ${maskPhone(phone)}")

        conversationDao.insertIgnore(
            Conversation(phoneNumber = phone, status = Conversation.STATUS_ACTIVE, contactName = contactName)
        )

        messageDao.insert(
            Message(conversationPhone = phone, sender = Message.SENDER_SYSTEM, body = "Praleistas skambutis aptiktas")
        )

        claudeClient.refreshKnowledge()
        val greeting = claudeClient.generateGreeting(phone)
        AppLog.i("AppRepo", "Greeting generated for ${maskPhone(phone)}")

        messageDao.insert(
            Message(conversationPhone = phone, sender = Message.SENDER_AI, body = greeting)
        )
        conversationDao.updateConversation(phone, greeting, Conversation.STATUS_ACTIVE)

        sheetsClient.logEvent("Praleistas skambutis", phone, "Praleistas skambutis", greeting, contactName)

        val result = smsSender.sendWithRetry(phone, greeting)
        if (result.isFailure) {
            val error = result.exceptionOrNull()?.message ?: "Nežinoma klaida"
            AppLog.e("AppRepo", "SMS send exception for ${maskPhone(phone)}: $error")
            messageDao.insert(
                Message(conversationPhone = phone, sender = Message.SENDER_SYSTEM, body = "SMS klaida: $error")
            )
            conversationDao.updateStatus(phone, Conversation.STATUS_ERROR, error)
            sheetsClient.logEvent("Klaida", phone, "SMS siuntimas nepavyko: $error")
        }
    }

    suspend fun handleIncomingSms(rawPhone: String, body: String) {
        archiveOldConversations()
        val phone = PhoneUtils.normalize(rawPhone)
        AppLog.i("AppRepo", "handleIncomingSms from ${maskPhone(phone)} (${body.length} chars)")

        var convo = conversationDao.getByPhone(phone)
        if (convo == null) {
            AppLog.i("AppRepo", "No conversation yet for ${maskPhone(phone)}, waiting for missed call handler...")
            kotlinx.coroutines.delay(2000)
            convo = conversationDao.getByPhone(phone)
        }
        if (convo == null) {
            AppLog.i("AppRepo", "No app-initiated conversation for ${maskPhone(phone)}, ignoring private SMS")
            return
        }
        if (convo.contactName == null) {
            val contactName = ContactLookup.findName(context, phone)
            if (contactName != null) {
                conversationDao.setContactName(phone, contactName)
                convo = convo.copy(contactName = contactName)
            }
        }

        messageDao.insert(
            Message(conversationPhone = phone, sender = Message.SENDER_CLIENT, body = body)
        )

        if (convo.ownerTakeover) {
            AppLog.i("AppRepo", "Owner takeover active for ${maskPhone(phone)}, skipping AI reply")
            return
        }

        if (convo.status == Conversation.STATUS_BOOKED) {
            if (convo.rescheduleCount >= 1) {
                AppLog.i("AppRepo", "Reschedule limit reached for ${maskPhone(phone)}")
                val confirmMsg = "Jūsų vizitas: ${convo.bookingDateTime ?: "užregistruotas"}. Dėl pakeitimų skambinkite."
                messageDao.insert(
                    Message(conversationPhone = phone, sender = Message.SENDER_AI, body = confirmMsg)
                )
                smsSender.sendWithRetry(phone, confirmMsg)
                AgentNotification.handoverToOwner(context, phone)
                conversationDao.setTakeover(phone, true)
                messageDao.insert(
                    Message(conversationPhone = phone, sender = Message.SENDER_SYSTEM, body = "Klientas rašė po perkėlimo — perduota savininkui")
                )
                return
            }

            AppLog.i("AppRepo", "Allowing reschedule for ${maskPhone(phone)} (count=${convo.rescheduleCount})")
            conversationDao.updateStatus(phone, Conversation.STATUS_ACTIVE)
            conversationDao.incrementReschedule(phone)
            messageDao.insert(
                Message(conversationPhone = phone, sender = Message.SENDER_SYSTEM, body = "Klientas nori keisti vizito laiką — pokalbis pratęstas")
            )
        }

        val now = System.currentTimeMillis()
        val lastCall = lastAiCallTime[phone]
        if (lastCall != null && now - lastCall < AI_COOLDOWN_MS) {
            AppLog.i("AppRepo", "Rate limit: skipping AI call for ${maskPhone(phone)}")
            return
        }

        val history = messageDao.getForConversation(phone)
        val aiTurns = history.count { it.sender == Message.SENDER_AI }
        if (aiTurns >= maxAiTurns) {
            AppLog.i("AppRepo", "Max AI turns ($maxAiTurns) reached for ${maskPhone(phone)}, handing over")
            conversationDao.setTakeover(phone, true)
            AgentNotification.handoverToOwner(context, phone)
            messageDao.insert(
                Message(conversationPhone = phone, sender = Message.SENDER_SYSTEM, body = "Nepavyko susitarti per $maxAiTurns žinučių — perduota savininkui")
            )
            sheetsClient.logEvent("Perdavimas", phone, "Nepavyko susitarti per $maxAiTurns žinučių", contactName = convo.contactName)
            return
        }

        val historyWithoutLatest = history.dropLast(1).takeLast(10)
        val rescheduleContext = if (convo.rescheduleCount > 0 && !convo.bookingDateTime.isNullOrBlank()) {
            "\nKlientas nori PAKEISTI vizito laiką. Senas laikas: ${convo.bookingDateTime}. Paslauga: ${convo.bookingService ?: "ta pati"}. Pasiūlyk 2 naujus laikus ir kai sutiks — registruok su [BOOKING:...] formatu."
        } else null

        val availableSlots = try {
            val now = java.time.LocalDateTime.now()
            val fmt = java.time.format.DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm")
            val start = BusinessCalendar.findNextSlot(now).format(fmt)
            val slot1 = calendarClient.findNextFreeSlot(start)
            val slot2 = slot1?.let { calendarClient.findNextFreeSlot(it) }
            val slot3 = slot2?.let { calendarClient.findNextFreeSlot(it) }
            listOfNotNull(slot1, slot2, slot3)
        } catch (e: Exception) {
            AppLog.e("AppRepo", "Failed to fetch calendar slots", e)
            emptyList()
        }
        val slotsContext = if (availableSlots.isNotEmpty()) {
            "\nArtimiausi LAISVI laikai kalendoriuje: ${availableSlots.joinToString(", ")}. Siūlyk TIK šiuos laikus."
        } else null

        val extraInfo = listOfNotNull(rescheduleContext, slotsContext).joinToString("").ifEmpty { null }

        val aiResponse = claudeClient.generateReply(phone, historyWithoutLatest, body, convo.contactName, extraInfo)
        lastAiCallTime[phone] = System.currentTimeMillis()
        AppLog.i("AppRepo", "AI reply for ${maskPhone(phone)} (${aiResponse.text.length} chars)")

        if (aiResponse.bookingDetected) {
            AppLog.i("AppRepo", "Booking detected: ${aiResponse.service} at ${aiResponse.dateTime}")

            val slotFree = try {
                aiResponse.dateTime?.let { calendarClient.isSlotAvailable(it) } ?: false
            } catch (e: Exception) { AppLog.e("AppRepo", "isSlotAvailable failed", e); false }

            if (!slotFree) {
                AppLog.i("AppRepo", "Time slot conflict for ${maskPhone(phone)}")
                val nextFree = try {
                    aiResponse.dateTime?.let { calendarClient.findNextFreeSlot(it) }
                } catch (e: Exception) { AppLog.e("AppRepo", "findNextFreeSlot failed", e); null }

                if (nextFree != null) {
                    val altMsg = "Atsiprašome, ${aiResponse.dateTime} jau užimtas. Artimiausias laisvas laikas: $nextFree. Ar tinka?"
                    messageDao.insert(
                        Message(conversationPhone = phone, sender = Message.SENDER_AI, body = altMsg)
                    )
                    messageDao.insert(
                        Message(conversationPhone = phone, sender = Message.SENDER_SYSTEM, body = "Laiko konfliktas: ${aiResponse.dateTime} užimtas, pasiūlytas $nextFree")
                    )
                    smsSender.sendWithRetry(phone, altMsg)
                } else {
                    AgentNotification.bookingConflict(context, phone, aiResponse.dateTime)
                    conversationDao.setTakeover(phone, true)
                    messageDao.insert(
                        Message(conversationPhone = phone, sender = Message.SENDER_SYSTEM, body = "Laiko konfliktas: ${aiResponse.dateTime} užimtas, laisvų nėra — perduota savininkui")
                    )
                }
                return
            }

            if (!convo.calendarEventId.isNullOrBlank()) {
                val deleted = convo.calendarEventId?.let { calendarClient.deleteEvent(it) } ?: false
                AppLog.i("AppRepo", "Deleted old calendar event ${convo.calendarEventId}: $deleted")
            }

            var eventId: String? = null
            try {
                val chatSummary = history
                    .filter { it.sender != Message.SENDER_SYSTEM }
                    .takeLast(6)
                    .joinToString("\n") { msg ->
                        val prefix = if (msg.sender == Message.SENDER_CLIENT) "Klientas" else "AI"
                        "$prefix: ${msg.body}"
                    }
                val kb = sheetsClient.getKnowledge()
                val serviceDuration = kb.services
                    .firstOrNull { it.name.equals(aiResponse.service, ignoreCase = true) }
                    ?.durationMin ?: kb.visitDuration
                eventId = calendarClient.createAppointment(
                    clientPhone = phone,
                    service = aiResponse.service ?: "Nenurodyta",
                    dateTime = aiResponse.dateTime ?: "",
                    contactName = convo.contactName,
                    conversationSummary = chatSummary,
                    durationMin = serviceDuration
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
            AgentNotification.bookingMade(context, phone, aiResponse.service, aiResponse.dateTime, calendarOk = eventId != null)
        }

        val smsText = (if (aiResponse.bookingDetected && !aiResponse.text.contains(claudeClient.getAddress(), ignoreCase = true)) {
            aiResponse.text + claudeClient.getAddressWithMap()
        } else {
            aiResponse.text
        }).replace(Regex("\\n{3,}"), "\n\n").trim()

        messageDao.insert(
            Message(conversationPhone = phone, sender = Message.SENDER_AI, body = smsText)
        )

        if (aiResponse.bookingDetected) {
            conversationDao.updateConversation(phone, smsText, Conversation.STATUS_BOOKED)
        } else {
            conversationDao.updateConversation(phone, smsText, Conversation.STATUS_ACTIVE)
        }

        if (aiResponse.bookingDetected) {
            sheetsClient.logEvent("Booking", phone, body, "${aiResponse.service} | ${aiResponse.dateTime} | $smsText", convo.contactName)
        } else {
            sheetsClient.logEvent("Pokalbis", phone, body, smsText, convo.contactName)
        }

        val sendResult = smsSender.sendWithRetry(phone, smsText)
        if (sendResult.isFailure) {
            conversationDao.updateStatus(phone, Conversation.STATUS_ERROR, sendResult.exceptionOrNull()?.message)
            sheetsClient.logEvent("Klaida", phone, "SMS siuntimas nepavyko: ${sendResult.exceptionOrNull()?.message}")
        }
    }

    suspend fun sendOwnerMessage(phone: String, text: String) {
        val result = smsSender.sendWithRetry(phone, text)
        if (result.isSuccess) {
            messageDao.insert(
                Message(conversationPhone = phone, sender = Message.SENDER_OWNER, body = text)
            )
        } else {
            throw result.exceptionOrNull() ?: Exception("SMS siuntimas nepavyko")
        }
    }

    suspend fun archiveOldConversations() {
        val cutoff = System.currentTimeMillis() - 24 * 60 * 60 * 1000
        conversationDao.closeOldBooked(cutoff)
    }

    private suspend fun isBusinessHours(): Boolean {
        val kb = sheetsClient.getKnowledge()
        val (start, end) = BusinessCalendar.parseWorkingHours(kb.workingHours)
        return BusinessCalendar.isBusinessHours(java.time.LocalDateTime.now(BusinessCalendar.ZONE), start, end)
    }

    suspend fun closeConversation(phone: String) {
        conversationDao.updateStatus(phone, Conversation.STATUS_CLOSED)
        messageDao.insert(
            Message(conversationPhone = phone, sender = Message.SENDER_SYSTEM, body = "Savininkas uždarė pokalbį")
        )
        val convo = conversationDao.getByPhone(phone)
        sheetsClient.logEvent("Uždarytas", phone, "Savininkas uždarė pokalbį", contactName = convo?.contactName)
    }

    suspend fun createManualBooking(phone: String, service: String, dateTime: String): Result<String?> {
        return try {
            val convo = conversationDao.getByPhone(phone)
            val history = messageDao.getForConversation(phone)
            val chatSummary = history
                .filter { it.sender != Message.SENDER_SYSTEM }
                .takeLast(6)
                .joinToString("\n") { msg ->
                    val prefix = when (msg.sender) {
                        Message.SENDER_CLIENT -> "Klientas"
                        Message.SENDER_OWNER -> "Savininkas"
                        else -> "AI"
                    }
                    "$prefix: ${msg.body}"
                }
            val kb = sheetsClient.getKnowledge()
            val serviceDuration = kb.services
                .firstOrNull { it.name.equals(service, ignoreCase = true) }
                ?.durationMin ?: kb.visitDuration

            val eventId = calendarClient.createAppointment(
                clientPhone = phone,
                service = service,
                dateTime = dateTime,
                contactName = convo?.contactName,
                conversationSummary = chatSummary,
                durationMin = serviceDuration
            )
            conversationDao.setBooked(phone, eventId ?: "", service, dateTime)
            messageDao.insert(
                Message(conversationPhone = phone, sender = Message.SENDER_SYSTEM,
                    body = if (eventId != null) "Savininkas užregistravo: $service $dateTime" else "Savininkas užregistravo: $service $dateTime (be kalendoriaus)")
            )
            sheetsClient.logEvent("Savininko booking", phone, "$service | $dateTime", contactName = convo?.contactName)
            Result.success(eventId)
        } catch (e: Exception) {
            AppLog.e("AppRepo", "Manual booking failed", e)
            Result.failure(e)
        }
    }

    suspend fun getServiceNames(): List<String> {
        return try {
            sheetsClient.getKnowledge().services.map { it.name }
        } catch (e: Exception) {
            AppLog.e("AppRepo", "Failed to load services", e)
            emptyList()
        }
    }

    suspend fun setTakeover(phone: String, takeover: Boolean) {
        conversationDao.setTakeover(phone, takeover)
        val label = if (takeover) "Savininkas perėmė pokalbį" else "AI agentas vėl aktyvus"
        messageDao.insert(
            Message(conversationPhone = phone, sender = Message.SENDER_SYSTEM, body = label)
        )
        if (takeover) {
            try {
                val messages = messageDao.getForConversation(phone)
                val lastAi = messages.lastOrNull { it.sender == Message.SENDER_AI }
                val lastClient = messages.lastOrNull { it.sender == Message.SENDER_CLIENT }
                if (lastAi != null && lastClient != null) {
                    sheetsClient.logCorrection(phone, lastClient.body, lastAi.body, "Savininkas perėmė pokalbį")
                }
            } catch (e: Exception) {
                AppLog.e("AppRepo", "Auto-detect correction failed", e)
            }
        }
    }
}
