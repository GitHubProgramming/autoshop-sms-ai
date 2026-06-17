package com.proteros.smsai.ui

import android.app.Application
import android.util.Log
import androidx.lifecycle.*
import com.proteros.smsai.api.GoogleCalendarClient
import com.proteros.smsai.data.AppRepository
import com.proteros.smsai.data.Conversation
import com.proteros.smsai.util.SecurePrefs
import kotlinx.coroutines.launch

class TodayViewModel(private val repo: AppRepository) : ViewModel() {

    data class AppointmentItem(val time: String, val client: String, val service: String)
    data class AttentionItem(val phone: String, val reason: String)

    private val _appointments = MutableLiveData<List<AppointmentItem>>(emptyList())
    val appointments: LiveData<List<AppointmentItem>> = _appointments

    private val _attention = MutableLiveData<List<AttentionItem>>(emptyList())
    val attention: LiveData<List<AttentionItem>> = _attention

    private val _serviceActive = MutableLiveData(false)
    val serviceActive: LiveData<Boolean> = _serviceActive

    private val _conversationCount = MutableLiveData(0)
    val conversationCount: LiveData<Int> = _conversationCount

    private val _todaySmsCount = MutableLiveData(0)
    val todaySmsCount: LiveData<Int> = _todaySmsCount

    val activeConversations: LiveData<List<AgentViewModel.ConversationItem>> =
        repo.conversationDao.getAllFlow().asLiveData().map { list ->
            list.filter { it.status == Conversation.STATUS_ACTIVE || it.status == Conversation.STATUS_ERROR }
                .map { c ->
                    AgentViewModel.ConversationItem(
                        phone = c.phoneNumber,
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
                Log.e("TodayViewModel", "Attention flow error", e)
            }
        }
    }

    fun refreshAppointments(calendarClient: GoogleCalendarClient) {
        viewModelScope.launch {
            try {
                val today = calendarClient.getTodayAppointments()
                _appointments.postValue(today.map { a ->
                    AppointmentItem(time = a.time, client = a.clientPhone, service = a.service)
                })
            } catch (e: Exception) {
                Log.e("TodayViewModel", "Failed to load appointments", e)
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
                    var smsCount = 0
                    val startOfDay = java.util.Calendar.getInstance().apply {
                        set(java.util.Calendar.HOUR_OF_DAY, 0)
                        set(java.util.Calendar.MINUTE, 0)
                        set(java.util.Calendar.SECOND, 0)
                    }.timeInMillis
                    for (c in convos) {
                        if (c.updatedAt >= startOfDay) smsCount++
                    }
                    _todaySmsCount.postValue(smsCount)
                }
            } catch (e: Exception) {
                Log.e("TodayViewModel", "refreshStats error", e)
            }
        }
    }

    class Factory(private val repo: AppRepository) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = TodayViewModel(repo) as T
    }
}
