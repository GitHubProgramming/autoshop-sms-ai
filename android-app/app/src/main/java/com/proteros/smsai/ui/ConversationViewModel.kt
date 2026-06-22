package com.proteros.smsai.ui

import androidx.lifecycle.*
import com.proteros.smsai.data.AppRepository
import com.proteros.smsai.data.Conversation
import com.proteros.smsai.util.AppLog
import com.proteros.smsai.util.maskPhone
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

    private val _contactName = MutableLiveData<String?>(null)
    val contactName: LiveData<String?> = _contactName

    private val _status = MutableLiveData<String?>(null)
    val status: LiveData<String?> = _status

    private val _error = MutableLiveData<String?>(null)
    val error: LiveData<String?> = _error

    private val _services = MutableLiveData<List<String>>(emptyList())
    val services: LiveData<List<String>> = _services

    private val _bookingDone = MutableLiveData(false)
    val bookingDone: LiveData<Boolean> = _bookingDone

    init {
        AppLog.i(TAG, "Init for phone: ${maskPhone(phone)}")
        viewModelScope.launch {
            try {
                val convo = repo.conversationDao.getByPhone(phone)
                AppLog.i(TAG, "Conversation found: ${convo != null}, takeover: ${convo?.ownerTakeover}, status: ${convo?.status}")
                _isTakeover.postValue(convo?.ownerTakeover ?: false)
                _contactName.postValue(convo?.contactName)
                _status.postValue(convo?.status)

                if (convo == null) {
                    AppLog.e(TAG, "No conversation found for ${maskPhone(phone)}")
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
                        AppLog.i(TAG, "Messages loaded: ${list.size} for ${maskPhone(phone)}")
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

    fun loadServices() {
        viewModelScope.launch {
            try {
                _services.postValue(repo.getServiceNames())
            } catch (e: Exception) {
                AppLog.e(TAG, "loadServices failed", e)
            }
        }
    }

    fun closeConversation() {
        viewModelScope.launch {
            try {
                repo.closeConversation(phone)
                _status.postValue(Conversation.STATUS_CLOSED)
            } catch (e: Exception) {
                AppLog.e(TAG, "closeConversation failed", e)
                _error.postValue(e.message)
            }
        }
    }

    fun createManualBooking(service: String, dateTime: String) {
        viewModelScope.launch {
            try {
                val result = repo.createManualBooking(phone, service, dateTime)
                if (result.isSuccess) {
                    _status.postValue(Conversation.STATUS_BOOKED)
                    _bookingDone.postValue(true)
                } else {
                    _error.postValue(result.exceptionOrNull()?.message ?: "Registracija nepavyko")
                }
            } catch (e: Exception) {
                AppLog.e(TAG, "createManualBooking failed", e)
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
