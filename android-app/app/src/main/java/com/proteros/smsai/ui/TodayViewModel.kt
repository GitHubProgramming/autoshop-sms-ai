package com.proteros.smsai.ui

import android.app.Application
import androidx.lifecycle.*
import com.proteros.smsai.AutoShopApp
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
            val today = calendarClient.getTodayAppointments()
            _appointments.postValue(today.map { a ->
                AppointmentItem(time = a.time, client = a.clientPhone, service = a.service)
            })
        }
    }

    fun checkServiceStatus(app: Application) {
        _serviceActive.value = SecurePrefs.isEnabled(app)
    }

    class Factory(private val repo: AppRepository) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = TodayViewModel(repo) as T
    }
}
