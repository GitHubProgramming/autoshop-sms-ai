package com.proteros.smsai.ui

import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.core.content.ContextCompat
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.proteros.smsai.R
import android.view.View
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
        if (!item.contactName.isNullOrBlank()) {
            holder.binding.contactNameText.text = item.contactName
            holder.binding.contactNameText.visibility = View.VISIBLE
            holder.binding.phoneText.text = item.phone
        } else {
            holder.binding.contactNameText.visibility = View.GONE
            holder.binding.phoneText.text = item.phone
            holder.binding.phoneText.setTextSize(android.util.TypedValue.COMPLEX_UNIT_SP, 15f)
            holder.binding.phoneText.setTypeface(null, android.graphics.Typeface.BOLD)
            holder.binding.phoneText.setTextColor(ContextCompat.getColor(holder.itemView.context, R.color.text_primary))
        }
        holder.binding.lastMessageText.text = item.lastMessage.ifEmpty { "Pokalbis pradėtas..." }
        holder.binding.statusText.text = item.status

        val bgColor = when {
            item.status == "Užregistruotas" -> android.R.color.holo_green_dark
            item.status == "Klaida" -> android.R.color.holo_red_dark
            item.isOwnerTakeover -> android.R.color.holo_orange_dark
            else -> R.color.primary
        }
        holder.binding.statusText.background.setTint(
            ContextCompat.getColor(holder.itemView.context, bgColor)
        )

        holder.itemView.setOnClickListener { onClick(item.phone) }
    }
}
