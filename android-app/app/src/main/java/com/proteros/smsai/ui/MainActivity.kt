package com.proteros.smsai.ui

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.util.Log
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.navigation.fragment.NavHostFragment
import androidx.navigation.ui.setupWithNavController
import com.proteros.smsai.R
import com.proteros.smsai.databinding.ActivityMainBinding
import com.proteros.smsai.service.SmsAgentService
import com.proteros.smsai.util.AppLog
import com.proteros.smsai.util.SecurePrefs

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { results ->
        val allGranted = results.all { it.value }
        Log.i("MainActivity", "Permissions result: allGranted=$allGranted, details=$results")

        val denied = results.filter { !it.value }.keys
        if (denied.isNotEmpty()) {
            AppLog.e("MainActivity", "Permissions DENIED: $denied")
            val critical = denied.any {
                it == Manifest.permission.RECEIVE_SMS ||
                it == Manifest.permission.SEND_SMS ||
                it == Manifest.permission.READ_PHONE_STATE
            }
            if (critical) {
                showPermissionRequiredDialog()
            }
        }

        if (allGranted && SecurePrefs.isEnabled(this)) {
            SmsAgentService.start(this)
        }
        checkBatteryOptimization()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        setTheme(R.style.Theme_AutoShopSmsAI)
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        val navHost = supportFragmentManager.findFragmentById(R.id.nav_host_fragment) as NavHostFragment
        binding.bottomNav.setupWithNavController(navHost.navController)

        requestPermissions()
    }

    override fun onResume() {
        super.onResume()
        try {
            val receiveGranted = ContextCompat.checkSelfPermission(this, Manifest.permission.RECEIVE_SMS) == PackageManager.PERMISSION_GRANTED
            val sendGranted = ContextCompat.checkSelfPermission(this, Manifest.permission.SEND_SMS) == PackageManager.PERMISSION_GRANTED
            val phoneGranted = ContextCompat.checkSelfPermission(this, Manifest.permission.READ_PHONE_STATE) == PackageManager.PERMISSION_GRANTED

            AppLog.i("MainActivity", "Permissions check: RECEIVE_SMS=$receiveGranted, SEND_SMS=$sendGranted, READ_PHONE_STATE=$phoneGranted")

            if (!receiveGranted || !sendGranted || !phoneGranted) {
                requestPermissions()
                return
            }

            if (SecurePrefs.isEnabled(this)) {
                SmsAgentService.start(this)
            }
        } catch (e: Exception) {
            Log.e("MainActivity", "onResume service start failed", e)
        }
    }

    private fun requestPermissions() {
        val perms = mutableListOf(
            Manifest.permission.READ_PHONE_STATE,
            Manifest.permission.READ_CALL_LOG,
            Manifest.permission.SEND_SMS,
            Manifest.permission.RECEIVE_SMS,
            Manifest.permission.READ_SMS,
            Manifest.permission.READ_CONTACTS,
            Manifest.permission.READ_PHONE_NUMBERS
        )
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            perms.add(Manifest.permission.POST_NOTIFICATIONS)
        }

        val needed = perms.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }
        AppLog.i("MainActivity", "Permissions needed: $needed")
        if (needed.isNotEmpty()) {
            val canAsk = needed.any { shouldShowRequestPermissionRationale(it) } || needed.isNotEmpty()
            if (needed.all { !shouldShowRequestPermissionRationale(it) } && isPermissionPreviouslyDenied()) {
                showPermissionRequiredDialog()
            } else {
                permissionLauncher.launch(needed.toTypedArray())
            }
        } else {
            AppLog.i("MainActivity", "All permissions already granted")
            checkBatteryOptimization()
            if (SecurePrefs.isEnabled(this)) {
                SmsAgentService.start(this)
            }
        }
    }

    private fun isPermissionPreviouslyDenied(): Boolean {
        val prefs = getSharedPreferences("permission_state", MODE_PRIVATE)
        val asked = prefs.getBoolean("permissions_asked", false)
        if (!asked) {
            prefs.edit().putBoolean("permissions_asked", true).apply()
            return false
        }
        return true
    }

    private fun showPermissionRequiredDialog() {
        AlertDialog.Builder(this)
            .setTitle("Reikalingi leidimai")
            .setMessage("SMS agentas negali veikti be SMS ir skambučių leidimų. Prašome įjungti leidimus nustatymuose.")
            .setPositiveButton("Atidaryti nustatymus") { _, _ ->
                startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                    data = Uri.parse("package:$packageName")
                })
            }
            .setNegativeButton("Vėliau", null)
            .setCancelable(false)
            .show()
    }

    private fun checkBatteryOptimization() {
        val pm = getSystemService(PowerManager::class.java)
        if (!pm.isIgnoringBatteryOptimizations(packageName)) {
            AlertDialog.Builder(this)
                .setTitle("Baterijos optimizavimas")
                .setMessage("Kad SMS agentas veiktų patikimai fone, rekomenduojame išjungti baterijos optimizavimą šiai programai.")
                .setPositiveButton("Tvarkyti") { _, _ ->
                    startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                        data = Uri.parse("package:$packageName")
                    })
                }
                .setNegativeButton("Vėliau", null)
                .show()
        }
    }
}
