package com.proteros.smsai.util

import android.content.Context
import android.util.Log
import com.google.api.client.googleapis.extensions.android.gms.auth.GoogleAccountCredential
import com.google.api.client.http.javanet.NetHttpTransport
import com.google.api.client.json.gson.GsonFactory
import com.google.api.services.sheets.v4.Sheets
import com.google.api.services.sheets.v4.SheetsScopes
import com.google.api.services.sheets.v4.model.ValueRange
import java.time.LocalDate
import java.time.LocalTime
import java.time.format.DateTimeFormatter
import java.util.concurrent.CopyOnWriteArrayList

object AppLog {
    private val logs = CopyOnWriteArrayList<String>()
    private val pendingSheetLogs = CopyOnWriteArrayList<List<Any>>()
    private val timeFormatter = DateTimeFormatter.ofPattern("HH:mm:ss")
    private val dateFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd")
    private const val MAX = 200
    private const val SHEET_NAME = "Logai"
    private const val FLUSH_THRESHOLD = 5

    private var appContext: Context? = null

    fun init(context: Context) {
        appContext = context.applicationContext
    }

    fun i(tag: String, msg: String) {
        Log.i(tag, msg)
        add("I", tag, msg)
    }

    fun e(tag: String, msg: String, t: Throwable? = null) {
        Log.e(tag, msg, t)
        val err = if (t != null) "$msg | ${t::class.simpleName}: ${t.message}" else msg
        add("E", tag, err)
        flushToSheetAsync()
    }

    fun w(tag: String, msg: String) {
        Log.w(tag, msg)
        add("W", tag, msg)
    }

    private fun add(level: String, tag: String, msg: String) {
        val time = LocalTime.now().format(timeFormatter)
        val date = LocalDate.now().format(dateFormatter)
        logs.add("$time [$level] $tag: $msg")
        while (logs.size > MAX) logs.removeAt(0)

        pendingSheetLogs.add(listOf(date, time, level, tag, msg))
        if (pendingSheetLogs.size >= FLUSH_THRESHOLD) {
            flushToSheetAsync()
        }
    }

    private fun flushToSheetAsync() {
        val ctx = appContext ?: return
        if (pendingSheetLogs.isEmpty()) return

        val toSend = ArrayList(pendingSheetLogs)
        pendingSheetLogs.clear()

        Thread {
            try {
                val accountName = SecurePrefs.getGoogleAccount(ctx) ?: return@Thread
                val sheetId = SecurePrefs.getSheetId(ctx) ?: return@Thread

                val credential = GoogleAccountCredential.usingOAuth2(
                    ctx, listOf(SheetsScopes.SPREADSHEETS)
                ).apply { selectedAccountName = accountName }

                val service = Sheets.Builder(
                    NetHttpTransport(), GsonFactory.getDefaultInstance(), credential
                ).setApplicationName("Proteros SMS AI").build()

                val body = ValueRange().setValues(toSend.map { it as List<Any> })
                service.spreadsheets().values()
                    .append(sheetId, "$SHEET_NAME!A:E", body)
                    .setValueInputOption("RAW")
                    .setInsertDataOption("INSERT_ROWS")
                    .execute()
            } catch (e: Exception) {
                Log.e("AppLog", "Sheet flush failed: ${e.message}")
                pendingSheetLogs.addAll(0, toSend)
            }
        }.start()
    }

    fun getAll(): String = logs.joinToString("\n")

    fun clear() = logs.clear()
}
