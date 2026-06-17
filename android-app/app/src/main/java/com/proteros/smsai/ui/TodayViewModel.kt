package com.proteros.smsai.ui

import android.app.Application
import androidx.lifecycle.*
import com.proteros.smsai.api.GoogleCalendarClient
import com.proteros.smsai.data.AppRepository
import com.proteros.smsai.data.Conversation
import com.proteros.smsai.data.Message
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

    init {
        viewModelScope.launch {
            repo.conversationDao.getNeedingAttentionFlow().collect { convos ->
                _attention.postValue(convos.map { c ->
                    AttentionItem(
                        phone = c.phoneNumber,
                        reason = c.errorMessage ?: if (c.status == Conversation.STATUS_ERROR) "SMS klaida" else "Laukia atsakymo"
                    )
                })
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
                android.util.Log.e("TodayViewModel", "Failed to load appointments", e)
            }
        }
    }

    fun checkServiceStatus(app: Application) {
        _serviceActive.value = SecurePrefs.isEnabled(app)
    }

    fun refreshStats() {
        viewModelScope.launch {
            repo.conversationDao.getAllFlow().collect { convos ->
                _conversationCount.postValue(convos.size)
                // Count today's AI messages as SMS sent
                var smsCount = 0
                for (c in convos) {
                    val startOfDay = java.util.Calendar.getInstance().apply {
                        set(java.util.Calendar.HOUR_OF_DAY, 0)
                        set(java.util.Calendar.MINUTE, 0)
                        set(java.util.Calendar.SECOND, 0)
                    }.timeInMillis
                    if (c.updatedAt >= startOfDay) smsCount++
                }
                _todaySmsCount.postValue(smsCount)
            }
        }
    }

    class Factory(private val repo: AppRepository) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = TodayViewModel(repo) as T
    }
}
