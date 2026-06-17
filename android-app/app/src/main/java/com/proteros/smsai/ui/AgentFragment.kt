package com.proteros.smsai.ui

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.fragment.app.Fragment
import androidx.fragment.app.viewModels
import androidx.navigation.fragment.findNavController
import androidx.recyclerview.widget.LinearLayoutManager
import com.proteros.smsai.AutoShopApp
import com.proteros.smsai.databinding.FragmentAgentListBinding

class AgentFragment : Fragment() {

    private var _binding: FragmentAgentListBinding? = null
    private val binding get() = _binding!!
    private val viewModel: AgentViewModel by viewModels {
        AgentViewModel.Factory((requireActivity().application as AutoShopApp).repository)
    }

    private val adapter = ConversationListAdapter { phone ->
        findNavController().navigate(
            AgentFragmentDirections.actionAgentToConversation(phone)
        )
    }

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        _binding = FragmentAgentListBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        binding.recyclerConversations.layoutManager = LinearLayoutManager(context)
        binding.recyclerConversations.adapter = adapter

        viewModel.conversations.observe(viewLifecycleOwner) { list ->
            adapter.submitList(list)
            binding.emptyText.visibility = if (list.isEmpty()) View.VISIBLE else View.GONE
        }
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}
