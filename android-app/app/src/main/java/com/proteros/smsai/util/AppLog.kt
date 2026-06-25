package com.proteros.smsai.util

import android.content.Context
import android.util.Log
import com.google.api.client.googleapis.extensions.android.gms.auth.GoogleAccountCredential
import com.google.api.client.http.javanet.NetHttpTransport
import com.google.api.client.json.gson.GsonFactory
import com.google.api.services.sheets.v4.Sheets
import com.google.api.services.sheets.v4.SheetsScopes
import com.google.api.services.sheets.v4.model.AddSheetRequest
import com.google.api.services.sheets.v4.model.BatchUpdateSpreadsheetRequest
import com.google.api.services.sheets.v4.model.Request
import com.google.api.services.sheets.v4.model.SheetProperties
import com.google.api.services.sheets.v4.model.ValueRange
import java.time.LocalDate
import java.time.LocalTime
import java.time.format.DateTimeFormatter
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicBoolean

fun maskPhone(phone: String): String = "***${phone.takeLast(4)}"

object AppLog {
    private val logs = CopyOnWriteArrayList<String>()
    private val pendingSheetLogs = CopyOnWriteArrayList<List<Any>>()
    private val timeFormatter = DateTimeFormatter.ofPattern("HH:mm:ss")
    private val dateFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd")
    private const val MAX = 200
    private const val SHEET_NAME = "Logai"
    private const val FLUSH_THRESHOLD = 5
    private val sheetEnsured = AtomicBoolean(false)
    private val flushing = AtomicBoolean(false)

    private var appContext: Context? = null

    private var deviceEmail: String = ""

    fun init(context: Context) {
        appContext = context.applicationContext
        deviceEmail = SecurePrefs.getGoogleAccount(context)?.substringBefore("@") ?: "?"
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

        pendingSheetLogs.add(listOf(date, time, level, tag, msg, deviceEmail))
        if (pendingSheetLogs.size >= FLUSH_THRESHOLD) {
            flushToSheetAsync()
        }
    }

    private fun buildService(ctx: Context): Sheets? {
        val accountName = SecurePrefs.getGoogleAccount(ctx) ?: return null
        val credential = GoogleAccountCredential.usingOAuth2(
            ctx, listOf(SheetsScopes.SPREADSHEETS)
        ).apply { selectedAccountName = accountName }
        return Sheets.Builder(
            NetHttpTransport(), GsonFactory.getDefaultInstance(), credential
        ).setApplicationName("Proteros SMS AI").build()
    }

    private fun ensureSheetExists(service: Sheets, spreadsheetId: String) {
        if (sheetEnsured.get()) return
        try {
            val spreadsheet = service.spreadsheets().get(spreadsheetId).execute()
            val exists = spreadsheet.sheets.any { it.properties.title == SHEET_NAME }
            if (!exists) {
                val addSheet = Request().setAddSheet(
                    AddSheetRequest().setProperties(
                        SheetProperties().setTitle(SHEET_NAME)
                    )
                )
                service.spreadsheets().batchUpdate(
                    spreadsheetId,
                    BatchUpdateSpreadsheetRequest().setRequests(listOf(addSheet))
                ).execute()

                val header = ValueRange().setValues(listOf(
                    listOf("Data", "Laikas", "Lygis", "Komponentas", "Žinutė", "Įrenginys") as List<Any>
                ))
                service.spreadsheets().values()
                    .append(spreadsheetId, "$SHEET_NAME!A:F", header)
                    .setValueInputOption("RAW")
                    .setInsertDataOption("INSERT_ROWS")
                    .execute()

                Log.i("AppLog", "Created '$SHEET_NAME' sheet with headers")
            }
            sheetEnsured.set(true)
        } catch (e: Exception) {
            Log.e("AppLog", "Failed to ensure sheet: ${e.message}")
        }
    }

    private fun flushToSheetAsync() {
        val ctx = appContext ?: return
        if (pendingSheetLogs.isEmpty()) return
        if (!flushing.compareAndSet(false, true)) return

        val toSend = ArrayList(pendingSheetLogs)
        pendingSheetLogs.clear()

        Thread {
            try {
                val sheetId = SecurePrefs.getSheetId(ctx) ?: return@Thread
                val service = buildService(ctx) ?: return@Thread

                ensureSheetExists(service, sheetId)

                val body = ValueRange().setValues(toSend.map { it as List<Any> })
                service.spreadsheets().values()
                    .append(sheetId, "$SHEET_NAME!A:F", body)
                    .setValueInputOption("RAW")
                    .setInsertDataOption("INSERT_ROWS")
                    .execute()
            } catch (e: Exception) {
                Log.e("AppLog", "Sheet flush failed: ${e.message}")
                pendingSheetLogs.addAll(0, toSend)
            } finally {
                flushing.set(false)
            }
        }.start()
    }

    fun getAll(): String = logs.joinToString("\n")

    fun clear() = logs.clear()
}
