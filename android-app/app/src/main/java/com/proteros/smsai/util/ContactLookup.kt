package com.proteros.smsai.util

import android.content.Context
import android.net.Uri
import android.provider.ContactsContract

object ContactLookup {

    fun findName(context: Context, phone: String): String? {
        return try {
            val uri = Uri.withAppendedPath(
                ContactsContract.PhoneLookup.CONTENT_FILTER_URI,
                Uri.encode(phone)
            )
            context.contentResolver.query(
                uri,
                arrayOf(ContactsContract.PhoneLookup.DISPLAY_NAME),
                null, null, null
            )?.use { cursor ->
                if (cursor.moveToFirst()) {
                    cursor.getString(0)?.takeIf { it.isNotBlank() }
                } else null
            }
        } catch (e: Exception) {
            AppLog.e("ContactLookup", "Failed to lookup $phone", e)
            null
        }
    }
}
