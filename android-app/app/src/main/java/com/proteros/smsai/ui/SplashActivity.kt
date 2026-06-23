package com.proteros.smsai.ui

import android.annotation.SuppressLint
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.animation.AlphaAnimation
import android.view.animation.AnimationSet
import android.view.animation.DecelerateInterpolator
import android.view.animation.ScaleAnimation
import androidx.appcompat.app.AppCompatActivity
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

        val iconAnim = AnimationSet(true).apply {
            interpolator = DecelerateInterpolator()
            addAnimation(AlphaAnimation(0f, 1f).apply { duration = 500 })
            addAnimation(ScaleAnimation(0.8f, 1f, 0.8f, 1f, 1, 0.5f, 1, 0.5f).apply { duration = 500 })
        }
        binding.iconRing.startAnimation(iconAnim)

        binding.splashTitle.startAnimation(AlphaAnimation(0f, 1f).apply { duration = 400; startOffset = 250 })
        binding.splashDivider.startAnimation(AlphaAnimation(0f, 1f).apply { duration = 400; startOffset = 400 })
        binding.splashTagline.startAnimation(AlphaAnimation(0f, 1f).apply { duration = 400; startOffset = 500 })

        Handler(Looper.getMainLooper()).postDelayed({
            startActivity(Intent(this, MainActivity::class.java))
            overridePendingTransition(android.R.anim.fade_in, android.R.anim.fade_out)
            finish()
        }, 1800)
    }
}
