package com.proteros.smsai.api

import android.content.Context
import com.google.api.client.googleapis.extensions.android.gms.auth.GoogleAccountCredential
import com.google.api.client.http.javanet.NetHttpTransport
import com.google.api.client.json.gson.GsonFactory
import com.google.api.services.sheets.v4.Sheets
import com.google.api.services.sheets.v4.SheetsScopes
import com.proteros.smsai.util.AppLog
import com.proteros.smsai.util.SecurePrefs
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

class GoogleSheetsClient(private val context: Context) {

    data class ServiceInfo(
        val name: String,
        val description: String,
        val price: String,
        val durationMin: Int
    )

    data class KnowledgeBase(
        val businessName: String = "Proteros Servisas",
        val address: String = "Aukštaičių g. 29-2, Panevėžys",
        val workingHours: String = "I-V 8:00-17:00",
        val phone: String = "",
        val visitDuration: Int = 60,
        val greeting: String = DEFAULT_GREETING,
        val maxAiTurns: Int = 8,
        val agentGoal: String = "Kuo greičiau susitarti dėl vizito laiko",
        val customPrompt: String = "",
        val services: List<ServiceInfo> = DEFAULT_SERVICES,
        val faq: List<Pair<String, String>> = emptyList(),
        val rules: List<String> = DEFAULT_RULES,
        val warranties: List<Pair<String, String>> = emptyList(),
        val fetchedAt: Long = 0
    )

    @Volatile
    private var cached: KnowledgeBase? = null
    private val CACHE_TTL = 5 * 60 * 1000L

    private fun getService(): Sheets? {
        val accountName = SecurePrefs.getGoogleAccount(context) ?: return null
        val credential = GoogleAccountCredential.usingOAuth2(
            context, listOf(SheetsScopes.SPREADSHEETS)
        ).apply { selectedAccountName = accountName }

        return Sheets.Builder(
            NetHttpTransport(), GsonFactory.getDefaultInstance(), credential
        ).setApplicationName("Proteros SMS AI").build()
    }

    suspend fun getKnowledge(): KnowledgeBase {
        val mem = cached
        if (mem != null && System.currentTimeMillis() - mem.fetchedAt < CACHE_TTL) return mem

        val disk = loadFromDisk()
        if (disk != null && System.currentTimeMillis() - disk.fetchedAt < CACHE_TTL) {
            cached = disk
            return disk
        }

        val fetched = fetchFromSheet()
        if (fetched != null) {
            cached = fetched
            saveToDisk(fetched)
            AppLog.i(TAG, "Loaded knowledge base from Sheet")
            return fetched
        }

        if (disk != null) {
            cached = disk
            AppLog.i(TAG, "Using stale disk cache")
            return disk
        }

        val default = defaultKnowledgeBase()
        cached = default
        return default
    }

    private suspend fun fetchFromSheet(): KnowledgeBase? = withContext(Dispatchers.IO) {
        try {
            val sheetId = SecurePrefs.getSheetId(context)
            if (sheetId.isNullOrBlank()) return@withContext null

            val service = getService() ?: return@withContext null

            val ranges = listOf(
                "Servisas!A2:B12",
                "Paslaugos!A2:D50",
                "DUK!A2:B50",
                "Taisyklės!A2:A50",
                "Garantijos ir sąlygos!A2:B50"
            )

            val response = service.spreadsheets().values()
                .batchGet(sheetId)
                .setRanges(ranges)
                .execute()

            val valueRanges = response.valueRanges ?: return@withContext null

            val infoRows = valueRanges.getOrNull(0)?.getValues() ?: emptyList()
            val serviceRows = valueRanges.getOrNull(1)?.getValues() ?: emptyList()
            val faqRows = valueRanges.getOrNull(2)?.getValues() ?: emptyList()
            val ruleRows = valueRanges.getOrNull(3)?.getValues() ?: emptyList()
            val warrantyRows = valueRanges.getOrNull(4)?.getValues() ?: emptyList()

            val info = mutableMapOf<String, String>()
            for (row in infoRows) {
                if (row.size >= 2) {
                    val key = row[0]?.toString()?.trim() ?: continue
                    val value = row[1]?.toString()?.trim() ?: continue
                    if (key.isNotBlank() && value.isNotBlank()) info[key] = value
                }
            }

            val services = serviceRows.mapNotNull { row ->
                val name = row.getOrNull(0)?.toString()?.trim() ?: return@mapNotNull null
                if (name.isBlank() || name.startsWith("*")) return@mapNotNull null
                ServiceInfo(
                    name = name,
                    description = row.getOrNull(1)?.toString()?.trim() ?: "",
                    price = row.getOrNull(2)?.toString()?.trim() ?: "Pagal apžiūrą",
                    durationMin = row.getOrNull(3)?.toString()?.trim()?.toIntOrNull() ?: 60
                )
            }

            val faq = faqRows.mapNotNull { row ->
                val q = row.getOrNull(0)?.toString()?.trim() ?: return@mapNotNull null
                val a = row.getOrNull(1)?.toString()?.trim() ?: return@mapNotNull null
                if (q.isBlank() || q.startsWith("*") || a.isBlank()) return@mapNotNull null
                q to a
            }

            val rules = ruleRows.mapNotNull { row ->
                val r = row.getOrNull(0)?.toString()?.trim() ?: return@mapNotNull null
                if (r.isBlank() || r.startsWith("*")) null else r
            }

            val warranties = warrantyRows.mapNotNull { row ->
                val t = row.getOrNull(0)?.toString()?.trim() ?: return@mapNotNull null
                val v = row.getOrNull(1)?.toString()?.trim() ?: return@mapNotNull null
                if (t.isBlank() || t.startsWith("*")) return@mapNotNull null
                t to v
            }

            KnowledgeBase(
                businessName = info["Įmonės pavadinimas"] ?: "Proteros Servisas",
                address = info["Adresas"] ?: "Aukštaičių g. 29-2, Panevėžys",
                workingHours = info["Darbo laikas"] ?: "I-V 8:00-17:00",
                phone = info["Telefono numeris"] ?: "",
                visitDuration = info["Vizito trukmė (min)"]?.toIntOrNull() ?: 60,
                greeting = info["Pasisveikinimo žinutė"] ?: DEFAULT_GREETING,
                maxAiTurns = info["Max žinučių skaičius"]?.toIntOrNull() ?: 8,
                agentGoal = info["Agento tikslas"] ?: "Kuo greičiau susitarti dėl vizito laiko",
                customPrompt = info["Papildomas promptas"] ?: "",
                services = if (services.isNotEmpty()) services else DEFAULT_SERVICES.map {
                    ServiceInfo(it.name, it.description, "Pagal apžiūrą", 60)
                },
                faq = faq,
                rules = if (rules.isNotEmpty()) rules else DEFAULT_RULES,
                warranties = warranties,
                fetchedAt = System.currentTimeMillis()
            )
        } catch (e: Exception) {
            AppLog.e(TAG, "fetchFromSheet failed", e)
            null
        }
    }

    private fun saveToDisk(kb: KnowledgeBase) {
        try {
            val json = JSONObject().apply {
                put("businessName", kb.businessName)
                put("address", kb.address)
                put("workingHours", kb.workingHours)
                put("phone", kb.phone)
                put("visitDuration", kb.visitDuration)
                put("greeting", kb.greeting)
                put("maxAiTurns", kb.maxAiTurns)
                put("agentGoal", kb.agentGoal)
                put("customPrompt", kb.customPrompt)
                put("services", JSONArray().apply {
                    kb.services.forEach { s ->
                        put(JSONObject().put("name", s.name).put("desc", s.description)
                            .put("price", s.price).put("dur", s.durationMin))
                    }
                })
                put("faq", JSONArray().apply {
                    kb.faq.forEach { put(JSONObject().put("q", it.first).put("a", it.second)) }
                })
                put("rules", JSONArray().apply { kb.rules.forEach { put(it) } })
                put("warranties", JSONArray().apply {
                    kb.warranties.forEach { put(JSONObject().put("t", it.first).put("v", it.second)) }
                })
                put("fetchedAt", kb.fetchedAt)
            }
            context.getSharedPreferences(CACHE_PREFS, Context.MODE_PRIVATE)
                .edit().putString(CACHE_KEY, json.toString()).apply()
        } catch (e: Exception) {
            AppLog.e(TAG, "saveToDisk failed", e)
        }
    }

    private fun loadFromDisk(): KnowledgeBase? {
        try {
            val str = context.getSharedPreferences(CACHE_PREFS, Context.MODE_PRIVATE)
                .getString(CACHE_KEY, null) ?: return null
            val j = JSONObject(str)
            val servicesArr = j.optJSONArray("services") ?: JSONArray()
            val faqArr = j.optJSONArray("faq") ?: JSONArray()
            val rulesArr = j.optJSONArray("rules") ?: JSONArray()
            val warArr = j.optJSONArray("warranties") ?: JSONArray()

            return KnowledgeBase(
                businessName = j.optString("businessName", "Proteros Servisas"),
                address = j.optString("address", "Aukštaičių g. 29-2, Panevėžys"),
                workingHours = j.optString("workingHours", "I-V 8:00-17:00"),
                phone = j.optString("phone", ""),
                visitDuration = j.optInt("visitDuration", 60),
                greeting = j.optString("greeting", DEFAULT_GREETING),
                maxAiTurns = j.optInt("maxAiTurns", 8),
                agentGoal = j.optString("agentGoal", "Kuo greičiau susitarti dėl vizito laiko"),
                customPrompt = j.optString("customPrompt", ""),
                services = (0 until servicesArr.length()).map { i ->
                    val s = servicesArr.getJSONObject(i)
                    ServiceInfo(s.getString("name"), s.optString("desc", ""),
                        s.optString("price", "Pagal apžiūrą"), s.optInt("dur", 60))
                },
                faq = (0 until faqArr.length()).map { i ->
                    val f = faqArr.getJSONObject(i)
                    f.getString("q") to f.getString("a")
                },
                rules = (0 until rulesArr.length()).map { rulesArr.getString(it) },
                warranties = (0 until warArr.length()).map { i ->
                    val w = warArr.getJSONObject(i)
                    w.getString("t") to w.getString("v")
                },
                fetchedAt = j.optLong("fetchedAt", 0)
            )
        } catch (e: Exception) {
            AppLog.e(TAG, "loadFromDisk failed", e)
            return null
        }
    }

    fun invalidateCache() {
        cached = null
    }

    suspend fun logEvent(type: String, phone: String, message: String, aiReply: String? = null, contactName: String? = null) {
        withContext(Dispatchers.IO) {
            try {
                val sheetId = SecurePrefs.getSheetId(context)
                if (sheetId.isNullOrBlank()) return@withContext

                val service = getService() ?: return@withContext

                val now = java.time.LocalDateTime.now()
                val formatter = java.time.format.DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss")

                val row = listOf<Any>(
                    now.format(formatter),
                    contactName ?: "",
                    phone,
                    type,
                    message.take(500),
                    (aiReply ?: "").take(500)
                )

                try {
                    service.spreadsheets().values()
                        .append(sheetId, "$SMS_SHEET!A:F",
                            com.google.api.services.sheets.v4.model.ValueRange()
                                .setValues(listOf(row)))
                        .setValueInputOption("RAW")
                        .setInsertDataOption("INSERT_ROWS")
                        .execute()
                } catch (e: com.google.api.client.googleapis.json.GoogleJsonResponseException) {
                    if (e.statusCode == 400 && e.message?.contains("Unable to parse range") == true) {
                        createSmsSheet(service, sheetId)
                        service.spreadsheets().values()
                            .append(sheetId, "$SMS_SHEET!A:F",
                                com.google.api.services.sheets.v4.model.ValueRange()
                                    .setValues(listOf(row)))
                            .setValueInputOption("RAW")
                            .setInsertDataOption("INSERT_ROWS")
                            .execute()
                    } else throw e
                }
            } catch (e: Exception) {
                AppLog.e(TAG, "logEvent failed", e)
            }
        }
    }

    private fun createSmsSheet(service: Sheets, sheetId: String) {
        val addSheet = com.google.api.services.sheets.v4.model.BatchUpdateSpreadsheetRequest()
            .setRequests(listOf(
                com.google.api.services.sheets.v4.model.Request()
                    .setAddSheet(com.google.api.services.sheets.v4.model.AddSheetRequest()
                        .setProperties(com.google.api.services.sheets.v4.model.SheetProperties()
                            .setTitle(SMS_SHEET)))
            ))
        service.spreadsheets().batchUpdate(sheetId, addSheet).execute()

        val header = listOf<Any>("Data", "Vardas", "Telefonas", "Tipas", "Kliento žinutė", "AI atsakymas")
        service.spreadsheets().values()
            .update(sheetId, "$SMS_SHEET!A1:F1",
                com.google.api.services.sheets.v4.model.ValueRange()
                    .setValues(listOf(header)))
            .setValueInputOption("RAW")
            .execute()
    }

    suspend fun reportDeviceStatus(context: Context) = withContext(Dispatchers.IO) {
        try {
            val sheetId = SecurePrefs.getSheetId(context) ?: return@withContext
            val email = SecurePrefs.getGoogleAccount(context) ?: return@withContext

            val service = getService() ?: return@withContext

            val colIndex = findDeviceColumn(service, sheetId, email)

            val versionName = try {
                context.packageManager.getPackageInfo(context.packageName, 0).versionName ?: "?"
            } catch (_: Exception) { "?" }

            val labels = listOf(
                email, "",
                "Versija", versionName,
                "Telefonas", "${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL}",
                "Android", "API ${android.os.Build.VERSION.SDK_INT}",
                "Agentas", if (SecurePrefs.isEnabled(context)) "✓ Įjungta" else "✗ Išjungta",
                "API key", if (!SecurePrefs.getApiKey(context).isNullOrBlank()) "✓ Yra" else "✗ Nėra",
                "Google acc", "✓ $email",
                "Calendar ID", if (!SecurePrefs.getCalendarId(context).isNullOrBlank()) "✓ Yra" else "✗ Nėra",
                "Sheet ID", "✓ Yra",
                "Atnaujinta", java.time.LocalDateTime.now().format(java.time.format.DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm"))
            )

            val rows = labels.chunked(2).map { it as List<Any> }
            val colLetter = colLetters(colIndex)
            val colLetter2 = colLetters(colIndex + 1)
            val range = "$STATUS_SHEET!${colLetter}4:${colLetter2}13"

            service.spreadsheets().values()
                .update(sheetId, range,
                    com.google.api.services.sheets.v4.model.ValueRange().setValues(rows))
                .setValueInputOption("RAW")
                .execute()

            AppLog.i(TAG, "Device status reported for $email")
        } catch (e: Exception) {
            AppLog.e(TAG, "reportDeviceStatus failed", e)
        }
    }

    suspend fun checkRefreshRequested(context: Context): Boolean = withContext(Dispatchers.IO) {
        try {
            val sheetId = SecurePrefs.getSheetId(context) ?: return@withContext false
            val service = getService() ?: return@withContext false

            val result = service.spreadsheets().values()
                .get(sheetId, "$STATUS_SHEET!C4")
                .execute()
            val value = result.getValues()?.firstOrNull()?.firstOrNull()?.toString()?.trim() ?: ""

            if (value.equals("REFRESH", ignoreCase = true)) {
                service.spreadsheets().values()
                    .update(sheetId, "$STATUS_SHEET!C4",
                        com.google.api.services.sheets.v4.model.ValueRange().setValues(listOf(listOf(""))))
                    .setValueInputOption("RAW")
                    .execute()
                return@withContext true
            }
            false
        } catch (e: Exception) {
            AppLog.e(TAG, "checkRefreshRequested failed", e)
            false
        }
    }

    private fun findDeviceColumn(service: Sheets, sheetId: String, email: String): Int {
        try {
            val result = service.spreadsheets().values()
                .get(sheetId, "$STATUS_SHEET!D4:Z4")
                .execute()
            val row = result.getValues()?.firstOrNull() ?: return 3
            for (i in row.indices) {
                if (row[i]?.toString()?.trim().equals(email, ignoreCase = true)) {
                    return 3 + i
                }
            }
            for (i in row.indices step 2) {
                if (row.getOrNull(i)?.toString().isNullOrBlank()) return 3 + i
            }
            return 3 + row.size + (if (row.size % 2 == 0) 0 else 1)
        } catch (_: Exception) {
            return 3
        }
    }

    private fun colLetters(index: Int): String {
        var i = index
        val sb = StringBuilder()
        while (i >= 0) {
            sb.insert(0, ('A' + i % 26))
            i = i / 26 - 1
        }
        return sb.toString()
    }


    companion object {
        private const val STATUS_SHEET = "Statusas"
        private const val SMS_SHEET = "SMS"
        private const val TAG = "SheetsClient"
        private const val CACHE_PREFS = "sheets_cache"
        private const val CACHE_KEY = "knowledge_base"

        const val DEFAULT_GREETING = "Sveiki! Čia Proteros Servisas. Atsiprašome, kad dabar negalėjome atsiliepti. Aprašykite automobilio problemą ir norimą vizito laiką — ir mes iškart pasiūlysime artimiausią laisvą laiką."

        val DEFAULT_SERVICES = listOf(
            ServiceInfo("Važiuoklės remontas", "Amortizatoriai, šarnyrai, guoliai", "Pagal apžiūrą", 60),
            ServiceInfo("Variklio diagnostika", "Kompiuterinė diagnostika", "Pagal apžiūrą", 30),
            ServiceInfo("Stabdžių sistema", "Kaladėlės, diskai, skystis", "Pagal apžiūrą", 60),
            ServiceInfo("Pakabos remontas", "Šarnyrai, silent blokai", "Pagal apžiūrą", 60),
            ServiceInfo("Techninė apžiūra", "Paruošimas TA", "Pagal apžiūrą", 60),
            ServiceInfo("Kompiuterinė diagnostika", "Klaidų skaitymas", "Pagal apžiūrą", 30),
            ServiceInfo("Tepalų keitimas", "Variklio, pavarų dėžės tepalai", "Pagal apžiūrą", 30),
        )

        val DEFAULT_RULES = listOf(
            "NIEKADA nesakyk tikslios kainos",
            "Būk trumpas — max 2-3 sakiniai",
            "Atsakyk max 100 simbolių",
        )

        fun defaultKnowledgeBase() = KnowledgeBase(fetchedAt = System.currentTimeMillis())
    }
}
