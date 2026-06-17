package com.proteros.smsai.ui

import android.os.Bundle
import com.proteros.smsai.util.AppLog
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Toast
import androidx.fragment.app.Fragment
import androidx.fragment.app.viewModels
import androidx.navigation.fragment.findNavController
import androidx.navigation.fragment.navArgs
import androidx.recyclerview.widget.LinearLayoutManager
import com.proteros.smsai.AutoShopApp
import com.proteros.smsai.databinding.FragmentConversationBinding

class ConversationFragment : Fragment() {

    private var _binding: FragmentConversationBinding? = null
    private val binding get() = _binding!!
    private val args: ConversationFragmentArgs by navArgs()
    private val viewModel: ConversationViewModel by viewModels {
        ConversationViewModel.Factory(
            (requireActivity().application as AutoShopApp).repository, args.phoneNumber
        )
    }

    private lateinit var chatAdapter: ChatAdapter

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        _binding = FragmentConversationBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        AppLog.i("ConversationFragment", "onViewCreated for phone: ${args.phoneNumber}")

        chatAdapter = ChatAdapter()

        binding.toolbarTitle.text = args.phoneNumber
        binding.recyclerMessages.layoutManager = LinearLayoutManager(context).apply {
            stackFromEnd = true
        }
        binding.recyclerMessages.adapter = chatAdapter

        binding.btnBack.setOnClickListener { findNavController().navigateUp() }

        binding.btnTakeover.setOnClickListener {
            viewModel.toggleTakeover()
        }

        binding.btnSend.setOnClickListener {
            val text = binding.editMessage.text.toString().trim()
            if (text.isNotEmpty()) {
                viewModel.sendOwnerMessage(text)
                binding.editMessage.text?.clear()
            }
        }

        viewModel.messages.observe(viewLifecycleOwner) { list ->
            AppLog.i("ConversationFragment", "Messages observer: ${list.size} items")
            chatAdapter.submitList(list.toList()) {
                if (list.isNotEmpty()) {
                    binding.recyclerMessages.post {
                        binding.recyclerMessages.scrollToPosition(list.size - 1)
                    }
                }
            }
        }

        viewModel.isTakeover.observe(viewLifecycleOwner) { takeover ->
            binding.btnTakeover.text = if (takeover) "Grąžinti AI" else "Perimti"
            binding.takeoverBanner.visibility = if (takeover) View.VISIBLE else View.GONE
            binding.inputContainer.visibility = if (takeover) View.VISIBLE else View.GONE
        }

        viewModel.error.observe(viewLifecycleOwner) { err ->
            if (err != null) Toast.makeText(context, err, Toast.LENGTH_LONG).show()
        }
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}
