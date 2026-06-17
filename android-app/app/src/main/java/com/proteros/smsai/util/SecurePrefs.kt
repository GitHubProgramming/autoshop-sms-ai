package com.proteros.smsai.util

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

object SecurePrefs {
    private const val TAG = "SecurePrefs"
    private const val FILE = "secure_prefs"
    private const val FALLBACK_FILE = "secure_prefs_fallback"
    private const val KEY_API = "claude_api_key"
    private const val KEY_GOOGLE = "google_account"
    private const val KEY_ENABLED = "service_enabled"

    @Volatile
    private var cached: SharedPreferences? = null

    private fun prefs(ctx: Context): SharedPreferences {
        cached?.let { return it }
        synchronized(this) {
            cached?.let { return it }
            val appCtx = ctx.applicationContext
            val sp = try {
                val masterKey = MasterKey.Builder(appCtx)
                    .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                    .build()
                EncryptedSharedPreferences.create(
                    appCtx, FILE, masterKey,
                    EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                    EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
                )
            } catch (e: Exception) {
                Log.e(TAG, "EncryptedSharedPreferences failed, using fallback", e)
                appCtx.getSharedPreferences(FALLBACK_FILE, Context.MODE_PRIVATE)
            }
            cached = sp
            return sp
        }
    }

    fun getApiKey(ctx: Context): String? = try {
        prefs(ctx).getString(KEY_API, null)
    } catch (e: Exception) { Log.e(TAG, "getApiKey", e); null }

    fun setApiKey(ctx: Context, key: String) = try {
        prefs(ctx).edit().putString(KEY_API, key).apply()
    } catch (e: Exception) { Log.e(TAG, "setApiKey", e) }

    fun getGoogleAccount(ctx: Context): String? = try {
        prefs(ctx).getString(KEY_GOOGLE, null)
    } catch (e: Exception) { Log.e(TAG, "getGoogleAccount", e); null }

    fun setGoogleAccount(ctx: Context, account: String) = try {
        prefs(ctx).edit().putString(KEY_GOOGLE, account).apply()
    } catch (e: Exception) { Log.e(TAG, "setGoogleAccount", e) }

    fun isEnabled(ctx: Context): Boolean = try {
        prefs(ctx).getBoolean(KEY_ENABLED, false)
    } catch (e: Exception) { Log.e(TAG, "isEnabled", e); false }

    fun setEnabled(ctx: Context, enabled: Boolean) = try {
        prefs(ctx).edit().putBoolean(KEY_ENABLED, enabled).apply()
    } catch (e: Exception) { Log.e(TAG, "setEnabled", e) }
}
