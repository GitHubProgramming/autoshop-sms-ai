package com.proteros.smsai.data

import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(tableName = "conversations")
data class Conversation(
    @PrimaryKey val phoneNumber: String,
    val contactName: String? = null,
    val status: String = STATUS_ACTIVE,
    val ownerTakeover: Boolean = false,
    val createdAt: Long = System.currentTimeMillis(),
    val updatedAt: Long = System.currentTimeMillis(),
    val lastMessage: String? = null,
    val calendarEventId: String? = null,
    val errorMessage: String? = null,
    val bookingService: String? = null,
    val bookingDateTime: String? = null
) {
    companion object {
        const val STATUS_ACTIVE = "active"
        const val STATUS_BOOKED = "booked"
        const val STATUS_CLOSED = "closed"
        const val STATUS_ERROR = "error"
    }
}

@Entity(
    tableName = "messages",
    foreignKeys = [ForeignKey(
        entity = Conversation::class,
        parentColumns = ["phoneNumber"],
        childColumns = ["conversationPhone"],
        onDelete = ForeignKey.CASCADE
    )],
    indices = [Index("conversationPhone")]
)
data class Message(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val conversationPhone: String,
    val sender: String,
    val body: String,
    val timestamp: Long = System.currentTimeMillis(),
    val status: String = "sent"
) {
    companion object {
        const val SENDER_CLIENT = "client"
        const val SENDER_AI = "ai"
        const val SENDER_OWNER = "owner"
        const val SENDER_SYSTEM = "system"
    }
}
