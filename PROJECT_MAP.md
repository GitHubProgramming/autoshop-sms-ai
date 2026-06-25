# PROTEROS SMS AI — Projekto Žemėlapis

> Atnaujinta: 2026-06-25

---

## Pagrindinis Srautas (Core Flow)

```
Praleistas skambutis  ──▶  SMS klientui  ──▶  Kliento atsakymas
        ✅                      ✅                    ✅
                                                       │
        ┌──────────────────────────────────────────────┘
        ▼
   AI pokalbis  ──▶  Booking aptikimas  ──▶  Google Calendar  ──▶  Sheets log
       ✅                  ✅                      ✅                  ✅
```

**Visas srautas veikia nuo galo iki galo.** Klientas paskambina, neatsiliepiam — app siunčia SMS, AI kalbasi, aptinka kada klientas nori atvažiuoti, sukuria kalendoriaus įvykį, viskas loginama į Google Sheets.

---

## Android App — Funkcijos

| # | Funkcija | Statusas | Aprašymas | Failai |
|---|----------|----------|-----------|--------|
| 1 | **SMS gavimas/siuntimas** | ✅ Veikia | Praleistų skambučių aptikimas, SMS siuntimas su retry, dedup 15s langas | `MissedCallReceiver.kt`, `SmsReceiver.kt`, `SmsSender.kt` |
| 2 | **AI pokalbis** | ✅ Veikia | Claude Sonnet 4.6 API, dinaminis promptas iš Sheets, booking regex, 10s cooldown, max 8 žinučių | `ClaudeApiClient.kt` |
| 3 | **Kalendorius** | ✅ Veikia | Google Calendar API, laisvo laiko paieška, konfliktų aptikimas, LT švenčių sąrašas, darbo valandos | `GoogleCalendarClient.kt`, `BusinessCalendar.kt` |
| 4 | **Google Sheets** | ✅ Veikia | Žinių bazė (5 min cache), SMS logai, device statusas, korekcijos, auto-migracija | `GoogleSheetsClient.kt` |
| 5 | **UI ekranai** | ✅ Veikia | 5 fragmentai: Agentas (pokalbių sąrašas), Šiandien (vizitai + dėmesio reik.), Savaitė (kalendorius), Pokalbis (chat), Nustatymai | `MainActivity.kt`, fragmentai |
| 6 | **Notifikacijos** | ✅ Veikia | 4 tipai: vizitas užregistruotas, reikia dėmesio, klientas neatsako 30 min, laiko konfliktas | `AgentNotification.kt` |
| 7 | **Background servisas** | ✅ Veikia | Foreground service, kas 5 min tikrina: refresh, inactivity, status report. Auto-start po boot | `SmsAgentService.kt`, `BootReceiver.kt` |
| 8 | **Auto-update** | ✅ Veikia | Tikrina GitHub releases, parsisiunčia APK, instaliuoja. Semantinis versijų palyginimas | `AppUpdateChecker.kt` |
| 9 | **Savininko valdymas** | ✅ Veikia | Takeover (perimti pokalbį), rankinis booking (data/laikas picker), uždaryti pokalbį, paskambinti klientui | `ConversationFragment.kt` |
| 10 | **Duomenų bazė** | ✅ Veikia | Room DB v4, 4 migracijos. Conversation (active/booked/closed/error), Message (client/ai/owner/system) | `AppDatabase.kt`, `Entities.kt`, `Daos.kt` |
| 11 | **Utilities** | ✅ Veikia | Telefono normalizavimas (8→+370), kontaktų paieška, šifruoti nustatymai, verslo kalendorius | `PhoneUtils.kt`, `ContactLookup.kt`, `SecurePrefs.kt` |
| 12 | **Testai** | ✅ Veikia | 29 unit testai: booking regex (6), verslo kalendorius (16), telefono normalizavimas (7) | `*Test.kt` |

---

## Du Telefonai — Dabartinė Būklė

| | mantas.gipiskis@gmail.com | proteros.servisas@gmail.com |
|---|---|---|
| **Telefonas** | Xiaomi 25078RA3EE | Samsung SM-S906B |
| **Versija** | 1.36 (naujausia) | 1.32 ⚠️ (sena) |
| **Android** | API 35 | API 36 |
| **Agentas** | ✗ Išjungtas | ✓ Įjungtas |
| **Statusas** | Atsinaujino 06-25 13:58 | ⚠️ Atsinaujino 06-23 14:56 |
| **Logai** | Rašo normaliai | Rašo, bet neatskiria nuo mantas logų* |

*Pataisyta — nauja versija pridės "Įrenginys" stulpelį į Logai lapą.

---

## Google Sheets Sistema

| Lapas | Paskirtis | App skaito? | App rašo? | Kas kuria? |
|-------|-----------|:-----------:|:---------:|-----------|
| **Servisas** | Įmonės info (pavadinimas, adresas, darbo laikas) | ✅ | | Apps Script |
| **Paslaugos** | Paslaugų katalogas (pavadinimas, kaina, trukmė) | ✅ | | Apps Script |
| **DUK** | Dažni klausimai ir atsakymai | ✅ | | Apps Script |
| **Taisyklės** | AI elgesio taisyklės | ✅ | | Apps Script |
| **Garantijos** | Garantijų sąlygos | ✅ | | Apps Script |
| **Pataisymai** | AI klaidų korekcijos | ✅ | ✅ | App + savininkas |
| **SMS** | Visų SMS logai (pokalbiai, booking, klaidos) | | ✅ | App |
| **Statusas** | Telefonų būklė (versija, baterija, paskutinis sync) | ✅ | ✅ | App |
| **Logai** | App klaidos ir info logai | | ✅ | App |
| **Dashboard** | Vizuali statistika (KPI, grafikai) | | | Apps Script |
| **Notifikacijos** | Notifikacijų tipų dokumentacija | | | Apps Script |

### Duomenų srautas:
```
Žinių bazė (Servisas, Paslaugos, DUK, Taisyklės, Garantijos)
    │ skaito kas 5 min
    ▼
 Android App ──rašo──▶ SMS lapas ──skaičiuoja──▶ Dashboard
    │                                              (rankinis atnaujinimas)
    ├──rašo──▶ Logai
    ├──rašo──▶ Statusas
    └──R/W───▶ Pataisymai (savininkas taiso, app mokosi)
```

---

## Žinomos Problemos

| # | Prioritetas | Problema | Būklė |
|---|:-----------:|----------|-------|
| 1 | **P1** | proteros.servisas statusas neatsinaujina nuo 06-23 | Fix paruoštas (verbose logging), laukia deploy į telefoną |
| 2 | **P1** | Logai neidentifikuoja kuris telefonas rašo | Fix paruoštas (Įrenginys stulpelis), laukia deploy |
| 3 | **P2** | Samsung baterijos optimizavimas gali užmušti servisą | Reikia pridėti auto-restart + baterijos apsaugą |
| 4 | **P2** | proteros.servisas turi seną versiją (1.32 vs 1.36) | Reikia atnaujinti APK per GitHub releases |
| 5 | **P2** | Dashboard atsinaujina tik rankiniu būdu | Galima pridėti Apps Script trigger (kas valandą) |
| 6 | **P3** | Google Play publikavimas — SMS leidimų kliūtis | Reikia Permissions Declaration Form arba tinklapio distribucija |
| 7 | **P3** | project_status.md pasenęs (mini Twilio/n8n) | Šis dokumentas jį pakeičia |

---

## Ko Dar Trūksta (Ateities Funkcijos)

| Funkcija | Sudėtingumas | Aprašymas |
|----------|:------------:|-----------|
| Google Play publikavimas | Didelis | SMS leidimų deklaracija, release keystore, pašalinti in-app update |
| Automatinis Dashboard refresh | Mažas | Apps Script time-driven trigger kas 1 val |
| Samsung baterijos apsauga | Vidutinis | Aptikti kai servisas sustabdytas, auto-restart, notifikacija savininkui |
| Crash reporting | Vidutinis | Firebase Crashlytics integracija |
| Lithuanian lokalizacija | Mažas | values-lt/strings.xml (dabar hardcoded lietuviškai) |
| Multi-tenant palaikymas | Didelis | Keli servisai vienoje app (šiuo metu tik Proteros) |
| Statistikos eksportas | Mažas | PDF ataskaitos generavimas iš Dashboard duomenų |
| WhatsApp kanalas | Didelis | Alternatyva SMS per WhatsApp Business API |

---

## Sprendimai Reikalingi

1. **Google Play ar tinklapio distribucija?**
   - Google Play: rizika kad atmes dėl SMS leidimų (~50-70% tikimybė praeit)
   - Tinklapis: 100% veiks, bet reikia marketingo
   - Abu: bandyti Play, jei atmes — tinklapiu

2. **Automatinis Dashboard refresh?**
   - Dabar: rankinis — paleisk `setupDashboard()` Apps Script'e
   - Galima: Apps Script trigger kas valandą (lengva pridėti)

3. **proteros.servisas telefonas** — atnaujinti iki 1.36 ir patikrinti ar status reporting veikia

---

## Versijos ir Technologijos

| Komponentas | Versija / Technologija |
|-------------|----------------------|
| Android app | v1.36, minSdk 26, targetSdk 35 |
| AI modelis | Claude Sonnet 4.6 (Anthropic API) |
| Duomenų bazė | Room (SQLite) v4 |
| Kalendorius | Google Calendar API v3 |
| Sheets | Google Sheets API v4 |
| Programavimo kalba | Kotlin |
| Build sistema | Gradle |
| Atnaujinimai | GitHub Releases (APK) |
| Logai | Google Sheets "Logai" lapas |
| Šifravimas | EncryptedSharedPreferences (AES256) |
