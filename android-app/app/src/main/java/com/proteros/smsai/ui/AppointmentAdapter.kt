package com.proteros.smsai.ui

import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.proteros.smsai.databinding.ItemAppointmentBinding

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
        holder.binding.timeText.text = item.time
        holder.binding.clientText.text = item.client
        holder.binding.serviceText.text = item.service
    }
}
