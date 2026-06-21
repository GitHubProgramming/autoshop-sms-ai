package com.proteros.smsai.ui

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.fragment.app.Fragment
import androidx.fragment.app.viewModels
import androidx.navigation.fragment.findNavController
import androidx.recyclerview.widget.LinearLayoutManager
import com.proteros.smsai.R
import com.proteros.smsai.AutoShopApp
import com.proteros.smsai.api.GoogleCalendarClient
import com.proteros.smsai.databinding.FragmentTodayBinding

class TodayFragment : Fragment() {

    private var _binding: FragmentTodayBinding? = null
    private val binding get() = _binding!!
    private val viewModel: TodayViewModel by viewModels {
        TodayViewModel.Factory((requireActivity().application as AutoShopApp).repository)
    }

    private val appointmentAdapter = AppointmentAdapter()
    private val attentionAdapter = AttentionAdapter { phone ->
        findNavController().navigate(
            TodayFragmentDirections.actionTodayToConversation(phone)
        )
    }
    private val activeConvoAdapter = ConversationListAdapter { phone ->
        findNavController().navigate(
            TodayFragmentDirections.actionTodayToConversation(phone)
        )
    }

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        _binding = FragmentTodayBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        binding.recyclerAppointments.layoutManager = LinearLayoutManager(context)
        binding.recyclerAppointments.adapter = appointmentAdapter
        binding.recyclerAttention.layoutManager = LinearLayoutManager(context)
        binding.recyclerAttention.adapter = attentionAdapter
        binding.recyclerActiveConvos.layoutManager = LinearLayoutManager(context)
        binding.recyclerActiveConvos.adapter = activeConvoAdapter

        viewModel.activeConversations.observe(viewLifecycleOwner) { list ->
            activeConvoAdapter.submitList(list)
            binding.sectionActiveConvos.visibility = if (list.isEmpty()) View.GONE else View.VISIBLE
            binding.recyclerActiveConvos.visibility = if (list.isEmpty()) View.GONE else View.VISIBLE
        }

        viewModel.appointments.observe(viewLifecycleOwner) { list ->
            appointmentAdapter.submitList(list)
            binding.emptyAppointments.visibility = if (list.isEmpty()) View.VISIBLE else View.GONE
        }

        viewModel.attention.observe(viewLifecycleOwner) { list ->
            attentionAdapter.submitList(list)
            binding.sectionAttention.visibility = if (list.isEmpty()) View.GONE else View.VISIBLE
            binding.recyclerAttention.visibility = if (list.isEmpty()) View.GONE else View.VISIBLE
        }

        viewModel.serviceActive.observe(viewLifecycleOwner) { active ->
            binding.statusIndicator.text = if (active) "● Įjungta" else "○ Išjungta"
            binding.statusIndicator.setBackgroundResource(
                if (active) R.drawable.bg_status_active else R.drawable.bg_status_inactive
            )
            binding.statusIndicator.setTextColor(
                resources.getColor(if (active) android.R.color.white else R.color.text_secondary, null)
            )
        }

        viewModel.conversationCount.observe(viewLifecycleOwner) { count ->
            binding.statConversations.text = count.toString()
        }

        viewModel.bookedCount.observe(viewLifecycleOwner) { count ->
            binding.statSmsSent.text = count.toString()
        }
    }

    override fun onResume() {
        super.onResume()
        viewModel.checkServiceStatus(requireActivity().application)
        try {
            viewModel.refreshAppointments(GoogleCalendarClient(requireContext()))
        } catch (_: Exception) { }
        viewModel.refreshStats()
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}
