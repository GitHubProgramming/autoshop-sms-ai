package com.proteros.smsai.ui

import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.proteros.smsai.R
import com.proteros.smsai.data.Message
import com.proteros.smsai.databinding.ItemMessageAiBinding
import com.proteros.smsai.databinding.ItemMessageClientBinding
import com.proteros.smsai.databinding.ItemMessageOwnerBinding
import com.proteros.smsai.databinding.ItemMessageSystemBinding

class ChatAdapter : ListAdapter<ConversationViewModel.ChatItem, RecyclerView.ViewHolder>(
    object : DiffUtil.ItemCallback<ConversationViewModel.ChatItem>() {
        override fun areItemsTheSame(a: ConversationViewModel.ChatItem, b: ConversationViewModel.ChatItem) = a.timestamp == b.timestamp
        override fun areContentsTheSame(a: ConversationViewModel.ChatItem, b: ConversationViewModel.ChatItem) = a == b
    }
) {
    override fun getItemViewType(position: Int) = when (getItem(position).sender) {
        Message.SENDER_CLIENT -> 0
        Message.SENDER_AI -> 1
        Message.SENDER_OWNER -> 2
        else -> 3
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): RecyclerView.ViewHolder {
        val inflater = LayoutInflater.from(parent.context)
        return when (viewType) {
            0 -> ClientVH(ItemMessageClientBinding.inflate(inflater, parent, false))
            1 -> AiVH(ItemMessageAiBinding.inflate(inflater, parent, false))
            2 -> OwnerVH(ItemMessageOwnerBinding.inflate(inflater, parent, false))
            else -> SystemVH(ItemMessageSystemBinding.inflate(inflater, parent, false))
        }
    }

    override fun onBindViewHolder(holder: RecyclerView.ViewHolder, position: Int) {
        val item = getItem(position)
        when (holder) {
            is ClientVH -> holder.binding.messageText.text = item.text
            is AiVH -> holder.binding.messageText.text = item.text
            is OwnerVH -> holder.binding.messageText.text = item.text
            is SystemVH -> holder.binding.systemText.text = item.text
        }
    }

    class ClientVH(val binding: ItemMessageClientBinding) : RecyclerView.ViewHolder(binding.root)
    class AiVH(val binding: ItemMessageAiBinding) : RecyclerView.ViewHolder(binding.root)
    class OwnerVH(val binding: ItemMessageOwnerBinding) : RecyclerView.ViewHolder(binding.root)
    class SystemVH(val binding: ItemMessageSystemBinding) : RecyclerView.ViewHolder(binding.root)
}
