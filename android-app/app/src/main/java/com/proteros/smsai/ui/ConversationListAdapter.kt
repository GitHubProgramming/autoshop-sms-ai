package com.proteros.smsai.ui

import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.proteros.smsai.databinding.ItemConversationBinding

class ConversationListAdapter(private val onClick: (String) -> Unit) : ListAdapter<AgentViewModel.ConversationItem, ConversationListAdapter.VH>(
    object : DiffUtil.ItemCallback<AgentViewModel.ConversationItem>() {
        override fun areItemsTheSame(a: AgentViewModel.ConversationItem, b: AgentViewModel.ConversationItem) = a.phone == b.phone
        override fun areContentsTheSame(a: AgentViewModel.ConversationItem, b: AgentViewModel.ConversationItem) = a == b
    }
) {
    inner class VH(val binding: ItemConversationBinding) : RecyclerView.ViewHolder(binding.root)

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int) =
        VH(ItemConversationBinding.inflate(LayoutInflater.from(parent.context), parent, false))

    override fun onBindViewHolder(holder: VH, position: Int) {
        val item = getItem(position)
        holder.binding.phoneText.text = item.phone
        holder.binding.lastMessageText.text = item.lastMessage
        holder.binding.statusText.text = item.status
        holder.itemView.setOnClickListener { onClick(item.phone) }
    }
}
