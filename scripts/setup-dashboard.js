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

function diagnoseStatusas() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var st = ss.getSheetByName("Statusas");
  if (!st) { SpreadsheetApp.getUi().alert("Statusas lapas NERASTAS!"); return; }

  var lastRow = st.getLastRow();
  var lastCol = st.getLastColumn();
  var report = [];
  report.push("Statusas: " + lastRow + " eil, " + lastCol + " stulp");

  var data = st.getRange(1, 1, lastRow, lastCol).getValues();
  for (var r = 0; r < data.length; r++) {
    var cells = [];
    for (var c = 0; c < data[r].length; c++) {
      var v = data[r][c] ? data[r][c].toString() : "";
      if (v) cells.push("[" + c + "]=" + v);
    }
    report.push("Row" + r + ": " + cells.join(" | "));
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

  sheet.getRange("A1:J45").setBackground(bg).setFontFamily("Google Sans");

  // ===== ROW 1: HEADER =====
  sheet.setRowHeight(1, 40);
  sheet.getRange("B1:F1").merge().setValue("PROTEROS SERVISAS")
    .setFontSize(18).setFontWeight("bold").setFontColor(headerText)
    .setHorizontalAlignment("left").setVerticalAlignment("middle")
    .setBackground(bg);
  var now = Utilities.formatDate(new Date(), "Europe/Vilnius", "yyyy-MM-dd HH:mm");
  sheet.getRange("G1:I1").merge().setValue(now)
    .setFontSize(10).setFontColor(subText)
    .setHorizontalAlignment("right").setVerticalAlignment("middle").setBackground(bg);

  // ===== ROW 2: spacer =====
  sheet.setRowHeight(2, 6);

  // ===== ROW 3-4: KPI CARDS ROW 1 =====
  kpiCard_(sheet, 3, "B", "C", "SMS šiandien", smsData.today.total, accentDark, cardBg, subText, borderColor);
  kpiCard_(sheet, 3, "E", "F", "Praleisti skambučiai", smsData.today.missed, warningColor, cardBg, subText, borderColor);
  kpiCard_(sheet, 3, "H", "I", "Užsakymai", smsData.today.bookings, successColor, cardBg, subText, borderColor);
  sheet.setRowHeight(3, 18);
  sheet.setRowHeight(4, 40);

  // ===== ROW 5: spacer =====
  sheet.setRowHeight(5, 4);

  // ===== ROW 6-7: KPI CARDS ROW 2 =====
  kpiCard_(sheet, 6, "B", "C", "Klaidos", smsData.today.errors, dangerColor, cardBg, subText, borderColor);
  kpiCard_(sheet, 6, "E", "F", "Perdavimai", smsData.today.transfers, accentMid, cardBg, subText, borderColor);

  var patSheet = ss.getSheetByName("Pataisymai");
  var pendingFixes = 0;
  if (patSheet && patSheet.getLastRow() > 1) {
    var statuses = patSheet.getRange(2, 5, patSheet.getLastRow() - 1, 1).getValues();
    for (var i = 0; i < statuses.length; i++) {
      if (statuses[i][0] === "Laukia pataisymo") pendingFixes++;
    }
  }
  kpiCard_(sheet, 6, "H", "I", "Laukia pataisymo", pendingFixes, accentMid, cardBg, subText, borderColor);
  sheet.setRowHeight(6, 18);
  sheet.setRowHeight(7, 40);

  // ===== ROW 8: spacer =====
  sheet.setRowHeight(8, 6);

  // ===== ROW 9: Statistika header =====
  sheet.setRowHeight(9, 22);
  sheet.getRange("B9:I9").merge().setValue("Statistika")
    .setFontSize(12).setFontWeight("bold").setFontColor(headerText).setBackground(bg);

  // ===== ROW 10: stats headers =====
  sheet.setRowHeight(10, 18);
  sheet.getRange("B10:C10").setValues([["Rodiklis", "Kiekis"]])
    .setFontWeight("bold").setFontSize(8).setFontColor(subText).setBackground("#F2F2F2");
  sheet.getRange("E10:F10").setValues([["Rodiklis", "Kiekis"]])
    .setFontWeight("bold").setFontSize(8).setFontColor(subText).setBackground("#F2F2F2");
  sheet.getRange("H10:I10").setValues([["Rodiklis", "Reikšmė"]])
    .setFontWeight("bold").setFontSize(8).setFontColor(subText).setBackground("#F2F2F2");

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

  // ===== ROW 11-13: stats data =====
  for (var i = 0; i < 3; i++) {
    var row = 11 + i;
    sheet.setRowHeight(row, 22);
    sheet.getRange("B" + row).setValue(leftStats[i][0]).setFontColor(headerText).setFontSize(9).setBackground(cardBg);
    sheet.getRange("C" + row).setValue(leftStats[i][1]).setFontColor(headerText).setFontSize(10).setFontWeight("bold").setHorizontalAlignment("center").setBackground(cardBg);
    sheet.getRange("E" + row).setValue(midStats[i][0]).setFontColor(headerText).setFontSize(9).setBackground(cardBg);
    sheet.getRange("F" + row).setValue(midStats[i][1]).setFontColor(headerText).setFontSize(10).setFontWeight("bold").setHorizontalAlignment("center").setBackground(cardBg);
    if (i < rightStats.length) {
      sheet.getRange("H" + row).setValue(rightStats[i][0]).setFontColor(headerText).setFontSize(9).setBackground(cardBg);
      sheet.getRange("I" + row).setValue(rightStats[i][1]).setFontColor(accentDark).setFontSize(10).setFontWeight("bold").setHorizontalAlignment("center").setBackground(cardBg);
    }
  }

  sheet.getRange("B10:C13").setBorder(true, true, true, true, false, false, borderColor, SpreadsheetApp.BorderStyle.SOLID);
  sheet.getRange("E10:F13").setBorder(true, true, true, true, false, false, borderColor, SpreadsheetApp.BorderStyle.SOLID);
  sheet.getRange("H10:I12").setBorder(true, true, true, true, false, false, borderColor, SpreadsheetApp.BorderStyle.SOLID);

  // ===== ROW 14: spacer =====
  sheet.setRowHeight(14, 6);

  // ===== ROW 15: Savaitės apžvalga header =====
  sheet.setRowHeight(15, 22);
  sheet.getRange("B15:G15").merge().setValue("Savaitės apžvalga")
    .setFontSize(12).setFontWeight("bold").setFontColor(headerText).setBackground(bg);

  // Paskutinės klaidos header (šalia savaitės)
  sheet.getRange("H15:I15").merge().setValue("Paskutinės klaidos")
    .setFontSize(12).setFontWeight("bold").setFontColor(dangerColor).setBackground(bg);

  // ===== ROW 16: column headers =====
  sheet.setRowHeight(16, 18);
  sheet.getRange("B16:G16").setValues([["Diena", "SMS", "Skamb.", "Book.", "Klaid.", "Perd."]])
    .setFontWeight("bold").setFontSize(8).setFontColor(subText).setBackground("#F2F2F2");
  sheet.getRange("B16:G16").setBorder(true, true, false, true, false, false, borderColor, SpreadsheetApp.BorderStyle.SOLID);

  sheet.getRange("H16:I16").setValues([["Tel.", "Aprašymas"]])
    .setFontWeight("bold").setFontSize(8).setFontColor(subText).setBackground("#F2F2F2");
  sheet.getRange("H16:I16").setBorder(true, true, false, true, false, false, borderColor, SpreadsheetApp.BorderStyle.SOLID);

  // ===== ROW 17-23: savaitė + klaidos side by side =====
  for (var d = 0; d < 7; d++) {
    var row = 17 + d;
    sheet.setRowHeight(row, 21);
    var rowBg = d % 2 === 0 ? cardBg : "#F7F7F7";
    var dayData = smsData.days[d];

    sheet.getRange("B" + row).setValue(dayData.label).setFontColor(headerText).setFontSize(9).setBackground(rowBg);
    sheet.getRange("C" + row).setValue(dayData.total).setFontColor(headerText).setFontWeight("bold").setHorizontalAlignment("center").setFontSize(9).setBackground(rowBg);
    sheet.getRange("D" + row).setValue(dayData.missed).setFontColor(warningColor).setFontWeight("bold").setHorizontalAlignment("center").setFontSize(9).setBackground(rowBg);
    sheet.getRange("E" + row).setValue(dayData.bookings).setFontColor(successColor).setFontWeight("bold").setHorizontalAlignment("center").setFontSize(9).setBackground(rowBg);
    sheet.getRange("F" + row).setValue(dayData.errors).setFontColor(dangerColor).setFontWeight("bold").setHorizontalAlignment("center").setFontSize(9).setBackground(rowBg);
    sheet.getRange("G" + row).setValue(dayData.transfers).setFontColor(accentMid).setFontWeight("bold").setHorizontalAlignment("center").setFontSize(9).setBackground(rowBg);

    // Klaidos (dešinėje)
    if (d < 5) {
      if (d < smsData.lastErrors.length) {
        var err = smsData.lastErrors[d];
        sheet.getRange("H" + row).setValue(err.phone).setFontColor(headerText).setFontSize(8).setBackground(rowBg);
        sheet.getRange("I" + row).setValue(err.message).setFontColor(dangerColor).setFontSize(8).setBackground(rowBg).setWrap(true);
      } else {
        sheet.getRange("H" + row).setValue("—").setFontColor(subText).setFontSize(8).setBackground(rowBg);
        sheet.getRange("I" + row).setValue("").setBackground(rowBg);
      }
    }
  }
  sheet.getRange("B16:G23").setBorder(true, true, true, true, false, false, borderColor, SpreadsheetApp.BorderStyle.SOLID);
  sheet.getRange("H16:I21").setBorder(true, true, true, true, false, false, borderColor, SpreadsheetApp.BorderStyle.SOLID);

  // ===== ROW 24: spacer =====
  sheet.setRowHeight(24, 6);

  // ===== ĮRENGINIŲ STATUSAS (iš Statusas lapo) =====
  var statusSheet = ss.getSheetByName("Statusas");
  if (statusSheet && statusSheet.getLastRow() >= 1) {
    sheet.setRowHeight(25, 22);
    sheet.getRange("B25:I25").merge().setValue("Įrenginių statusas")
      .setFontSize(12).setFontWeight("bold").setFontColor(headerText).setBackground(bg);

    var lastStatusRow = statusSheet.getLastRow();
    var lastStatusCol = statusSheet.getLastColumn();
    var allStatus = statusSheet.getRange(1, 1, lastStatusRow, lastStatusCol).getValues();

    Logger.log("Statusas: " + lastStatusRow + " eilučių, " + lastStatusCol + " stulpelių");
    Logger.log("Statusas row0: " + JSON.stringify(allStatus[0]));

    // Rasti email eilutę ir device stulpelius
    var emailRow = -1;
    var d1col = -1, d2col = -1;
    for (var r = 0; r < allStatus.length; r++) {
      for (var c = 0; c < allStatus[r].length; c++) {
        var val = allStatus[r][c] ? allStatus[r][c].toString() : "";
        if (val && val.indexOf("@") > -1) {
          if (emailRow === -1) emailRow = r;
          if (r === emailRow) {
            if (d1col === -1) d1col = c;
            else if (d2col === -1) d2col = c;
          }
        }
      }
      if (emailRow > -1) break;
    }

    Logger.log("Email row: " + emailRow + ", Device columns: d1=" + d1col + ", d2=" + d2col);

    var devices = [];

    if (d1col >= 0 && emailRow >= 0) {
      var dev = { name: allStatus[emailRow][d1col].toString(), rows: [] };
      for (var r = emailRow + 1; r < allStatus.length; r++) {
        var label = allStatus[r][d1col] ? allStatus[r][d1col].toString() : "";
        var value = (d1col + 1 < allStatus[r].length && allStatus[r][d1col + 1]) ? allStatus[r][d1col + 1].toString() : "";
        if (label) dev.rows.push([label, value]);
      }
      devices.push(dev);
    }

    if (d2col >= 0 && emailRow >= 0) {
      var dev2 = { name: allStatus[emailRow][d2col].toString(), rows: [] };
      for (var r = emailRow + 1; r < allStatus.length; r++) {
        var label = allStatus[r][d2col] ? allStatus[r][d2col].toString() : "";
        var value = (d2col + 1 < allStatus[r].length && allStatus[r][d2col + 1]) ? allStatus[r][d2col + 1].toString() : "";
        if (label) dev2.rows.push([label, value]);
      }
      devices.push(dev2);
    }

    Logger.log("Devices found: " + devices.length);

    if (devices.length > 0) {
      sheet.setRowHeight(26, 18);
      var maxRows = 0;

      for (var di = 0; di < devices.length && di < 2; di++) {
        var dev = devices[di];
        var colLabel = di === 0 ? "B" : "F";
        var colValue = di === 0 ? "C" : "G";
        var colMergeEnd = di === 0 ? "D" : "H";

        sheet.getRange(colLabel + "26:" + colMergeEnd + "26").merge()
          .setValue(dev.name)
          .setFontSize(9).setFontWeight("bold").setFontColor(headerText)
          .setBackground("#F2F2F2").setHorizontalAlignment("center");

        for (var ri = 0; ri < dev.rows.length; ri++) {
          var row = 27 + ri;
          sheet.setRowHeight(row, 21);
          var rowBg = ri % 2 === 0 ? cardBg : "#F7F7F7";

          sheet.getRange(colLabel + row).setValue(dev.rows[ri][0])
            .setFontColor(subText).setFontSize(9).setBackground(rowBg);

          var valText = dev.rows[ri][1];
          var valColor = headerText;
          if (valText.indexOf("✓") > -1 || valText.indexOf("Įjungta") > -1) valColor = successColor;
          if (valText.indexOf("✗") > -1 || valText.indexOf("Išjungta") > -1) valColor = dangerColor;

          sheet.getRange(colValue + row + ":" + colMergeEnd + row).merge()
            .setValue(valText)
            .setFontColor(valColor).setFontSize(9).setFontWeight("bold")
            .setBackground(rowBg).setHorizontalAlignment("center");
        }

        if (dev.rows.length > maxRows) maxRows = dev.rows.length;

        var lastDevRow = 27 + dev.rows.length - 1;
        sheet.getRange(colLabel + "26:" + colMergeEnd + lastDevRow)
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
