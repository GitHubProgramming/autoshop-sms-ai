package com.proteros.smsai.ui

import android.app.AlertDialog
import android.app.DatePickerDialog
import android.app.TimePickerDialog
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import com.proteros.smsai.util.AppLog
import com.proteros.smsai.util.maskPhone
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ArrayAdapter
import android.widget.LinearLayout
import android.widget.Spinner
import android.widget.TextView
import android.widget.Toast
import androidx.fragment.app.Fragment
import androidx.fragment.app.viewModels
import androidx.navigation.fragment.findNavController
import androidx.navigation.fragment.navArgs
import androidx.recyclerview.widget.LinearLayoutManager
import com.proteros.smsai.AutoShopApp
import com.proteros.smsai.databinding.FragmentConversationBinding
import java.util.Calendar

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
        AppLog.i("ConversationFragment", "onViewCreated for phone: ${maskPhone(args.phoneNumber)}")

        chatAdapter = ChatAdapter()

        binding.toolbarTitle.text = args.phoneNumber
        viewModel.contactName.observe(viewLifecycleOwner) { name ->
            if (!name.isNullOrBlank()) {
                binding.toolbarTitle.text = name
                binding.toolbarSubtitle.text = args.phoneNumber
                binding.toolbarSubtitle.visibility = View.VISIBLE
            }
        }
        binding.recyclerMessages.layoutManager = LinearLayoutManager(context).apply {
            stackFromEnd = true
        }
        binding.recyclerMessages.adapter = chatAdapter

        binding.btnBack.setOnClickListener { findNavController().navigateUp() }

        binding.toolbarSubtitle.setOnClickListener {
            val intent = Intent(Intent.ACTION_DIAL, Uri.parse("tel:${args.phoneNumber}"))
            startActivity(intent)
        }

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

        binding.btnFailed.setOnClickListener {
            AlertDialog.Builder(requireContext())
                .setTitle("Uždaryti pokalbį?")
                .setMessage("Pokalbis bus pažymėtas kaip nepavykęs.")
                .setPositiveButton("Uždaryti") { _, _ -> viewModel.closeConversation() }
                .setNegativeButton("Atšaukti", null)
                .show()
        }

        binding.btnBooked.setOnClickListener {
            viewModel.loadServices()
            showBookingDialog()
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
            updateActionButtons()
        }

        viewModel.status.observe(viewLifecycleOwner) { status ->
            val isClosed = status == "closed" || status == "booked"
            binding.btnTakeover.visibility = if (isClosed) View.GONE else View.VISIBLE
            updateActionButtons()
        }

        viewModel.bookingDone.observe(viewLifecycleOwner) { done ->
            if (done) Toast.makeText(context, "Vizitas užregistruotas!", Toast.LENGTH_LONG).show()
        }

        viewModel.error.observe(viewLifecycleOwner) { err ->
            if (err != null) Toast.makeText(context, err, Toast.LENGTH_LONG).show()
        }

        // Show phone number as clickable even without contact name
        binding.toolbarSubtitle.text = args.phoneNumber
        binding.toolbarSubtitle.visibility = View.VISIBLE
    }

    private fun updateActionButtons() {
        val b = _binding ?: return
        val takeover = viewModel.isTakeover.value == true
        val status = viewModel.status.value
        val show = takeover && status != "booked" && status != "closed"
        b.actionButtonsContainer.visibility = if (show) View.VISIBLE else View.GONE
    }

    private fun showBookingDialog() {
        val ctx = requireContext()
        val cal = Calendar.getInstance()
        var selectedDate = ""
        var selectedTime = ""

        val layout = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(48, 32, 48, 16)
        }

        val serviceSpinner = Spinner(ctx)
        val serviceLabel = TextView(ctx).apply { text = "Paslauga:" }
        layout.addView(serviceLabel)
        layout.addView(serviceSpinner)

        val dateBtn = TextView(ctx).apply {
            text = "Pasirinkti datą"
            textSize = 16f
            setPadding(0, 24, 0, 8)
            setTextColor(resources.getColor(android.R.color.holo_blue_dark, null))
        }
        layout.addView(dateBtn)

        val timeBtn = TextView(ctx).apply {
            text = "Pasirinkti laiką"
            textSize = 16f
            setPadding(0, 16, 0, 8)
            setTextColor(resources.getColor(android.R.color.holo_blue_dark, null))
        }
        layout.addView(timeBtn)

        dateBtn.setOnClickListener {
            DatePickerDialog(ctx, { _, y, m, d ->
                selectedDate = "%04d-%02d-%02d".format(y, m + 1, d)
                dateBtn.text = selectedDate
            }, cal.get(Calendar.YEAR), cal.get(Calendar.MONTH), cal.get(Calendar.DAY_OF_MONTH)).show()
        }

        timeBtn.setOnClickListener {
            TimePickerDialog(ctx, { _, h, m ->
                selectedTime = "%02d:%02d".format(h, m)
                timeBtn.text = selectedTime
            }, 9, 0, true).show()
        }

        val dialog = AlertDialog.Builder(ctx)
            .setTitle("Registruoti vizitą")
            .setView(layout)
            .setPositiveButton("Registruoti", null)
            .setNegativeButton("Atšaukti", null)
            .create()

        viewModel.services.observe(viewLifecycleOwner) { list ->
            if (list.isNotEmpty()) {
                serviceSpinner.adapter = ArrayAdapter(ctx, android.R.layout.simple_spinner_dropdown_item, list)
            }
        }

        dialog.setOnShowListener {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                if (selectedDate.isEmpty() || selectedTime.isEmpty()) {
                    Toast.makeText(ctx, "Pasirinkite datą ir laiką", Toast.LENGTH_SHORT).show()
                    return@setOnClickListener
                }
                val service = serviceSpinner.selectedItem?.toString() ?: "Nenurodyta"
                viewModel.createManualBooking(service, "$selectedDate $selectedTime")
                dialog.dismiss()
            }
        }

        dialog.show()
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}
