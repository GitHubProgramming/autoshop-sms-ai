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
 * PASTABA: Automatiškai aptinka Google Sheets locale (lt_LT, en_US ir kt.)
 * ir pritaiko formulių skyriklį (, arba ;)
 *
 * SVARBU: Šis skriptas keičia TIK Dashboard lapą.
 * Kiti lapai (SMS, Pataisymai, Servisas ir kt.) neliečiami.
 */

function setLocalFormula_(range, formula) {
  var locale = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetLocale();
  if (locale && locale.indexOf("en") !== 0) {
    var result = "";
    var inQuotes = false;
    for (var i = 0; i < formula.length; i++) {
      var ch = formula.charAt(i);
      if (ch === '"') {
        inQuotes = !inQuotes;
        result += ch;
      } else if (ch === ',' && !inQuotes) {
        result += ';';
      } else {
        result += ch;
      }
    }
    formula = result;
  }
  range.setFormula(formula);
  return range;
}

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
    "Formulės pritaikytos jūsų locale (" + ss.getSpreadsheetLocale() + ").\n" +
    "Duomenys atsinaujina automatiškai."
  );
}

function diagnoseSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var report = [];

  report.push("=== DIAGNOSTIKA ===");
  report.push("Sheet: " + ss.getName());
  report.push("ID: " + ss.getId());
  report.push("Locale: " + ss.getSpreadsheetLocale());
  report.push("Formulių skyriklys: " + (ss.getSpreadsheetLocale().indexOf("en") === 0 ? "kablelis (,)" : "kabliataškis (;)"));
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
      report.push("  E1 (turi būti 'Siuntėjas'): \"" + h[4] + "\"");
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

  report.push("");
  var pat = ss.getSheetByName("Pataisymai");
  report.push("Pataisymai: " + (pat ? "rastas (" + pat.getLastRow() + " eilučių)" : "NERASTAS"));

  var dash = ss.getSheetByName("Dashboard");
  report.push("Dashboard: " + (dash ? "rastas" : "NERASTAS"));

  var text = report.join("\n");
  Logger.log(text);
  SpreadsheetApp.getUi().alert(text.substring(0, 1500));
}

// ==================== DASHBOARD ====================

function createDashboardSheet_(ss) {
  var existing = ss.getSheetByName("Dashboard");
  if (existing) ss.deleteSheet(existing);

  var smsCheck = ss.getSheetByName("SMS");
  if (!smsCheck) {
    throw new Error("SMS lapas nerastas!");
  }

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
  var infoColor = "#555555";

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

  sheet.getRange("A1:J50").setBackground(bg).setFontFamily("Google Sans");

  // ===== HEADER =====
  sheet.setRowHeight(1, 55);
  sheet.getRange("B1:I1").merge().setValue("PROTEROS SERVISAS")
    .setFontSize(20).setFontWeight("bold").setFontColor(headerText)
    .setHorizontalAlignment("left").setVerticalAlignment("middle")
    .setBackground(bg);

  sheet.setRowHeight(2, 22);
  var headerRange = sheet.getRange("B2:I2").merge();
  setLocalFormula_(headerRange, '=TEXT(NOW(),"yyyy-MM-dd HH:mm")&"  ·  Valdymo pultas"');
  headerRange.setFontSize(10).setFontColor(subText)
    .setHorizontalAlignment("left").setBackground(bg);

  // ===== KPI CARDS ROW 1 =====
  sheet.setRowHeight(3, 12);

  var todayStr = 'TEXT(TODAY(),"yyyy-MM-dd")';
  var tomorrowStr = 'TEXT(TODAY()+1,"yyyy-MM-dd")';

  appleKpiCard_(sheet, 4, "B", "C", "SMS šiandien",
    '=IFERROR(COUNTIFS(LEFT(SMS!A:A,10),">="&' + todayStr + ',LEFT(SMS!A:A,10),"<"&' + tomorrowStr + '),0)',
    accentDark, cardBg, subText, borderColor);

  appleKpiCard_(sheet, 4, "E", "F", "Praleisti skambučiai",
    '=IFERROR(COUNTIFS(LEFT(SMS!A:A,10),">="&' + todayStr + ',LEFT(SMS!A:A,10),"<"&' + tomorrowStr + ',SMS!D:D,"Praleistas skambutis"),0)',
    warningColor, cardBg, subText, borderColor);

  appleKpiCard_(sheet, 4, "H", "I", "Užsakymai",
    '=IFERROR(COUNTIFS(LEFT(SMS!A:A,10),">="&' + todayStr + ',LEFT(SMS!A:A,10),"<"&' + tomorrowStr + ',SMS!D:D,"Booking"),0)',
    successColor, cardBg, subText, borderColor);

  sheet.setRowHeight(4, 22);
  sheet.setRowHeight(5, 50);
  sheet.setRowHeight(6, 8);

  // ===== KPI CARDS ROW 2 =====
  appleKpiCard_(sheet, 7, "B", "C", "Klaidos",
    '=IFERROR(COUNTIFS(LEFT(SMS!A:A,10),">="&' + todayStr + ',LEFT(SMS!A:A,10),"<"&' + tomorrowStr + ',SMS!D:D,"Klaida"),0)',
    dangerColor, cardBg, subText, borderColor);

  appleKpiCard_(sheet, 7, "E", "F", "Perdavimai savininkui",
    '=IFERROR(COUNTIFS(LEFT(SMS!A:A,10),">="&' + todayStr + ',LEFT(SMS!A:A,10),"<"&' + tomorrowStr + ',SMS!D:D,"Perdavimas"),0)',
    accentMid, cardBg, subText, borderColor);

  appleKpiCard_(sheet, 7, "H", "I", "Laukia pataisymo",
    '=IFERROR(COUNTIF(Pataisymai!E:E,"Laukia pataisymo"),0)',
    infoColor, cardBg, subText, borderColor);

  sheet.setRowHeight(7, 22);
  sheet.setRowHeight(8, 50);

  // ===== STATISTIKA =====
  sheet.setRowHeight(9, 15);
  sheet.setRowHeight(10, 28);
  sheet.getRange("B10:I10").merge().setValue("Statistika")
    .setFontSize(14).setFontWeight("bold").setFontColor(headerText)
    .setBackground(bg);

  sheet.setRowHeight(11, 22);
  var statsLabels = ["Rodiklis", "Kiekis"];
  sheet.getRange("B11:C11").setValues([statsLabels])
    .setFontWeight("bold").setFontSize(9).setFontColor(subText).setBackground("#F2F2F2");
  sheet.getRange("E11:F11").setValues([statsLabels])
    .setFontWeight("bold").setFontSize(9).setFontColor(subText).setBackground("#F2F2F2");
  sheet.getRange("H11:I11").setValues([statsLabels])
    .setFontWeight("bold").setFontSize(9).setFontColor(subText).setBackground("#F2F2F2");

  var LA = 'LEFT(SMS!A:A,10)';
  var todayGte = '"&TEXT(TODAY(),"yyyy-MM-dd")';
  var tomorrowLt = '"&TEXT(TODAY()+1,"yyyy-MM-dd")';

  var leftStats = [
    ["Pokalbiai (AI)", '=IFERROR(COUNTIFS(' + LA + ',">=' + todayGte + ',' + LA + ',"<' + tomorrowLt + ',SMS!D:D,"Pokalbis",SMS!E:E,"Agentas"),0)'],
    ["Klientų žinutės", '=IFERROR(COUNTIFS(' + LA + ',">=' + todayGte + ',' + LA + ',"<' + tomorrowLt + ',SMS!E:E,"Klientas"),0)'],
    ["AI atsakymai", '=IFERROR(COUNTIFS(' + LA + ',">=' + todayGte + ',' + LA + ',"<' + tomorrowLt + ',SMS!E:E,"Agentas"),0)'],
  ];
  var midStats = [
    ["Uždaryti pokalbiai", '=IFERROR(COUNTIFS(' + LA + ',">=' + todayGte + ',' + LA + ',"<' + tomorrowLt + ',SMS!D:D,"Uždarytas"),0)'],
    ["Savininko booking", '=IFERROR(COUNTIFS(' + LA + ',">=' + todayGte + ',' + LA + ',"<' + tomorrowLt + ',SMS!D:D,"Savininko booking"),0)'],
    ["Pataisymai (viso)", '=IFERROR(COUNTA(Pataisymai!A2:A),0)'],
  ];
  var rightStats = [
    ["Konversija", '=IFERROR(TEXT(COUNTIFS(' + LA + ',">=' + todayGte + ',' + LA + ',"<' + tomorrowLt + ',SMS!D:D,"Booking")/COUNTIFS(' + LA + ',">=' + todayGte + ',' + LA + ',"<' + tomorrowLt + ',SMS!D:D,"Praleistas skambutis"),"0%"),"—")'],
    ["Sėkmės rodiklis", '=IFERROR(TEXT(1-COUNTIFS(' + LA + ',">=' + todayGte + ',' + LA + ',"<' + tomorrowLt + ',SMS!D:D,"Klaida")/COUNTIFS(' + LA + ',">=' + todayGte + ',' + LA + ',"<' + tomorrowLt + '),"0%"),"—")'],
    ["", ""],
  ];

  for (var i = 0; i < 3; i++) {
    var row = 12 + i;
    sheet.setRowHeight(row, 28);
    sheet.getRange("B" + row).setValue(leftStats[i][0]).setFontColor(headerText).setFontSize(10).setBackground(cardBg);
    setLocalFormula_(sheet.getRange("C" + row), leftStats[i][1]).setFontColor(headerText).setFontSize(11).setFontWeight("bold").setHorizontalAlignment("center").setBackground(cardBg);
    sheet.getRange("E" + row).setValue(midStats[i][0]).setFontColor(headerText).setFontSize(10).setBackground(cardBg);
    setLocalFormula_(sheet.getRange("F" + row), midStats[i][1]).setFontColor(headerText).setFontSize(11).setFontWeight("bold").setHorizontalAlignment("center").setBackground(cardBg);
    if (rightStats[i][0]) {
      sheet.getRange("H" + row).setValue(rightStats[i][0]).setFontColor(headerText).setFontSize(10).setBackground(cardBg);
      setLocalFormula_(sheet.getRange("I" + row), rightStats[i][1]).setFontColor(accentDark).setFontSize(11).setFontWeight("bold").setHorizontalAlignment("center").setBackground(cardBg);
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
    var dayStart = 'TEXT(TODAY()-' + d + ',"yyyy-MM-dd")';
    var dayEnd = 'TEXT(TODAY()-' + (d - 1) + ',"yyyy-MM-dd")';

    setLocalFormula_(sheet.getRange("B" + row), '=TEXT(TODAY()-' + d + ',"MM-dd, ddd")')
      .setFontColor(headerText).setFontSize(10).setBackground(rowBg);
    setLocalFormula_(sheet.getRange("C" + row), '=IFERROR(COUNTIFS(LEFT(SMS!A:A,10),">="&' + dayStart + ',LEFT(SMS!A:A,10),"<"&' + dayEnd + '),0)')
      .setFontColor(headerText).setFontWeight("bold").setHorizontalAlignment("center").setBackground(rowBg);
    setLocalFormula_(sheet.getRange("D" + row), '=IFERROR(COUNTIFS(LEFT(SMS!A:A,10),">="&' + dayStart + ',LEFT(SMS!A:A,10),"<"&' + dayEnd + ',SMS!D:D,"Praleistas skambutis"),0)')
      .setFontColor(warningColor).setFontWeight("bold").setHorizontalAlignment("center").setBackground(rowBg);
    setLocalFormula_(sheet.getRange("E" + row), '=IFERROR(COUNTIFS(LEFT(SMS!A:A,10),">="&' + dayStart + ',LEFT(SMS!A:A,10),"<"&' + dayEnd + ',SMS!D:D,"Booking"),0)')
      .setFontColor(successColor).setFontWeight("bold").setHorizontalAlignment("center").setBackground(rowBg);
    setLocalFormula_(sheet.getRange("F" + row), '=IFERROR(COUNTIFS(LEFT(SMS!A:A,10),">="&' + dayStart + ',LEFT(SMS!A:A,10),"<"&' + dayEnd + ',SMS!D:D,"Klaida"),0)')
      .setFontColor(dangerColor).setFontWeight("bold").setHorizontalAlignment("center").setBackground(rowBg);
    setLocalFormula_(sheet.getRange("G" + row), '=IFERROR(COUNTIFS(LEFT(SMS!A:A,10),">="&' + dayStart + ',LEFT(SMS!A:A,10),"<"&' + dayEnd + ',SMS!D:D,"Perdavimas"),0)')
      .setFontColor(accentMid).setFontWeight("bold").setHorizontalAlignment("center").setBackground(rowBg);
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
    var errorCount = 'IFERROR(COUNTA(FILTER(SMS!A:A,SMS!D:D="Klaida")),0)';
    var idx = i + 1;
    setLocalFormula_(sheet.getRange("B" + row),
      '=IF(' + errorCount + '>=' + idx + ',INDEX(FILTER(SMS!A:A,SMS!D:D="Klaida"),' + errorCount + '+1-' + idx + '),"—")')
      .setFontColor(subText).setFontSize(10).setBackground(rowBg);
    setLocalFormula_(sheet.getRange("C" + row),
      '=IF(' + errorCount + '>=' + idx + ',INDEX(FILTER(SMS!C:C,SMS!D:D="Klaida"),' + errorCount + '+1-' + idx + '),"—")')
      .setFontColor(headerText).setFontSize(10).setBackground(rowBg);
    var errDescRange = sheet.getRange("D" + row + ":I" + row).merge();
    setLocalFormula_(errDescRange,
      '=IF(' + errorCount + '>=' + idx + ',INDEX(FILTER(SMS!F:F,SMS!D:D="Klaida"),' + errorCount + '+1-' + idx + '),"—")')
    errDescRange.setFontColor(dangerColor).setFontSize(10).setBackground(rowBg).setWrap(true);
  }
  sheet.getRange("B27:I32").setBorder(true, true, true, true, false, false, borderColor, SpreadsheetApp.BorderStyle.SOLID);

  sheet.protect().setDescription("Dashboard — automatinės formulės").setWarningOnly(true);
  sheet.setHiddenGridlines(true);
}

function appleKpiCard_(sheet, startRow, col1, col2, label, formula, valueColor, cardBg, subText, borderColor) {
  sheet.getRange(col1 + startRow + ":" + col2 + startRow).merge()
    .setValue(label)
    .setFontSize(10).setFontColor(subText)
    .setBackground(cardBg).setHorizontalAlignment("center").setVerticalAlignment("bottom");

  var valueRow = startRow + 1;
  var valueRange = sheet.getRange(col1 + valueRow + ":" + col2 + valueRow).merge();
  setLocalFormula_(valueRange, formula);
  valueRange.setFontSize(30).setFontWeight("bold").setFontColor(valueColor)
    .setHorizontalAlignment("center").setVerticalAlignment("middle")
    .setBackground(cardBg);

  sheet.getRange(col1 + startRow + ":" + col2 + valueRow)
    .setBorder(true, true, true, true, false, false, borderColor, SpreadsheetApp.BorderStyle.SOLID);
}
