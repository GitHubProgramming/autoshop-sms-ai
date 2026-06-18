package com.proteros.smsai.util

object PhoneUtils {
    fun normalize(raw: String): String {
        val cleaned = raw.replace(Regex("[^\\d+]"), "")
        val digits = cleaned.trimStart('+')
        return when {
            digits.startsWith("370") -> "+$digits"
            digits.startsWith("8") && digits.length >= 9 -> "+370${digits.substring(1)}"
            cleaned.startsWith("+") -> cleaned
            digits.length >= 7 -> "+$digits"
            else -> cleaned
        }
    }
}
