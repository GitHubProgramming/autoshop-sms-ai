package com.proteros.smsai.ui

import androidx.lifecycle.*
import com.proteros.smsai.data.AppRepository
import com.proteros.smsai.data.Message
import kotlinx.coroutines.launch

class ConversationViewModel(
    private val repo: AppRepository,
    private val phone: String
) : ViewModel() {

    data class ChatItem(
        val text: String,
        val sender: String,
        val timestamp: Long
    )

    val messages: LiveData<List<ChatItem>> = repo.messageDao.getForConversationFlow(phone).asLiveData().map { list ->
        list.map { m -> ChatItem(text = m.body, sender = m.sender, timestamp = m.timestamp) }
    }

    private val _isTakeover = MutableLiveData(false)
    val isTakeover: LiveData<Boolean> = _isTakeover

    private val _error = MutableLiveData<String?>(null)
    val error: LiveData<String?> = _error

    init {
        viewModelScope.launch {
            val convo = repo.conversationDao.getByPhone(phone)
            _isTakeover.postValue(convo?.ownerTakeover ?: false)
        }
    }

    fun toggleTakeover() {
        val newState = _isTakeover.value != true
        viewModelScope.launch {
            repo.setTakeover(phone, newState)
            _isTakeover.postValue(newState)
        }
    }

    fun sendOwnerMessage(text: String) {
        viewModelScope.launch {
            try {
                repo.sendOwnerMessage(phone, text)
            } catch (e: Exception) {
                _error.postValue(e.message)
            }
        }
    }

    class Factory(private val repo: AppRepository, private val phone: String) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = ConversationViewModel(repo, phone) as T
    }
}
