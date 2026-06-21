package com.proteros.smsai.ui

import com.proteros.smsai.BuildConfig
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
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
import com.google.api.services.sheets.v4.SheetsScopes
import com.proteros.smsai.AutoShopApp
import com.proteros.smsai.data.Conversation
import com.proteros.smsai.data.Message
import com.proteros.smsai.databinding.FragmentSettingsBinding
import com.proteros.smsai.service.SmsAgentService
import com.proteros.smsai.util.AppLog
import com.proteros.smsai.util.AppUpdateChecker
import com.proteros.smsai.util.SecurePrefs
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

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
            if (_binding == null) return@setOnCheckedChangeListener
            try {
                val appCtx = ctx.applicationContext
                SecurePrefs.setEnabled(appCtx, checked)
                if (checked) SmsAgentService.start(appCtx) else SmsAgentService.stop(appCtx)
            } catch (e: Exception) {
                AppLog.e("SettingsFragment", "Service toggle failed", e)
                try { Toast.makeText(ctx, "Klaida: ${e.message}", Toast.LENGTH_LONG).show() } catch (_: Exception) {}
            }
        }

        val apiKey = SecurePrefs.getApiKey(ctx)
        binding.apiKeyValue.text = if (apiKey.isNullOrBlank()) "Nenustatytas" else "•••${apiKey.takeLast(8)}"
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
                .requestServerAuthCode(getString(com.proteros.smsai.R.string.google_web_client_id))
                .requestScopes(Scope(CalendarScopes.CALENDAR), Scope(SheetsScopes.SPREADSHEETS))
                .build()
            val client = GoogleSignIn.getClient(requireActivity(), gso)
            googleSignInLauncher.launch(client.signInIntent)
        }

        val calId = SecurePrefs.getCalendarId(ctx)
        binding.calendarIdValue.text = if (calId.isNullOrBlank()) "Nenustatytas (naudojamas asmeninis)" else calId
        binding.calendarIdCard.setOnClickListener {
            val input = EditText(ctx).apply {
                hint = "abc123@group.calendar.google.com"
                calId?.let { setText(it) }
            }
            AlertDialog.Builder(ctx)
                .setTitle("Kalendoriaus ID")
                .setMessage("Įveskite Google Calendar ID iš kalendoriaus nustatymų.")
                .setView(input)
                .setPositiveButton("Išsaugoti") { _, _ ->
                    val id = input.text.toString().trim()
                    if (id.isNotEmpty()) {
                        SecurePrefs.setCalendarId(ctx, id)
                        binding.calendarIdValue.text = id
                    }
                }
                .setNegativeButton("Atšaukti", null)
                .show()
        }

        val sheetId = SecurePrefs.getSheetId(ctx)
        binding.sheetIdValue.text = if (sheetId.isNullOrBlank()) "Nenustatytas (naudojamos numatytosios žinios)" else "✓ Prijungta"
        binding.sheetIdCard.setOnClickListener {
            val input = EditText(ctx).apply {
                hint = "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms"
                sheetId?.let { setText(it) }
            }
            AlertDialog.Builder(ctx)
                .setTitle("Žinių bazės Sheet ID")
                .setMessage("Įveskite Google Sheet ID. Jį rasite Sheet nuorodoje tarp /d/ ir /edit.\n\nPvz: docs.google.com/spreadsheets/d/SHEET_ID/edit")
                .setView(input)
                .setPositiveButton("Išsaugoti") { _, _ ->
                    val id = input.text.toString().trim()
                    if (id.isNotEmpty()) {
                        SecurePrefs.setSheetId(ctx, id)
                        binding.sheetIdValue.text = id
                    }
                }
                .setNegativeButton("Atšaukti", null)
                .show()
        }

        val versionName = try {
            ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionName
        } catch (_: Exception) { "?" }
        binding.versionText.text = "Versija $versionName • Proteros Servisas"

        CoroutineScope(Dispatchers.IO).launch {
            val update = AppUpdateChecker.checkForUpdate(ctx)
            if (update != null && _binding != null) {
                withContext(Dispatchers.Main) {
                    if (_binding == null) return@withContext
                    binding.versionText.text = "Versija $versionName → ${update.versionName} galima!"
                    AlertDialog.Builder(ctx)
                        .setTitle("Atnaujinimas")
                        .setMessage("Yra nauja versija ${update.versionName}. Atnaujinti?")
                        .setPositiveButton("Atnaujinti") { _, _ ->
                            AppUpdateChecker.downloadAndInstall(ctx, update)
                            Toast.makeText(ctx, "Parsisiunčiama...", Toast.LENGTH_SHORT).show()
                        }
                        .setNegativeButton("Vėliau", null)
                        .show()
                }
            }
        }

        binding.btnCheckUpdate.setOnClickListener {
            binding.btnCheckUpdate.isEnabled = false
            binding.btnCheckUpdate.text = "Tikrinama..."
            CoroutineScope(Dispatchers.IO).launch {
                val update = AppUpdateChecker.checkForUpdate(ctx)
                withContext(Dispatchers.Main) {
                    if (_binding == null) return@withContext
                    binding.btnCheckUpdate.isEnabled = true
                    binding.btnCheckUpdate.text = "Tikrinti atnaujinimus"
                    if (update != null) {
                        binding.versionText.text = "Versija $versionName → ${update.versionName} galima!"
                        AlertDialog.Builder(ctx)
                            .setTitle("Atnaujinimas")
                            .setMessage("Yra nauja versija ${update.versionName}. Atnaujinti?")
                            .setPositiveButton("Atnaujinti") { _, _ ->
                                AppUpdateChecker.downloadAndInstall(ctx, update)
                                Toast.makeText(ctx, "Parsisiunčiama...", Toast.LENGTH_SHORT).show()
                            }
                            .setNegativeButton("Vėliau", null)
                            .show()
                    } else {
                        Toast.makeText(ctx, "Naujausia versija ($versionName)", Toast.LENGTH_SHORT).show()
                    }
                }
            }
        }

        binding.btnShowLogs.setOnClickListener {
            val logScroll = binding.logScroll
            if (logScroll.visibility == View.GONE) {
                val logs = AppLog.getAll()
                binding.logText.text = if (logs.isBlank()) "Logų nėra" else logs
                logScroll.visibility = View.VISIBLE
                binding.btnShowLogs.text = "Kopijuoti ir slėpti logus"
            } else {
                val clipboard = ctx.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                clipboard.setPrimaryClip(ClipData.newPlainText("logs", binding.logText.text))
                Toast.makeText(ctx, "Logai nukopijuoti", Toast.LENGTH_SHORT).show()
                logScroll.visibility = View.GONE
                binding.btnShowLogs.text = "Rodyti logus"
            }
        }

        binding.btnClearData.setOnClickListener {
            AlertDialog.Builder(ctx)
                .setTitle("Išvalyti duomenis?")
                .setMessage("Visi pokalbiai ir žinutės bus ištrintos.")
                .setPositiveButton("Išvalyti") { _, _ ->
                    val app = ctx.applicationContext as AutoShopApp
                    CoroutineScope(Dispatchers.IO).launch {
                        try {
                            val convos = app.repository.conversationDao.getAllOnce()
                            for (c in convos) {
                                app.repository.messageDao.deleteForConversation(c.phoneNumber)
                                app.repository.conversationDao.delete(c.phoneNumber)
                            }
                            AppLog.clear()
                            AppLog.i("Debug", "All data cleared")
                            withContext(Dispatchers.Main) {
                                Toast.makeText(ctx, "Duomenys išvalyti", Toast.LENGTH_SHORT).show()
                            }
                        } catch (e: Exception) {
                            AppLog.e("Debug", "Clear data failed", e)
                            withContext(Dispatchers.Main) {
                                Toast.makeText(ctx, "Klaida: ${e.message}", Toast.LENGTH_LONG).show()
                            }
                        }
                    }
                }
                .setNegativeButton("Atšaukti", null)
                .show()
        }
    }

    override fun onResume() {
        super.onResume()
        AppUpdateChecker.retryPendingIfReady(requireContext())
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}
