/**
 * PROTEROS SERVISAS — Dashboard
 *
 * INSTRUKCIJA:
 * 1. Atidaryk savo Proteros žinių bazės Sheet'ą
 * 2. Viršuje paspausk: Extensions → Apps Script
 * 3. Ištrink esamą kodą ir įklijuok visą šį kodą į Kodas.gs
 * 4. Viršuje pasirink funkciją: setupDashboard
 * 5. Paspausk ▶ Run
 * 6. Leisk prieigą kai paprašys
 *
 * SVARBU: Šis skriptas keičia TIK Dashboard lapą.
 * Kiti lapai (SMS, Pataisymai, Servisas ir kt.) neliečiami.
 */

function setupDashboard() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  Logger.log("=== PRADEDAME DASHBOARD SETUP ===");
  Logger.log("Sheet: " + ss.getName());
  Logger.log("Locale: " + ss.getSpreadsheetLocale());
  Logger.log("Lapai: " + ss.getSheets().map(function(s) { return s.getName(); }).join(", "));

  var sms = ss.getSheetByName("SMS");
  if (!sms) {
    SpreadsheetApp.getUi().alert("SMS lapas nerastas! Dashboard negali veikti be SMS duomenų.");
    return;
  }

  try {
    createDashboardSheet_(ss);
    Logger.log("Dashboard — OK");
  } catch (e) {
    Logger.log("Dashboard KLAIDA: " + e.message);
    SpreadsheetApp.getUi().alert("Dashboard klaida: " + e.message);
    return;
  }

  var dashboard = ss.getSheetByName("Dashboard");
  if (dashboard) dashboard.activate();

  Logger.log("=== DASHBOARD SETUP BAIGTAS ===");

  SpreadsheetApp.getUi().alert(
    "Dashboard atnaujintas!\n\n" +
    "Duomenys apskaičiuoti iš SMS lapo.\n" +
    "Paleisk setupDashboard dar kartą, kad atnaujinti."
  );
}

function diagnoseSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var report = [];

  report.push("=== DIAGNOSTIKA ===");
  report.push("Sheet: " + ss.getName());
  report.push("ID: " + ss.getId());
  report.push("Locale: " + ss.getSpreadsheetLocale());
  report.push("");

  var sheets = ss.getSheets();
  report.push("Lapai (" + sheets.length + "):");
  for (var i = 0; i < sheets.length; i++) {
    var s = sheets[i];
    var lastRow = s.getLastRow();
    var lastCol = s.getLastColumn();
    var header = "";
    if (lastRow > 0 && lastCol > 0) {
      try {
        header = s.getRange(1, 1, 1, Math.min(lastCol, 10)).getValues()[0].join(" | ");
      } catch (e) {
        header = "(nepavyko nuskaityti)";
      }
    }
    report.push("  " + (i+1) + ". \"" + s.getName() + "\" — " + lastRow + " eilučių, " + lastCol + " stulpelių");
    report.push("     Header: " + header);
  }
  report.push("");

  var sms = ss.getSheetByName("SMS");
  if (sms) {
    report.push("SMS lapas rastas!");
    var smsLastRow = sms.getLastRow();
    report.push("  Eilučių: " + smsLastRow);
    if (smsLastRow > 0) {
      var h = sms.getRange("A1:F1").getValues()[0];
      report.push("  Header: " + h.join(" | "));
    }
    if (smsLastRow > 1) {
      var sample = sms.getRange(2, 1, Math.min(3, smsLastRow-1), 6).getValues();
      for (var i = 0; i < sample.length; i++) {
        report.push("  Eilutė " + (i+2) + ": " + sample[i].join(" | "));
      }
    }
  } else {
    report.push("SMS lapas NERASTAS!");
  }

  var text = report.join("\n");
  Logger.log(text);
  SpreadsheetApp.getUi().alert(text.substring(0, 1500));
}

// ==================== DASHBOARD ====================

function createDashboardSheet_(ss) {
  var existing = ss.getSheetByName("Dashboard");
  if (existing) ss.deleteSheet(existing);

  var sms = ss.getSheetByName("SMS");
  if (!sms) throw new Error("SMS lapas nerastas!");

  // ===== Skaičiuojam duomenis iš SMS lapo =====
  var smsData = getSmsStats_(sms);

  var sheet = ss.insertSheet("Dashboard", 0);

  // Premium monochrome palette
  var bg = "#FAFAFA";
  var cardBg = "#FFFFFF";
  var headerText = "#111111";
  var subText = "#888888";
  var borderColor = "#E0E0E0";
  var accentDark = "#222222";
  var accentMid = "#555555";
  var successColor = "#2D8A4E";
  var warningColor = "#C47F17";
  var dangerColor = "#C53030";

  sheet.setColumnWidth(1, 20);
  sheet.setColumnWidth(2, 180);
  sheet.setColumnWidth(3, 100);
  sheet.setColumnWidth(4, 20);
  sheet.setColumnWidth(5, 180);
  sheet.setColumnWidth(6, 100);
  sheet.setColumnWidth(7, 20);
  sheet.setColumnWidth(8, 180);
  sheet.setColumnWidth(9, 100);
  sheet.setColumnWidth(10, 20);

  sheet.getRange("A1:J55").setBackground(bg).setFontFamily("Google Sans");

  // ===== HEADER =====
  sheet.setRowHeight(1, 55);
  sheet.getRange("B1:I1").merge().setValue("PROTEROS SERVISAS")
    .setFontSize(20).setFontWeight("bold").setFontColor(headerText)
    .setHorizontalAlignment("left").setVerticalAlignment("middle")
    .setBackground(bg);

  sheet.setRowHeight(2, 22);
  var now = Utilities.formatDate(new Date(), "Europe/Vilnius", "yyyy-MM-dd HH:mm");
  sheet.getRange("B2:I2").merge().setValue(now + "  ·  Valdymo pultas")
    .setFontSize(10).setFontColor(subText)
    .setHorizontalAlignment("left").setBackground(bg);

  // ===== KPI CARDS ROW 1 =====
  sheet.setRowHeight(3, 12);

  kpiCard_(sheet, 4, "B", "C", "SMS šiandien", smsData.today.total, accentDark, cardBg, subText, borderColor);
  kpiCard_(sheet, 4, "E", "F", "Praleisti skambučiai", smsData.today.missed, warningColor, cardBg, subText, borderColor);
  kpiCard_(sheet, 4, "H", "I", "Užsakymai", smsData.today.bookings, successColor, cardBg, subText, borderColor);

  sheet.setRowHeight(4, 22);
  sheet.setRowHeight(5, 50);
  sheet.setRowHeight(6, 8);

  // ===== KPI CARDS ROW 2 =====
  kpiCard_(sheet, 7, "B", "C", "Klaidos", smsData.today.errors, dangerColor, cardBg, subText, borderColor);
  kpiCard_(sheet, 7, "E", "F", "Perdavimai", smsData.today.transfers, accentMid, cardBg, subText, borderColor);

  var patSheet = ss.getSheetByName("Pataisymai");
  var pendingFixes = 0;
  if (patSheet && patSheet.getLastRow() > 1) {
    var statuses = patSheet.getRange(2, 5, patSheet.getLastRow() - 1, 1).getValues();
    for (var i = 0; i < statuses.length; i++) {
      if (statuses[i][0] === "Laukia pataisymo") pendingFixes++;
    }
  }
  kpiCard_(sheet, 7, "H", "I", "Laukia pataisymo", pendingFixes, accentMid, cardBg, subText, borderColor);

  sheet.setRowHeight(7, 22);
  sheet.setRowHeight(8, 50);

  // ===== STATISTIKA =====
  sheet.setRowHeight(9, 15);
  sheet.setRowHeight(10, 28);
  sheet.getRange("B10:I10").merge().setValue("Statistika")
    .setFontSize(14).setFontWeight("bold").setFontColor(headerText).setBackground(bg);

  sheet.setRowHeight(11, 22);
  sheet.getRange("B11:C11").setValues([["Rodiklis", "Kiekis"]])
    .setFontWeight("bold").setFontSize(9).setFontColor(subText).setBackground("#F2F2F2");
  sheet.getRange("E11:F11").setValues([["Rodiklis", "Kiekis"]])
    .setFontWeight("bold").setFontSize(9).setFontColor(subText).setBackground("#F2F2F2");
  sheet.getRange("H11:I11").setValues([["Rodiklis", "Reikšmė"]])
    .setFontWeight("bold").setFontSize(9).setFontColor(subText).setBackground("#F2F2F2");

  var leftStats = [
    ["Pokalbiai (AI)", smsData.today.aiConversations],
    ["Klientų žinutės", smsData.today.clientMessages],
    ["AI atsakymai", smsData.today.agentMessages],
  ];
  var midStats = [
    ["Uždaryti pokalbiai", smsData.today.closed],
    ["Savininko booking", smsData.today.ownerBookings],
    ["Pataisymai (viso)", patSheet ? Math.max(patSheet.getLastRow() - 1, 0) : 0],
  ];
  var conversionRate = smsData.today.missed > 0 ? Math.round(smsData.today.bookings / smsData.today.missed * 100) + "%" : "—";
  var successRate = smsData.today.total > 0 ? Math.round((1 - smsData.today.errors / smsData.today.total) * 100) + "%" : "—";
  var rightStats = [
    ["Konversija", conversionRate],
    ["Sėkmės rodiklis", successRate],
  ];

  for (var i = 0; i < 3; i++) {
    var row = 12 + i;
    sheet.setRowHeight(row, 28);
    sheet.getRange("B" + row).setValue(leftStats[i][0]).setFontColor(headerText).setFontSize(10).setBackground(cardBg);
    sheet.getRange("C" + row).setValue(leftStats[i][1]).setFontColor(headerText).setFontSize(11).setFontWeight("bold").setHorizontalAlignment("center").setBackground(cardBg);
    sheet.getRange("E" + row).setValue(midStats[i][0]).setFontColor(headerText).setFontSize(10).setBackground(cardBg);
    sheet.getRange("F" + row).setValue(midStats[i][1]).setFontColor(headerText).setFontSize(11).setFontWeight("bold").setHorizontalAlignment("center").setBackground(cardBg);
    if (i < rightStats.length) {
      sheet.getRange("H" + row).setValue(rightStats[i][0]).setFontColor(headerText).setFontSize(10).setBackground(cardBg);
      sheet.getRange("I" + row).setValue(rightStats[i][1]).setFontColor(accentDark).setFontSize(11).setFontWeight("bold").setHorizontalAlignment("center").setBackground(cardBg);
    }
  }

  sheet.getRange("B11:C14").setBorder(true, true, true, true, false, false, borderColor, SpreadsheetApp.BorderStyle.SOLID);
  sheet.getRange("E11:F14").setBorder(true, true, true, true, false, false, borderColor, SpreadsheetApp.BorderStyle.SOLID);
  sheet.getRange("H11:I13").setBorder(true, true, true, true, false, false, borderColor, SpreadsheetApp.BorderStyle.SOLID);

  // ===== SAVAITĖS APŽVALGA =====
  sheet.setRowHeight(15, 15);
  sheet.setRowHeight(16, 28);
  sheet.getRange("B16:I16").merge().setValue("Savaitės apžvalga")
    .setFontSize(14).setFontWeight("bold").setFontColor(headerText).setBackground(bg);

  sheet.setRowHeight(17, 22);
  sheet.getRange("B17:H17").setValues([["Diena", "SMS", "Skambučiai", "Booking", "Klaidos", "Perdavimai", ""]])
    .setFontWeight("bold").setFontSize(9).setFontColor(subText).setBackground("#F2F2F2");
  sheet.getRange("B17:H17").setBorder(true, true, false, true, false, false, borderColor, SpreadsheetApp.BorderStyle.SOLID);

  for (var d = 0; d < 7; d++) {
    var row = 18 + d;
    sheet.setRowHeight(row, 26);
    var rowBg = d % 2 === 0 ? cardBg : "#F7F7F7";
    var dayData = smsData.days[d];

    sheet.getRange("B" + row).setValue(dayData.label).setFontColor(headerText).setFontSize(10).setBackground(rowBg);
    sheet.getRange("C" + row).setValue(dayData.total).setFontColor(headerText).setFontWeight("bold").setHorizontalAlignment("center").setBackground(rowBg);
    sheet.getRange("D" + row).setValue(dayData.missed).setFontColor(warningColor).setFontWeight("bold").setHorizontalAlignment("center").setBackground(rowBg);
    sheet.getRange("E" + row).setValue(dayData.bookings).setFontColor(successColor).setFontWeight("bold").setHorizontalAlignment("center").setBackground(rowBg);
    sheet.getRange("F" + row).setValue(dayData.errors).setFontColor(dangerColor).setFontWeight("bold").setHorizontalAlignment("center").setBackground(rowBg);
    sheet.getRange("G" + row).setValue(dayData.transfers).setFontColor(accentMid).setFontWeight("bold").setHorizontalAlignment("center").setBackground(rowBg);
  }
  sheet.getRange("B17:G24").setBorder(true, true, true, true, false, false, borderColor, SpreadsheetApp.BorderStyle.SOLID);

  // ===== PASKUTINĖS KLAIDOS =====
  sheet.setRowHeight(25, 15);
  sheet.setRowHeight(26, 28);
  sheet.getRange("B26:I26").merge().setValue("Paskutinės klaidos")
    .setFontSize(14).setFontWeight("bold").setFontColor(dangerColor).setBackground(bg);

  sheet.setRowHeight(27, 22);
  sheet.getRange("B27:I27").setValues([["Data", "Telefonas", "", "Klaidos aprašymas", "", "", "", ""]])
    .setFontWeight("bold").setFontSize(9).setFontColor(subText).setBackground("#F2F2F2");

  for (var i = 0; i < 5; i++) {
    var row = 28 + i;
    sheet.setRowHeight(row, 26);
    var rowBg = i % 2 === 0 ? cardBg : "#F7F7F7";
    if (i < smsData.lastErrors.length) {
      var err = smsData.lastErrors[i];
      sheet.getRange("B" + row).setValue(err.date).setFontColor(subText).setFontSize(10).setBackground(rowBg);
      sheet.getRange("C" + row).setValue(err.phone).setFontColor(headerText).setFontSize(10).setBackground(rowBg);
      sheet.getRange("D" + row + ":I" + row).merge().setValue(err.message)
        .setFontColor(dangerColor).setFontSize(10).setBackground(rowBg).setWrap(true);
    } else {
      sheet.getRange("B" + row).setValue("—").setFontColor(subText).setFontSize(10).setBackground(rowBg);
      sheet.getRange("C" + row).setValue("").setBackground(rowBg);
      sheet.getRange("D" + row + ":I" + row).merge().setValue("").setBackground(rowBg);
    }
  }
  sheet.getRange("B27:I32").setBorder(true, true, true, true, false, false, borderColor, SpreadsheetApp.BorderStyle.SOLID);

  // ===== ĮRENGINIŲ STATUSAS (iš Statusas lapo) =====
  var statusSheet = ss.getSheetByName("Statusas");
  if (statusSheet) {
    sheet.setRowHeight(33, 15);
    sheet.setRowHeight(34, 28);
    sheet.getRange("B34:I34").merge().setValue("Įrenginių statusas")
      .setFontSize(14).setFontWeight("bold").setFontColor(headerText).setBackground(bg);

    var statusData = statusSheet.getDataRange().getValues();

    // Device 1 (col D-E) and Device 2 (col F-G) from Statusas
    var devices = [];
    if (statusData.length > 0) {
      var dev1 = { name: "", rows: [] };
      var dev2 = { name: "", rows: [] };
      if (statusData[0] && statusData[0][3]) dev1.name = statusData[0][3].toString();
      if (statusData[0] && statusData[0][5]) dev2.name = statusData[0][5].toString();

      for (var i = 1; i < statusData.length; i++) {
        var label1 = statusData[i][3] ? statusData[i][3].toString() : "";
        var value1 = statusData[i][4] ? statusData[i][4].toString() : "";
        var label2 = statusData[i][5] ? statusData[i][5].toString() : "";
        var value2 = statusData[i][6] ? statusData[i][6].toString() : "";
        if (label1) dev1.rows.push([label1, value1]);
        if (label2) dev2.rows.push([label2, value2]);
      }
      if (dev1.name) devices.push(dev1);
      if (dev2.name) devices.push(dev2);
    }

    if (devices.length > 0) {
      sheet.setRowHeight(35, 22);

      for (var di = 0; di < devices.length && di < 2; di++) {
        var dev = devices[di];
        var colLabel = di === 0 ? "B" : "F";
        var colValue = di === 0 ? "C" : "G";
        var colMergeEnd = di === 0 ? "D" : "H";

        sheet.getRange(colLabel + "35:" + colMergeEnd + "35").merge()
          .setValue(dev.name)
          .setFontSize(11).setFontWeight("bold").setFontColor(headerText)
          .setBackground("#F2F2F2").setHorizontalAlignment("center");

        for (var ri = 0; ri < dev.rows.length; ri++) {
          var row = 36 + ri;
          sheet.setRowHeight(row, 24);
          var rowBg = ri % 2 === 0 ? cardBg : "#F7F7F7";
          var label = dev.rows[ri][0];
          var value = dev.rows[ri][1];

          sheet.getRange(colLabel + row).setValue(label)
            .setFontColor(subText).setFontSize(10).setBackground(rowBg);

          var valueColor = headerText;
          if (value.indexOf("✓") > -1) valueColor = successColor;
          if (value.indexOf("✗") > -1) valueColor = dangerColor;

          sheet.getRange(colValue + row + ":" + colMergeEnd + row).merge()
            .setValue(value)
            .setFontColor(valueColor).setFontSize(10).setFontWeight("bold")
            .setBackground(rowBg).setHorizontalAlignment("center");
        }

        var lastDevRow = 36 + dev.rows.length - 1;
        sheet.getRange(colLabel + "35:" + colMergeEnd + lastDevRow)
          .setBorder(true, true, true, true, false, false, borderColor, SpreadsheetApp.BorderStyle.SOLID);
      }
    }
  }

  sheet.protect().setDescription("Dashboard — automatinės formulės").setWarningOnly(true);
  sheet.setHiddenGridlines(true);

  Logger.log("Dashboard sukurtas su " + smsData.totalRows + " SMS eilučių");
}

// ==================== SMS DUOMENŲ ANALIZĖ ====================

function getSmsStats_(smsSheet) {
  var lastRow = smsSheet.getLastRow();
  var result = {
    totalRows: lastRow - 1,
    today: { total: 0, missed: 0, bookings: 0, errors: 0, transfers: 0, closed: 0, ownerBookings: 0, aiConversations: 0, clientMessages: 0, agentMessages: 0 },
    days: [],
    lastErrors: []
  };

  if (lastRow <= 1) {
    for (var d = 0; d < 7; d++) {
      var dt = new Date();
      dt.setDate(dt.getDate() - d);
      result.days.push({ label: Utilities.formatDate(dt, "Europe/Vilnius", "MM-dd, EEE"), total: 0, missed: 0, bookings: 0, errors: 0, transfers: 0 });
    }
    return result;
  }

  var data = smsSheet.getRange(2, 1, lastRow - 1, 6).getValues();
  var todayStr = Utilities.formatDate(new Date(), "Europe/Vilnius", "yyyy-MM-dd");

  // Per-day stats
  var dayStats = {};
  for (var d = 0; d < 7; d++) {
    var dt = new Date();
    dt.setDate(dt.getDate() - d);
    var dayKey = Utilities.formatDate(dt, "Europe/Vilnius", "yyyy-MM-dd");
    dayStats[dayKey] = { label: Utilities.formatDate(dt, "Europe/Vilnius", "MM-dd, EEE"), total: 0, missed: 0, bookings: 0, errors: 0, transfers: 0 };
  }

  var errors = [];

  for (var i = 0; i < data.length; i++) {
    var rawDate = data[i][0];
    var dateStr = "";

    if (rawDate instanceof Date) {
      dateStr = Utilities.formatDate(rawDate, "Europe/Vilnius", "yyyy-MM-dd");
    } else if (rawDate) {
      dateStr = rawDate.toString().substring(0, 10);
    }

    var type = data[i][3] ? data[i][3].toString() : "";
    var sender = data[i][4] ? data[i][4].toString() : "";

    // Today stats
    if (dateStr === todayStr) {
      result.today.total++;
      if (type === "Praleistas skambutis") result.today.missed++;
      if (type === "Booking") result.today.bookings++;
      if (type === "Savininko booking") result.today.ownerBookings++;
      if (type === "Klaida") result.today.errors++;
      if (type === "Perdavimas") result.today.transfers++;
      if (type === "Uždarytas") result.today.closed++;
      if (type === "Pokalbis" && sender === "Agentas") result.today.aiConversations++;
      if (sender === "Klientas") result.today.clientMessages++;
      if (sender === "Agentas") result.today.agentMessages++;
    }

    // Weekly stats
    if (dayStats[dateStr]) {
      dayStats[dateStr].total++;
      if (type === "Praleistas skambutis") dayStats[dateStr].missed++;
      if (type === "Booking" || type === "Savininko booking") dayStats[dateStr].bookings++;
      if (type === "Klaida") dayStats[dateStr].errors++;
      if (type === "Perdavimas") dayStats[dateStr].transfers++;
    }

    // Errors
    if (type === "Klaida") {
      errors.push({
        date: rawDate instanceof Date ? Utilities.formatDate(rawDate, "Europe/Vilnius", "yyyy-MM-dd HH:mm") : rawDate.toString(),
        phone: data[i][2] ? data[i][2].toString() : "",
        message: data[i][5] ? data[i][5].toString() : ""
      });
    }
  }

  // Build days array in order
  for (var d = 0; d < 7; d++) {
    var dt = new Date();
    dt.setDate(dt.getDate() - d);
    var dayKey = Utilities.formatDate(dt, "Europe/Vilnius", "yyyy-MM-dd");
    result.days.push(dayStats[dayKey]);
  }

  // Last 5 errors (newest first)
  errors.reverse();
  result.lastErrors = errors.slice(0, 5);

  return result;
}

// ==================== KPI CARD ====================

function kpiCard_(sheet, startRow, col1, col2, label, value, valueColor, cardBg, subText, borderColor) {
  sheet.getRange(col1 + startRow + ":" + col2 + startRow).merge()
    .setValue(label)
    .setFontSize(10).setFontColor(subText)
    .setBackground(cardBg).setHorizontalAlignment("center").setVerticalAlignment("bottom");

  var valueRow = startRow + 1;
  sheet.getRange(col1 + valueRow + ":" + col2 + valueRow).merge()
    .setValue(value)
    .setFontSize(30).setFontWeight("bold").setFontColor(valueColor)
    .setHorizontalAlignment("center").setVerticalAlignment("middle")
    .setBackground(cardBg);

  sheet.getRange(col1 + startRow + ":" + col2 + valueRow)
    .setBorder(true, true, true, true, false, false, borderColor, SpreadsheetApp.BorderStyle.SOLID);
}
