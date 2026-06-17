package com.proteros.smsai.util

import android.util.Log
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.CopyOnWriteArrayList

object AppLog {
    private val logs = CopyOnWriteArrayList<String>()
    private val sdf = SimpleDateFormat("HH:mm:ss", Locale.getDefault())
    private const val MAX = 200

    fun i(tag: String, msg: String) {
        Log.i(tag, msg)
        add("I", tag, msg)
    }

    fun e(tag: String, msg: String, t: Throwable? = null) {
        Log.e(tag, msg, t)
        val err = if (t != null) "$msg | ${t::class.simpleName}: ${t.message}" else msg
        add("E", tag, err)
    }

    fun w(tag: String, msg: String) {
        Log.w(tag, msg)
        add("W", tag, msg)
    }

    private fun add(level: String, tag: String, msg: String) {
        val time = sdf.format(Date())
        logs.add("$time [$level] $tag: $msg")
        while (logs.size > MAX) logs.removeAt(0)
    }

    fun getAll(): String = logs.joinToString("\n")

    fun clear() = logs.clear()
}
