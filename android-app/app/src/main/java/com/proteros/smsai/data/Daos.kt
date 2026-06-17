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

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(conversation: Conversation)

    @Query("UPDATE conversations SET ownerTakeover = :takeover, updatedAt = :now WHERE phoneNumber = :phone")
    suspend fun setTakeover(phone: String, takeover: Boolean, now: Long = System.currentTimeMillis())

    @Query("UPDATE conversations SET status = :status, updatedAt = :now, errorMessage = :error WHERE phoneNumber = :phone")
    suspend fun updateStatus(phone: String, status: String, error: String? = null, now: Long = System.currentTimeMillis())

    @Query("UPDATE conversations SET calendarEventId = :eventId, status = 'booked', updatedAt = :now WHERE phoneNumber = :phone")
    suspend fun setBooked(phone: String, eventId: String, now: Long = System.currentTimeMillis())
}

@Dao
interface MessageDao {
    @Query("SELECT * FROM messages WHERE conversationPhone = :phone ORDER BY timestamp ASC")
    fun getForConversationFlow(phone: String): Flow<List<Message>>

    @Query("SELECT * FROM messages WHERE conversationPhone = :phone ORDER BY timestamp ASC")
    suspend fun getForConversation(phone: String): List<Message>

    @Insert
    suspend fun insert(message: Message): Long
}
