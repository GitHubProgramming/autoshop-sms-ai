package com.proteros.smsai.ui

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.EditText
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.fragment.app.Fragment
import com.google.android.gms.auth.api.signin.GoogleSignIn
import com.google.android.gms.auth.api.signin.GoogleSignInOptions
import com.google.android.gms.common.api.Scope
import com.google.api.services.calendar.CalendarScopes
import com.proteros.smsai.databinding.FragmentSettingsBinding
import com.proteros.smsai.service.SmsAgentService
import com.proteros.smsai.util.SecurePrefs

class SettingsFragment : Fragment() {

    private var _binding: FragmentSettingsBinding? = null
    private val binding get() = _binding!!

    private val googleSignInLauncher = registerForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.StartActivityForResult()
    ) { result ->
        val task = GoogleSignIn.getSignedInAccountFromIntent(result.data)
        try {
            val account = task.getResult(com.google.android.gms.common.api.ApiException::class.java)
            account.email?.let {
                SecurePrefs.setGoogleAccount(requireContext(), it)
                binding.googleAccountValue.text = it
            }
        } catch (e: Exception) {
            Toast.makeText(context, "Prisijungimas nepavyko: ${e.message}", Toast.LENGTH_LONG).show()
        }
    }

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        _binding = FragmentSettingsBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        val ctx = requireContext()

        binding.switchService.isChecked = SecurePrefs.isEnabled(ctx)
        binding.switchService.setOnCheckedChangeListener { _, checked ->
            try {
                SecurePrefs.setEnabled(ctx, checked)
                if (checked) SmsAgentService.start(ctx) else SmsAgentService.stop(ctx)
            } catch (e: Exception) {
                android.util.Log.e("SettingsFragment", "Service toggle failed", e)
                Toast.makeText(ctx, "Klaida: ${e.message}", Toast.LENGTH_LONG).show()
            }
        }

        val apiKey = SecurePrefs.getApiKey(ctx)
        binding.apiKeyValue.text = if (apiKey.isNullOrBlank()) "Nenustatytas" else "•••${apiKey.takeLast(4)}"
        binding.apiKeyCard.setOnClickListener {
            val input = EditText(ctx).apply { hint = "sk-ant-..." }
            AlertDialog.Builder(ctx)
                .setTitle("Claude API raktas")
                .setView(input)
                .setPositiveButton("Išsaugoti") { _, _ ->
                    val key = input.text.toString().trim()
                    if (key.isNotEmpty()) {
                        SecurePrefs.setApiKey(ctx, key)
                        binding.apiKeyValue.text = "•••${key.takeLast(4)}"
                    }
                }
                .setNegativeButton("Atšaukti", null)
                .show()
        }

        val googleAcc = SecurePrefs.getGoogleAccount(ctx)
        binding.googleAccountValue.text = googleAcc ?: "Neprisijungta"
        binding.googleAccountCard.setOnClickListener {
            val gso = GoogleSignInOptions.Builder(GoogleSignInOptions.DEFAULT_SIGN_IN)
                .requestEmail()
                .requestScopes(Scope(CalendarScopes.CALENDAR))
                .build()
            val client = GoogleSignIn.getClient(requireActivity(), gso)
            googleSignInLauncher.launch(client.signInIntent)
        }

        binding.versionText.text = "Versija 1.0.0 • Proteros SMS AI"
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}
