package com.proteros.smsai.ui

import android.annotation.SuppressLint
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.animation.AlphaAnimation
import androidx.appcompat.app.AppCompatActivity
import com.proteros.smsai.R
import com.proteros.smsai.databinding.ActivitySplashBinding

@SuppressLint("CustomSplashScreen")
class SplashActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val binding = ActivitySplashBinding.inflate(layoutInflater)
        setContentView(binding.root)

        try {
            val version = packageManager.getPackageInfo(packageName, 0).versionName
            binding.splashVersion.text = "v$version"
        } catch (_: Exception) {}

        binding.iconContainer.startAnimation(AlphaAnimation(0f, 1f).apply { duration = 600 })
        binding.splashSubtitle.startAnimation(AlphaAnimation(0f, 1f).apply {
            duration = 600
            startOffset = 300
        })

        Handler(Looper.getMainLooper()).postDelayed({
            startActivity(Intent(this, MainActivity::class.java))
            overridePendingTransition(android.R.anim.fade_in, android.R.anim.fade_out)
            finish()
        }, 1500)
    }
}
