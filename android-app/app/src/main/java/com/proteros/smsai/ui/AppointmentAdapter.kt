package com.proteros.smsai.ui

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.proteros.smsai.databinding.ItemAppointmentBinding
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale

class AppointmentAdapter : ListAdapter<TodayViewModel.AppointmentItem, AppointmentAdapter.VH>(
    object : DiffUtil.ItemCallback<TodayViewModel.AppointmentItem>() {
        override fun areItemsTheSame(a: TodayViewModel.AppointmentItem, b: TodayViewModel.AppointmentItem) = a.time == b.time && a.client == b.client
        override fun areContentsTheSame(a: TodayViewModel.AppointmentItem, b: TodayViewModel.AppointmentItem) = a == b
    }
) {
    inner class VH(val binding: ItemAppointmentBinding) : RecyclerView.ViewHolder(binding.root)

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int) =
        VH(ItemAppointmentBinding.inflate(LayoutInflater.from(parent.context), parent, false))

    override fun onBindViewHolder(holder: VH, position: Int) {
        val item = getItem(position)
        holder.binding.serviceText.text = item.service
        if (!item.contactName.isNullOrBlank()) {
            holder.binding.contactNameText.text = item.contactName
            holder.binding.contactNameText.visibility = View.VISIBLE
            holder.binding.clientText.text = item.client
        } else {
            holder.binding.contactNameText.visibility = View.GONE
            holder.binding.clientText.text = item.client
        }
        holder.binding.timeText.text = formatTime(item.time)
    }

    private fun formatTime(raw: String): String {
        return try {
            val dt = LocalDateTime.parse(raw, DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm"))
            val day = dt.format(DateTimeFormatter.ofPattern("EEEE", Locale("lt")))
                .replaceFirstChar { it.uppercaseChar() }
            val date = dt.format(DateTimeFormatter.ofPattern("MM-dd HH:mm"))
            "$day\n$date"
        } catch (_: Exception) {
            raw
        }
    }
}
