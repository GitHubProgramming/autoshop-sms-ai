package com.proteros.smsai.ui

import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.proteros.smsai.databinding.ItemAttentionBinding

class AttentionAdapter(private val onClick: (String) -> Unit) : ListAdapter<TodayViewModel.AttentionItem, AttentionAdapter.VH>(
    object : DiffUtil.ItemCallback<TodayViewModel.AttentionItem>() {
        override fun areItemsTheSame(a: TodayViewModel.AttentionItem, b: TodayViewModel.AttentionItem) = a.phone == b.phone
        override fun areContentsTheSame(a: TodayViewModel.AttentionItem, b: TodayViewModel.AttentionItem) = a == b
    }
) {
    inner class VH(val binding: ItemAttentionBinding) : RecyclerView.ViewHolder(binding.root)

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int) =
        VH(ItemAttentionBinding.inflate(LayoutInflater.from(parent.context), parent, false))

    override fun onBindViewHolder(holder: VH, position: Int) {
        val item = getItem(position)
        holder.binding.phoneText.text = item.phone
        holder.binding.reasonText.text = item.reason
        holder.itemView.setOnClickListener { onClick(item.phone) }
    }
}
