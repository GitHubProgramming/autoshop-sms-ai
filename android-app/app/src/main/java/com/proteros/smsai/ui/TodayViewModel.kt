package com.proteros.smsai.ui

import android.app.Application
import androidx.lifecycle.*
import com.proteros.smsai.api.GoogleCalendarClient
import com.proteros.smsai.data.AppRepository
import com.proteros.smsai.data.Conversation
import com.proteros.smsai.util.AppLog
import com.proteros.smsai.util.SecurePrefs
import kotlinx.coroutines.launch

class TodayViewModel(private val repo: AppRepository) : ViewModel() {

    data class AppointmentItem(val time: String, val client: String, val contactName: String?, val service: String)
    data class AttentionItem(val phone: String, val reason: String)

    private val _appointments = MutableLiveData<List<AppointmentItem>>(emptyList())
    val appointments: LiveData<List<AppointmentItem>> = _appointments

    private val _attention = MutableLiveData<List<AttentionItem>>(emptyList())
    val attention: LiveData<List<AttentionItem>> = _attention

    private val _serviceActive = MutableLiveData(false)
    val serviceActive: LiveData<Boolean> = _serviceActive

    private val _conversationCount = MutableLiveData(0)
    val conversationCount: LiveData<Int> = _conversationCount

    private val _bookedCount = MutableLiveData(0)
    val bookedCount: LiveData<Int> = _bookedCount

    private val _calendarError = MutableLiveData<String?>(null)
    val calendarError: LiveData<String?> = _calendarError

    val activeConversations: LiveData<List<AgentViewModel.ConversationItem>> =
        repo.conversationDao.getAllFlow().asLiveData().map { list ->
            list.filter { it.status == Conversation.STATUS_ACTIVE || it.status == Conversation.STATUS_ERROR }
                .map { c ->
                    AgentViewModel.ConversationItem(
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

    init {
        viewModelScope.launch {
            try {
                repo.conversationDao.getNeedingAttentionFlow().collect { convos ->
                    _attention.postValue(convos.map { c ->
                        AttentionItem(
                            phone = c.phoneNumber,
                            reason = c.errorMessage ?: if (c.status == Conversation.STATUS_ERROR) "SMS klaida" else "Laukia atsakymo"
                        )
                    })
                }
            } catch (e: Exception) {
                AppLog.e("TodayViewModel", "Attention flow error", e)
            }
        }

        viewModelScope.launch {
            try {
                repo.conversationDao.getBookedFlow().collect { booked ->
                    _appointments.postValue(booked.map { c ->
                        AppointmentItem(
                            time = c.bookingDateTime ?: "Nenurodyta",
                            client = c.phoneNumber,
                            contactName = c.contactName,
                            service = c.bookingService ?: "Nenurodyta"
                        )
                    })
                }
            } catch (e: Exception) {
                AppLog.e("TodayViewModel", "Booked flow error", e)
            }
        }
    }

    fun refreshAppointments(calendarClient: GoogleCalendarClient) {
        viewModelScope.launch {
            try {
                val result = calendarClient.getTodayAppointmentsWithStatus()
                _calendarError.postValue(result.error)
                _appointments.postValue(result.appointments.map { a ->
                    AppointmentItem(time = a.time, client = a.clientPhone, contactName = a.contactName, service = a.service)
                })
            } catch (e: Exception) {
                AppLog.e("TodayViewModel", "Failed to load calendar appointments", e)
                _calendarError.postValue(e.message)
            }
        }
    }

    fun checkServiceStatus(app: Application) {
        _serviceActive.value = SecurePrefs.isEnabled(app)
    }

    fun refreshStats() {
        viewModelScope.launch {
            try {
                repo.conversationDao.getAllFlow().collect { convos ->
                    _conversationCount.postValue(convos.size)
                    _bookedCount.postValue(convos.count { it.status == Conversation.STATUS_BOOKED })
                }
            } catch (e: Exception) {
                AppLog.e("TodayViewModel", "refreshStats error", e)
            }
        }
    }

    class Factory(private val repo: AppRepository) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = TodayViewModel(repo) as T
    }
}
