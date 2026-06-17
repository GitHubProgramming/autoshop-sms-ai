package com.proteros.smsai.util

object PhoneUtils {
    fun normalize(raw: String): String {
        val digits = raw.replace(Regex("[^\\d+]"), "")
        return when {
            digits.startsWith("+370") -> digits
            digits.startsWith("370") -> "+$digits"
            digits.startsWith("8") && digits.length >= 9 -> "+370" + digits.substring(1)
            else -> digits
        }
    }
}
