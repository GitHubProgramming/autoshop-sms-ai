package com.proteros.smsai.data

import androidx.room.*
import kotlinx.coroutines.flow.Flow

@Dao
interface ConversationDao {
    @Query("SELECT * FROM conversations ORDER BY updatedAt DESC")
    fun getAllFlow(): Flow<List<Conversation>>

    @Query("SELECT * FROM conversations WHERE status = :status ORDER BY updatedAt DESC")
    fun getByStatusFlow(status: String): Flow<List<Conversation>>

    @Query("SELECT * FROM conversations WHERE phoneNumber = :phone")
    suspend fun getByPhone(phone: String): Conversation?

    @Query("SELECT * FROM conversations WHERE status = 'error' OR (status = 'active' AND lastMessage IS NULL) ORDER BY updatedAt DESC")
    fun getNeedingAttentionFlow(): Flow<List<Conversation>>

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertIgnore(conversation: Conversation): Long

    @Query("UPDATE conversations SET lastMessage = :lastMessage, status = :status, updatedAt = :now WHERE phoneNumber = :phone")
    suspend fun updateConversation(phone: String, lastMessage: String?, status: String, now: Long = System.currentTimeMillis())

    @Query("UPDATE conversations SET contactName = :name WHERE phoneNumber = :phone")
    suspend fun setContactName(phone: String, name: String)

    @Query("UPDATE conversations SET ownerTakeover = :takeover, updatedAt = :now WHERE phoneNumber = :phone")
    suspend fun setTakeover(phone: String, takeover: Boolean, now: Long = System.currentTimeMillis())

    @Query("UPDATE conversations SET status = :status, updatedAt = :now, errorMessage = :error WHERE phoneNumber = :phone")
    suspend fun updateStatus(phone: String, status: String, error: String? = null, now: Long = System.currentTimeMillis())

    @Query("UPDATE conversations SET calendarEventId = :eventId, bookingService = :service, bookingDateTime = :dateTime, status = 'booked', updatedAt = :now WHERE phoneNumber = :phone")
    suspend fun setBooked(phone: String, eventId: String, service: String? = null, dateTime: String? = null, now: Long = System.currentTimeMillis())

    @Query("SELECT * FROM conversations WHERE status = 'booked' ORDER BY bookingDateTime ASC")
    fun getBookedFlow(): kotlinx.coroutines.flow.Flow<List<Conversation>>

    @Query("SELECT * FROM conversations ORDER BY updatedAt DESC")
    suspend fun getAllOnce(): List<Conversation>

    @Query("DELETE FROM conversations WHERE phoneNumber = :phone")
    suspend fun delete(phone: String)

    @Query("UPDATE conversations SET status = 'closed' WHERE status = 'booked' AND updatedAt < :cutoff")
    suspend fun closeOldBooked(cutoff: Long)

    @Query("UPDATE conversations SET rescheduleCount = rescheduleCount + 1 WHERE phoneNumber = :phone")
    suspend fun incrementReschedule(phone: String)

    @Query("SELECT * FROM conversations WHERE status = 'active' AND updatedAt < :cutoff AND ownerTakeover = 0 AND inactivityNotified = 0")
    suspend fun getStaleActive(cutoff: Long): List<Conversation>

    @Query("UPDATE conversations SET inactivityNotified = 1 WHERE phoneNumber = :phone")
    suspend fun markInactivityNotified(phone: String)

    @Query("UPDATE conversations SET inactivityNotified = 0 WHERE phoneNumber = :phone")
    suspend fun resetInactivityNotified(phone: String)

    @Query("UPDATE conversations SET carInfo = :carInfo WHERE phoneNumber = :phone")
    suspend fun updateCarInfo(phone: String, carInfo: String)

    @Query("UPDATE conversations SET bookingComment = :comment WHERE phoneNumber = :phone")
    suspend fun updateBookingComment(phone: String, comment: String)
}

@Dao
interface MessageDao {
    @Query("SELECT * FROM messages WHERE conversationPhone = :phone ORDER BY timestamp ASC")
    fun getForConversationFlow(phone: String): Flow<List<Message>>

    @Query("SELECT * FROM messages WHERE conversationPhone = :phone ORDER BY timestamp ASC")
    suspend fun getForConversation(phone: String): List<Message>

    @Insert
    suspend fun insert(message: Message): Long

    @Query("SELECT * FROM messages ORDER BY timestamp DESC LIMIT 50")
    suspend fun getAllMessages(): List<Message>

    @Query("DELETE FROM messages WHERE conversationPhone = :phone")
    suspend fun deleteForConversation(phone: String)
}
