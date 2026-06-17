package com.proteros.smsai.ui

import androidx.lifecycle.*
import com.proteros.smsai.data.AppRepository
import com.proteros.smsai.data.Conversation

class AgentViewModel(private val repo: AppRepository) : ViewModel() {

    data class ConversationItem(
        val phone: String,
        val contactName: String?,
        val lastMessage: String,
        val status: String,
        val isOwnerTakeover: Boolean,
        val updatedAt: Long
    )

    val conversations: LiveData<List<ConversationItem>> = repo.conversationDao.getAllFlow().asLiveData().map { list ->
        list.map { c ->
            ConversationItem(
                phone = c.phoneNumber,
                contactName = c.contactName,
                lastMessage = c.lastMessage ?: "",
                status = when (c.status) {
                    Conversation.STATUS_BOOKED -> "Užregistruotas"
                    Conversation.STATUS_ERROR -> "Klaida"
                    Conversation.STATUS_CLOSED -> "Baigtas"
                    else -> if (c.ownerTakeover) "Savininkas" else "AI agentas"
                },
                isOwnerTakeover = c.ownerTakeover,
                updatedAt = c.updatedAt
            )
        }
    }

    class Factory(private val repo: AppRepository) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = AgentViewModel(repo) as T
    }
}
