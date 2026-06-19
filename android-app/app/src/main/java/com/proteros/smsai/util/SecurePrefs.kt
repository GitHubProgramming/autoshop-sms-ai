package com.proteros.smsai.util

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.proteros.smsai.BuildConfig

object SecurePrefs {
    private const val TAG = "SecurePrefs"
    private const val FILE = "secure_prefs"
    private const val FALLBACK_FILE = "secure_prefs_fallback"
    private const val KEY_API = "claude_api_key"
    private const val KEY_GOOGLE = "google_account"
    private const val KEY_ENABLED = "service_enabled"
    private const val KEY_CALENDAR_ID = "calendar_id"
    private const val KEY_SHEET_ID = "sheet_id"

    @Volatile
    private var cached: SharedPreferences? = null

    private fun prefs(ctx: Context): SharedPreferences {
        cached?.let { return it }
        synchronized(this) {
            cached?.let { return it }
            val appCtx = ctx.applicationContext
            val masterKey = MasterKey.Builder(appCtx)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build()
            val sp = EncryptedSharedPreferences.create(
                appCtx, FILE, masterKey,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
            )
            cached = sp
            return sp
        }
    }

    fun getApiKey(ctx: Context): String? = try {
        prefs(ctx).getString(KEY_API, null)
            ?: BuildConfig.DEFAULT_API_KEY.ifBlank { null }
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

    fun getCalendarId(ctx: Context): String? = try {
        prefs(ctx).getString(KEY_CALENDAR_ID, null)
            ?: BuildConfig.DEFAULT_CALENDAR_ID.ifBlank { null }
    } catch (e: Exception) { Log.e(TAG, "getCalendarId", e); null }

    fun setCalendarId(ctx: Context, id: String) = try {
        prefs(ctx).edit().putString(KEY_CALENDAR_ID, id).apply()
    } catch (e: Exception) { Log.e(TAG, "setCalendarId", e) }

    fun getSheetId(ctx: Context): String? = try {
        prefs(ctx).getString(KEY_SHEET_ID, null)
    } catch (e: Exception) { Log.e(TAG, "getSheetId", e); null }

    fun setSheetId(ctx: Context, id: String) = try {
        prefs(ctx).edit().putString(KEY_SHEET_ID, id).apply()
    } catch (e: Exception) { Log.e(TAG, "setSheetId", e) }
}
