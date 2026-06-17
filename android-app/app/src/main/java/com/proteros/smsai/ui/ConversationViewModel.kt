package com.proteros.smsai.ui

import androidx.lifecycle.*
import com.proteros.smsai.data.AppRepository
import com.proteros.smsai.util.AppLog
import kotlinx.coroutines.flow.catch
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
        AppLog.i(TAG, "Init for phone: '$phone' (len=${phone.length}, bytes=${phone.toByteArray().joinToString(",") { it.toString() }})")
        viewModelScope.launch {
            try {
                val convo = repo.conversationDao.getByPhone(phone)
                AppLog.i(TAG, "Conversation found: ${convo != null}, takeover: ${convo?.ownerTakeover}, status: ${convo?.status}")
                _isTakeover.postValue(convo?.ownerTakeover ?: false)

                if (convo == null) {
                    val all = repo.conversationDao.getAllOnce()
                    AppLog.e(TAG, "No conversation for '$phone'. All phones in DB: ${all.map { "'${it.phoneNumber}'" }}")
                }
            } catch (e: Exception) {
                AppLog.e(TAG, "Failed to load conversation", e)
            }
        }
        viewModelScope.launch {
            try {
                repo.messageDao.getForConversationFlow(phone)
                    .catch { e ->
                        AppLog.e(TAG, "Messages flow error", e)
                    }
                    .collect { list ->
                        AppLog.i(TAG, "Messages loaded: ${list.size} for phone='$phone'")
                        if (list.isEmpty()) {
                            val allMsgs = repo.messageDao.getAllMessages()
                            AppLog.w(TAG, "0 messages for '$phone'. Total messages in DB: ${allMsgs.size}. Phones: ${allMsgs.map { it.conversationPhone }.distinct()}")
                        }
                        _messages.postValue(list.map { m ->
                            ChatItem(text = m.body, sender = m.sender, timestamp = m.timestamp)
                        })
                    }
            } catch (e: Exception) {
                AppLog.e(TAG, "Failed to collect messages", e)
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
                AppLog.e(TAG, "toggleTakeover failed", e)
                _error.postValue(e.message)
            }
        }
    }

    fun sendOwnerMessage(text: String) {
        viewModelScope.launch {
            try {
                repo.sendOwnerMessage(phone, text)
            } catch (e: Exception) {
                AppLog.e(TAG, "sendOwnerMessage failed", e)
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
