package com.proteros.smsai.ui

import android.util.Log
import androidx.lifecycle.*
import com.proteros.smsai.data.AppRepository
import com.proteros.smsai.data.Message
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.map
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

    private val _messages = MutableLiveData<List<ChatItem>>(emptyList())
    val messages: LiveData<List<ChatItem>> = _messages

    private val _isTakeover = MutableLiveData(false)
    val isTakeover: LiveData<Boolean> = _isTakeover

    private val _error = MutableLiveData<String?>(null)
    val error: LiveData<String?> = _error

    init {
        Log.i(TAG, "Init for phone: $phone")
        viewModelScope.launch {
            try {
                val convo = repo.conversationDao.getByPhone(phone)
                Log.i(TAG, "Conversation found: ${convo != null}, takeover: ${convo?.ownerTakeover}")
                _isTakeover.postValue(convo?.ownerTakeover ?: false)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to load conversation", e)
            }
        }
        viewModelScope.launch {
            try {
                repo.messageDao.getForConversationFlow(phone)
                    .catch { e ->
                        Log.e(TAG, "Messages flow error", e)
                    }
                    .collect { list ->
                        Log.i(TAG, "Messages loaded: ${list.size} for phone=$phone")
                        _messages.postValue(list.map { m ->
                            ChatItem(text = m.body, sender = m.sender, timestamp = m.timestamp)
                        })
                    }
            } catch (e: Exception) {
                Log.e(TAG, "Failed to collect messages", e)
            }
        }
    }

    fun toggleTakeover() {
        val newState = _isTakeover.value != true
        viewModelScope.launch {
            try {
                repo.setTakeover(phone, newState)
                _isTakeover.postValue(newState)
            } catch (e: Exception) {
                Log.e(TAG, "toggleTakeover failed", e)
                _error.postValue(e.message)
            }
        }
    }

    fun sendOwnerMessage(text: String) {
        viewModelScope.launch {
            try {
                repo.sendOwnerMessage(phone, text)
            } catch (e: Exception) {
                Log.e(TAG, "sendOwnerMessage failed", e)
                _error.postValue(e.message)
            }
        }
    }

    class Factory(private val repo: AppRepository, private val phone: String) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = ConversationViewModel(repo, phone) as T
    }

    companion object {
        private const val TAG = "ConversationVM"
    }
}
