package com.proteros.smsai.util

import android.util.Log
import java.time.LocalTime
import java.time.format.DateTimeFormatter
import java.util.concurrent.CopyOnWriteArrayList

object AppLog {
    private val logs = CopyOnWriteArrayList<String>()
    private val timeFormatter = DateTimeFormatter.ofPattern("HH:mm:ss")
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
        val time = LocalTime.now().format(timeFormatter)
        logs.add("$time [$level] $tag: $msg")
        while (logs.size > MAX) logs.removeAt(0)
    }

    fun getAll(): String = logs.joinToString("\n")

    fun clear() = logs.clear()
}
