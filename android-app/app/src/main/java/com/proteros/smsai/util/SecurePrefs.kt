package com.proteros.smsai.util

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

object SecurePrefs {
    private const val FILE = "secure_prefs"
    private const val KEY_API = "claude_api_key"
    private const val KEY_GOOGLE = "google_account"
    private const val KEY_ENABLED = "service_enabled"

    private fun prefs(ctx: Context): SharedPreferences {
        val masterKey = MasterKey.Builder(ctx).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build()
        return EncryptedSharedPreferences.create(
            ctx, FILE, masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    }

    fun getApiKey(ctx: Context): String? = prefs(ctx).getString(KEY_API, null)
    fun setApiKey(ctx: Context, key: String) = prefs(ctx).edit().putString(KEY_API, key).apply()

    fun getGoogleAccount(ctx: Context): String? = prefs(ctx).getString(KEY_GOOGLE, null)
    fun setGoogleAccount(ctx: Context, account: String) = prefs(ctx).edit().putString(KEY_GOOGLE, account).apply()

    fun isEnabled(ctx: Context): Boolean = prefs(ctx).getBoolean(KEY_ENABLED, false)
    fun setEnabled(ctx: Context, enabled: Boolean) = prefs(ctx).edit().putBoolean(KEY_ENABLED, enabled).apply()
}
