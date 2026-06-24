/**
 * PROTEROS SERVISAS — Dashboard + Pataisymai + SMS migracija
 *
 * INSTRUKCIJA:
 * 1. Atidaryk savo Proteros žinių bazės Sheet'ą
 * 2. Viršuje paspausk: Extensions → Apps Script
 * 3. Ištrink esamą kodą ir įklijuok visą šį kodą į Kodas.gs
 * 4. Viršuje pasirink funkciją: setupDashboard
 * 5. Paspausk ▶ Run
 * 6. Leisk prieigą kai paprašys
 *
 * DIAGNOSTIKA (jei neveikia):
 * 1. Pasirink funkciją: diagnoseSheet
 * 2. Paspausk ▶ Run
 * 3. Žiūrėk View → Logs — ten bus visa informacija
 *
 * PASTABA: Automatiškai aptinka Google Sheets locale (lt_LT, en_US ir kt.)
 * ir pritaiko formulių skyriklį (, arba ;)
 */

// Locale-aware formulių nustatymas
// Lietuvių locale naudoja ; vietoj , formulėse
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

  Logger.log("=== PRADEDAME SETUP ===");
  Logger.log("Sheet pavadinimas: " + ss.getName());
  Logger.log("Locale: " + ss.getSpreadsheetLocale());
  Logger.log("Visi lapai: " + ss.getSheets().map(function(s) { return s.getName(); }).join(", "));

  try {
    findOrMigrateSmsSheet_(ss);
    Logger.log("SMS migracija — OK");
  } catch (e) {
    Logger.log("SMS migracija KLAIDA: " + e.message);
    SpreadsheetApp.getUi().alert("SMS migracija nepavyko: " + e.message);
    return;
  }

  try {
    createCorrectionsSheet_(ss);
    Logger.log("Pataisymai — OK");
  } catch (e) {
    Logger.log("Pataisymai KLAIDA: " + e.message);
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

  Logger.log("=== SETUP BAIGTAS ===");
  Logger.log("Visi lapai po setup: " + ss.getSheets().map(function(s) { return s.getName(); }).join(", "));

  SpreadsheetApp.getUi().alert(
    "Viskas paruošta!\n\n" +
    "• Dashboard — pagrindinė informacija\n" +
    "• Pataisymai — AI atsakymų taisymas\n" +
    "• SMS — vertikalus pokalbių formatas\n\n" +
    "Dashboard formulės atsinaujina automatiškai."
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
    var logai = ss.getSheetByName("Logai");
    if (logai) {
      report.push("  Bet rastas 'Logai' lapas — reikia migruoti (paleisk setupDashboard)");
    }
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
    throw new Error("SMS lapas nerastas! Paleiskite setupDashboard dar kartą.");
  }
  Logger.log("Dashboard: SMS lapas rastas, eilučių: " + smsCheck.getLastRow());

  var sheet = ss.insertSheet("Dashboard", 0);

  var white = "#FFFFFF";
  var bgLight = "#F5F5F7";
  var cardBg = "#FFFFFF";
  var headerText = "#1D1D1F";
  var subText = "#86868B";
  var accent = "#007AFF";
  var green = "#34C759";
  var orange = "#FF9500";
  var red = "#FF3B30";
  var purple = "#AF52DE";
  var teal = "#5AC8FA";
  var borderColor = "#E5E5EA";

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

  sheet.getRange("A1:J55").setBackground(bgLight).setFontFamily("Helvetica Neue");

  // ===== HEADER =====
  sheet.setRowHeight(1, 55);
  sheet.getRange("B1:I1").merge().setValue("Proteros Servisas")
    .setFontSize(22).setFontWeight("bold").setFontColor(headerText)
    .setHorizontalAlignment("left").setVerticalAlignment("middle")
    .setBackground(bgLight);

  sheet.setRowHeight(2, 25);
  var headerRange = sheet.getRange("B2:I2").merge();
  setLocalFormula_(headerRange, '=TEXT(NOW(),"yyyy-MM-dd HH:mm")&"  ·  Valdymo pultas"');
  headerRange.setFontSize(11).setFontColor(subText)
    .setHorizontalAlignment("left").setBackground(bgLight);

  // ===== ROW 4-6: MAIN KPI CARDS =====
  sheet.setRowHeight(3, 10);

  appleKpiCard_(sheet, 4, "B", "C", "SMS šiandien",
    '=IFERROR(COUNTIFS(SMS!A:A,">="&TEXT(TODAY(),"yyyy-MM-dd"),SMS!A:A,"<"&TEXT(TODAY()+1,"yyyy-MM-dd")),0)',
    accent, cardBg, subText, borderColor);

  appleKpiCard_(sheet, 4, "E", "F", "Praleisti skambučiai",
    '=IFERROR(COUNTIFS(SMS!A:A,">="&TEXT(TODAY(),"yyyy-MM-dd"),SMS!A:A,"<"&TEXT(TODAY()+1,"yyyy-MM-dd"),SMS!D:D,"Praleistas skambutis"),0)',
    orange, cardBg, subText, borderColor);

  appleKpiCard_(sheet, 4, "H", "I", "Užsakymai",
    '=IFERROR(COUNTIFS(SMS!A:A,">="&TEXT(TODAY(),"yyyy-MM-dd"),SMS!A:A,"<"&TEXT(TODAY()+1,"yyyy-MM-dd"),SMS!D:D,"Booking"),0)',
    green, cardBg, subText, borderColor);

  sheet.setRowHeight(4, 22);
  sheet.setRowHeight(5, 50);
  sheet.setRowHeight(6, 8);

  appleKpiCard_(sheet, 7, "B", "C", "Klaidos",
    '=IFERROR(COUNTIFS(SMS!A:A,">="&TEXT(TODAY(),"yyyy-MM-dd"),SMS!A:A,"<"&TEXT(TODAY()+1,"yyyy-MM-dd"),SMS!D:D,"Klaida"),0)',
    red, cardBg, subText, borderColor);

  appleKpiCard_(sheet, 7, "E", "F", "Perdavimai savininkui",
    '=IFERROR(COUNTIFS(SMS!A:A,">="&TEXT(TODAY(),"yyyy-MM-dd"),SMS!A:A,"<"&TEXT(TODAY()+1,"yyyy-MM-dd"),SMS!D:D,"Perdavimas"),0)',
    purple, cardBg, subText, borderColor);

  appleKpiCard_(sheet, 7, "H", "I", "Laukia pataisymo",
    '=IFERROR(COUNTIF(Pataisymai!E:E,"Laukia pataisymo"),0)',
    teal, cardBg, subText, borderColor);

  sheet.setRowHeight(7, 22);
  sheet.setRowHeight(8, 50);

  // ===== ROW 10: STATISTIKA =====
  sheet.setRowHeight(9, 15);
  sheet.setRowHeight(10, 30);
  sheet.getRange("B10:I10").merge().setValue("Šiandienos statistika")
    .setFontSize(15).setFontWeight("bold").setFontColor(headerText)
    .setBackground(bgLight);

  sheet.setRowHeight(11, 22);
  var statsLabels = ["Rodiklis", "Kiekis"];
  sheet.getRange("B11:C11").setValues([statsLabels])
    .setFontWeight("bold").setFontSize(10).setFontColor(subText).setBackground(cardBg);
  sheet.getRange("E11:F11").setValues([statsLabels])
    .setFontWeight("bold").setFontSize(10).setFontColor(subText).setBackground(cardBg);
  sheet.getRange("H11:I11").setValues([statsLabels])
    .setFontWeight("bold").setFontSize(10).setFontColor(subText).setBackground(cardBg);

  var todayGte = '"&TEXT(TODAY(),"yyyy-MM-dd")';
  var tomorrowLt = '"&TEXT(TODAY()+1,"yyyy-MM-dd")';

  var leftStats = [
    ["Pokalbiai (AI)", '=IFERROR(COUNTIFS(SMS!A:A,">=' + todayGte + ',SMS!A:A,"<' + tomorrowLt + ',SMS!D:D,"Pokalbis",SMS!E:E,"Agentas"),0)'],
    ["Klientų žinutės", '=IFERROR(COUNTIFS(SMS!A:A,">=' + todayGte + ',SMS!A:A,"<' + tomorrowLt + ',SMS!E:E,"Klientas"),0)'],
    ["AI atsakymai", '=IFERROR(COUNTIFS(SMS!A:A,">=' + todayGte + ',SMS!A:A,"<' + tomorrowLt + ',SMS!E:E,"Agentas"),0)'],
  ];
  var midStats = [
    ["Uždaryti pokalbiai", '=IFERROR(COUNTIFS(SMS!A:A,">=' + todayGte + ',SMS!A:A,"<' + tomorrowLt + ',SMS!D:D,"Uždarytas"),0)'],
    ["Savininko booking", '=IFERROR(COUNTIFS(SMS!A:A,">=' + todayGte + ',SMS!A:A,"<' + tomorrowLt + ',SMS!D:D,"Savininko booking"),0)'],
    ["Pataisymai (viso)", '=IFERROR(COUNTA(Pataisymai!A2:A),0)'],
  ];
  var rightStats = [
    ["Konversija", '=IFERROR(TEXT(COUNTIFS(SMS!A:A,">=' + todayGte + ',SMS!A:A,"<' + tomorrowLt + ',SMS!D:D,"Booking")/COUNTIFS(SMS!A:A,">=' + todayGte + ',SMS!A:A,"<' + tomorrowLt + ',SMS!D:D,"Praleistas skambutis"),"0%"),"—")'],
    ["Sėkmės rodiklis", '=IFERROR(TEXT(1-COUNTIFS(SMS!A:A,">=' + todayGte + ',SMS!A:A,"<' + tomorrowLt + ',SMS!D:D,"Klaida")/COUNTIFS(SMS!A:A,">=' + todayGte + ',SMS!A:A,"<' + tomorrowLt + '),"0%"),"—")'],
    ["", ""],
  ];

  for (var i = 0; i < 3; i++) {
    var row = 12 + i;
    sheet.setRowHeight(row, 28);
    sheet.getRange("B" + row).setValue(leftStats[i][0]).setFontColor(headerText).setFontSize(11).setBackground(cardBg);
    setLocalFormula_(sheet.getRange("C" + row), leftStats[i][1]).setFontColor(headerText).setFontSize(12).setFontWeight("bold").setHorizontalAlignment("center").setBackground(cardBg);
    sheet.getRange("E" + row).setValue(midStats[i][0]).setFontColor(headerText).setFontSize(11).setBackground(cardBg);
    setLocalFormula_(sheet.getRange("F" + row), midStats[i][1]).setFontColor(headerText).setFontSize(12).setFontWeight("bold").setHorizontalAlignment("center").setBackground(cardBg);
    if (rightStats[i][0]) {
      sheet.getRange("H" + row).setValue(rightStats[i][0]).setFontColor(headerText).setFontSize(11).setBackground(cardBg);
      setLocalFormula_(sheet.getRange("I" + row), rightStats[i][1]).setFontColor(accent).setFontSize(12).setFontWeight("bold").setHorizontalAlignment("center").setBackground(cardBg);
    }
  }

  sheet.getRange("B11:C14").setBorder(true, true, true, true, false, false, borderColor, SpreadsheetApp.BorderStyle.SOLID);
  sheet.getRange("E11:F14").setBorder(true, true, true, true, false, false, borderColor, SpreadsheetApp.BorderStyle.SOLID);
  sheet.getRange("H11:I13").setBorder(true, true, true, true, false, false, borderColor, SpreadsheetApp.BorderStyle.SOLID);

  // ===== SAVAITĖS APŽVALGA =====
  sheet.setRowHeight(15, 15);
  sheet.setRowHeight(16, 30);
  sheet.getRange("B16:I16").merge().setValue("Savaitės apžvalga")
    .setFontSize(15).setFontWeight("bold").setFontColor(headerText).setBackground(bgLight);

  sheet.setRowHeight(17, 24);
  sheet.getRange("B17:H17").setValues([["Diena", "SMS", "Skambučiai", "Booking", "Klaidos", "Perdavimai", ""]])
    .setFontWeight("bold").setFontSize(10).setFontColor(subText).setBackground(cardBg);
  sheet.getRange("B17:H17").setBorder(true, true, false, true, false, false, borderColor, SpreadsheetApp.BorderStyle.SOLID);

  for (var d = 0; d < 7; d++) {
    var row = 18 + d;
    sheet.setRowHeight(row, 26);
    var rowBg = d % 2 === 0 ? cardBg : bgLight;
    var dayStart = 'TEXT(TODAY()-' + d + ',"yyyy-MM-dd")';
    var dayEnd = 'TEXT(TODAY()-' + (d - 1) + ',"yyyy-MM-dd")';

    setLocalFormula_(sheet.getRange("B" + row), '=TEXT(TODAY()-' + d + ',"MM-dd, ddd")')
      .setFontColor(headerText).setFontSize(11).setBackground(rowBg);
    setLocalFormula_(sheet.getRange("C" + row), '=IFERROR(COUNTIFS(SMS!A:A,">="&' + dayStart + ',SMS!A:A,"<"&' + dayEnd + '),0)')
      .setFontColor(headerText).setFontWeight("bold").setHorizontalAlignment("center").setBackground(rowBg);
    setLocalFormula_(sheet.getRange("D" + row), '=IFERROR(COUNTIFS(SMS!A:A,">="&' + dayStart + ',SMS!A:A,"<"&' + dayEnd + ',SMS!D:D,"Praleistas skambutis"),0)')
      .setFontColor(orange).setFontWeight("bold").setHorizontalAlignment("center").setBackground(rowBg);
    setLocalFormula_(sheet.getRange("E" + row), '=IFERROR(COUNTIFS(SMS!A:A,">="&' + dayStart + ',SMS!A:A,"<"&' + dayEnd + ',SMS!D:D,"Booking"),0)')
      .setFontColor(green).setFontWeight("bold").setHorizontalAlignment("center").setBackground(rowBg);
    setLocalFormula_(sheet.getRange("F" + row), '=IFERROR(COUNTIFS(SMS!A:A,">="&' + dayStart + ',SMS!A:A,"<"&' + dayEnd + ',SMS!D:D,"Klaida"),0)')
      .setFontColor(red).setFontWeight("bold").setHorizontalAlignment("center").setBackground(rowBg);
    setLocalFormula_(sheet.getRange("G" + row), '=IFERROR(COUNTIFS(SMS!A:A,">="&' + dayStart + ',SMS!A:A,"<"&' + dayEnd + ',SMS!D:D,"Perdavimas"),0)')
      .setFontColor(purple).setFontWeight("bold").setHorizontalAlignment("center").setBackground(rowBg);
  }
  sheet.getRange("B17:G24").setBorder(true, true, true, true, false, false, borderColor, SpreadsheetApp.BorderStyle.SOLID);

  // ===== PASKUTINĖS KLAIDOS =====
  sheet.setRowHeight(25, 15);
  sheet.setRowHeight(26, 30);
  sheet.getRange("B26:I26").merge().setValue("Paskutinės klaidos")
    .setFontSize(15).setFontWeight("bold").setFontColor(red).setBackground(bgLight);

  sheet.setRowHeight(27, 22);
  sheet.getRange("B27:I27").setValues([["Data", "Telefonas", "", "Klaidos aprašymas", "", "", "", ""]])
    .setFontWeight("bold").setFontSize(10).setFontColor(subText).setBackground(cardBg);

  for (var i = 0; i < 5; i++) {
    var row = 28 + i;
    sheet.setRowHeight(row, 26);
    var rowBg = i % 2 === 0 ? cardBg : bgLight;
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
    errDescRange.setFontColor(red).setFontSize(10).setBackground(rowBg).setWrap(true);
  }
  sheet.getRange("B27:I32").setBorder(true, true, true, true, false, false, borderColor, SpreadsheetApp.BorderStyle.SOLID);

  // ===== PASKUTINIAI POKALBIAI =====
  sheet.setRowHeight(33, 15);
  sheet.setRowHeight(34, 30);
  sheet.getRange("B34:I34").merge().setValue("Paskutiniai pokalbiai")
    .setFontSize(15).setFontWeight("bold").setFontColor(headerText).setBackground(bgLight);

  sheet.setRowHeight(35, 22);
  sheet.getRange("B35:I35").setValues([["Data", "Vardas", "Tel.", "Tipas", "Siuntėjas", "Žinutė", "", ""]])
    .setFontWeight("bold").setFontSize(10).setFontColor(subText).setBackground(cardBg);

  for (var i = 0; i < 10; i++) {
    var row = 36 + i;
    sheet.setRowHeight(row, 26);
    var rowBg = i % 2 === 0 ? cardBg : bgLight;
    var smsRows = 'COUNTA(SMS!A:A)';
    var targetRow = smsRows + '+1-' + (i + 1);
    var cols = ["A", "B", "C", "D", "E", "F"];
    var colTargets = ["B", "C", "D", "E", "F", "G"];
    for (var c = 0; c < cols.length; c++) {
      var formula = '=IF(' + smsRows + '>=' + (i + 2) + ',INDEX(SMS!' + cols[c] + ':' + cols[c] + ',' + targetRow + '),"")';
      if (c === 5) {
        var msgRange = sheet.getRange(colTargets[c] + row + ":I" + row).merge();
        setLocalFormula_(msgRange, formula);
        msgRange.setFontColor(headerText).setFontSize(10).setBackground(rowBg).setWrap(true);
      } else if (c === 4) {
        setLocalFormula_(sheet.getRange(colTargets[c] + row), formula)
          .setFontColor(accent).setFontSize(10).setFontWeight("bold").setBackground(rowBg);
      } else {
        setLocalFormula_(sheet.getRange(colTargets[c] + row), formula)
          .setFontColor(headerText).setFontSize(10).setBackground(rowBg);
      }
    }
  }
  sheet.getRange("B35:I45").setBorder(true, true, true, true, false, false, borderColor, SpreadsheetApp.BorderStyle.SOLID);

  sheet.protect().setDescription("Dashboard — automatinės formulės").setWarningOnly(true);
  sheet.setHiddenGridlines(true);
}

function appleKpiCard_(sheet, startRow, col1, col2, label, formula, valueColor, cardBg, subText, borderColor) {
  sheet.getRange(col1 + startRow + ":" + col2 + startRow).merge()
    .setValue(label)
    .setFontSize(11).setFontColor(subText)
    .setBackground(cardBg).setHorizontalAlignment("center").setVerticalAlignment("bottom");

  var valueRow = startRow + 1;
  var valueRange = sheet.getRange(col1 + valueRow + ":" + col2 + valueRow).merge();
  setLocalFormula_(valueRange, formula);
  valueRange.setFontSize(32).setFontWeight("bold").setFontColor(valueColor)
    .setHorizontalAlignment("center").setVerticalAlignment("middle")
    .setBackground(cardBg);

  sheet.getRange(col1 + startRow + ":" + col2 + valueRow)
    .setBorder(true, true, true, true, false, false, borderColor, SpreadsheetApp.BorderStyle.SOLID);
}

// ==================== PATAISYMAI ====================

function createCorrectionsSheet_(ss) {
  if (ss.getSheetByName("Pataisymai")) {
    Logger.log("Pataisymai lapas jau egzistuoja");
    return;
  }

  var sheet = ss.insertSheet("Pataisymai");

  var header = ["Kliento žinutė", "Blogas atsakymas", "Teisingas atsakymas", "Pastaba", "Statusas"];
  sheet.getRange(1, 1, 1, 5).setValues([header]);
  sheet.getRange("A1:E1").setFontWeight("bold").setFontSize(11)
    .setBackground("#F5F5F7").setFontColor("#1D1D1F")
    .setBorder(false, false, true, false, false, false, "#E5E5EA", SpreadsheetApp.BorderStyle.SOLID);

  sheet.setColumnWidth(1, 300);
  sheet.setColumnWidth(2, 300);
  sheet.setColumnWidth(3, 300);
  sheet.setColumnWidth(4, 200);
  sheet.setColumnWidth(5, 130);
  sheet.setFrozenRows(1);

  var example = [
    "Ar galima atvežti BMW?",
    "Taip, priimame visus automobilius.",
    "Taip, BMW aptarnaujame. Kokia problema? Galiu pasiūlyti laiką vizitui.",
    "Pavyzdys",
    "Pataisyta"
  ];
  sheet.getRange(2, 1, 1, 5).setValues([example]);
  sheet.getRange("A2:E2").setFontColor("#86868B").setFontStyle("italic");

  sheet.getRange("A4").setValue("Kai app atsakė blogai — nukopijuok kliento žinutę ir blogą atsakymą čia, parašyk teisingą atsakymą, pakeisk statusą į \"Pataisyta\". App mokysis iš šių pataisymų.")
    .setFontColor("#86868B").setFontStyle("italic");
  sheet.getRange("A4:E4").merge();
  Logger.log("Pataisymai lapas sukurtas");
}

// ==================== SMS MIGRACIJA ====================

function findOrMigrateSmsSheet_(ss) {
  var smsSheet = ss.getSheetByName("SMS");
  var logaiSheet = ss.getSheetByName("Logai");

  Logger.log("SMS lapas: " + (smsSheet ? "rastas" : "nerastas"));
  Logger.log("Logai lapas: " + (logaiSheet ? "rastas" : "nerastas"));

  if (smsSheet) {
    var lastCol = smsSheet.getLastColumn();
    Logger.log("SMS stulpelių: " + lastCol + ", eilučių: " + smsSheet.getLastRow());

    if (lastCol >= 5) {
      var header = smsSheet.getRange("A1:F1").getValues()[0];
      Logger.log("SMS header: " + header.join(" | "));

      if (header[4] === "Siuntėjas") {
        Logger.log("SMS jau teisingo formato — nieko nedaryti");
        return;
      }

      if (header[4] === "Kliento žinutė") {
        Logger.log("SMS seno horizontalaus formato — migruojam");
        migrateHorizontal6ToVertical_(smsSheet);
        return;
      }

      if (header[3] === "Žinutė" && header[4] === "AI atsakymas") {
        Logger.log("SMS su Logai formatu (5 stulpeliai) — migruojam");
        migrateLogaiFormatToVertical_(smsSheet);
        return;
      }
    }

    Logger.log("SMS lapas rastas bet neatpažintas formatas — perkuriam header");
    smsSheet.getRange("A1:F1").setValues([["Data", "Vardas", "Telefonas", "Tipas", "Siuntėjas", "Žinutė"]]);
    smsSheet.getRange("A1:F1").setFontWeight("bold").setFontSize(11)
      .setBackground("#F5F5F7").setFontColor("#1D1D1F");
    return;
  }

  if (logaiSheet) {
    Logger.log("Migruojam Logai → SMS");
    migrateLogaiToSms_(logaiSheet);
    return;
  }

  Logger.log("Nei SMS nei Logai nerasta — kuriam naują SMS lapą");
  var sheet = ss.insertSheet("SMS");
  sheet.getRange("A1:F1").setValues([["Data", "Vardas", "Telefonas", "Tipas", "Siuntėjas", "Žinutė"]]);
  sheet.getRange("A1:F1").setFontWeight("bold").setFontSize(11)
    .setBackground("#F5F5F7").setFontColor("#1D1D1F");
  sheet.setColumnWidth(1, 140);
  sheet.setColumnWidth(2, 120);
  sheet.setColumnWidth(3, 120);
  sheet.setColumnWidth(4, 130);
  sheet.setColumnWidth(5, 90);
  sheet.setColumnWidth(6, 400);
  sheet.setFrozenRows(1);
}

function migrateLogaiToSms_(logaiSheet) {
  var lastRow = logaiSheet.getLastRow();
  Logger.log("Logai eilučių: " + lastRow);
  var newRows = [];

  if (lastRow > 1) {
    var data = logaiSheet.getRange(2, 1, lastRow - 1, 5).getValues();

    for (var i = 0; i < data.length; i++) {
      var timestamp = data[i][0];
      var phone = data[i][1] ? data[i][1].toString() : "";
      var type = data[i][2] ? data[i][2].toString() : "";
      var message = data[i][3] ? data[i][3].toString() : "";
      var aiReply = data[i][4] ? data[i][4].toString() : "";

      if (!timestamp && !phone && !message && !aiReply) continue;

      var sender = "Klientas";
      if (type === "Praleistas skambutis" || type === "Perdavimas" ||
          type === "Uždarytas" || type === "Klaida") {
        sender = "Sistema";
      }

      if (message) {
        newRows.push([timestamp, "", phone, type, sender, message]);
      }
      if (aiReply) {
        newRows.push([timestamp, "", phone, type, "Agentas", aiReply]);
      }
    }
  }

  logaiSheet.setName("SMS");
  logaiSheet.clear();

  logaiSheet.getRange("A1:F1").setValues([["Data", "Vardas", "Telefonas", "Tipas", "Siuntėjas", "Žinutė"]]);
  logaiSheet.getRange("A1:F1").setFontWeight("bold").setFontSize(11)
    .setBackground("#F5F5F7").setFontColor("#1D1D1F");
  logaiSheet.setColumnWidth(1, 140);
  logaiSheet.setColumnWidth(2, 120);
  logaiSheet.setColumnWidth(3, 120);
  logaiSheet.setColumnWidth(4, 130);
  logaiSheet.setColumnWidth(5, 90);
  logaiSheet.setColumnWidth(6, 400);
  logaiSheet.setFrozenRows(1);

  if (newRows.length > 0) {
    logaiSheet.getRange(2, 1, newRows.length, 6).setValues(newRows);
  }
  Logger.log("Logai → SMS migracija baigta, naujų eilučių: " + newRows.length);
}

function migrateLogaiFormatToVertical_(smsSheet) {
  var lastRow = smsSheet.getLastRow();
  var newRows = [];

  if (lastRow > 1) {
    var data = smsSheet.getRange(2, 1, lastRow - 1, 5).getValues();

    for (var i = 0; i < data.length; i++) {
      var timestamp = data[i][0];
      var phone = data[i][1] ? data[i][1].toString() : "";
      var type = data[i][2] ? data[i][2].toString() : "";
      var message = data[i][3] ? data[i][3].toString() : "";
      var aiReply = data[i][4] ? data[i][4].toString() : "";

      if (!timestamp && !phone && !message && !aiReply) continue;

      var sender = "Klientas";
      if (type === "Praleistas skambutis" || type === "Perdavimas" ||
          type === "Uždarytas" || type === "Klaida") {
        sender = "Sistema";
      }

      if (message) {
        newRows.push([timestamp, "", phone, type, sender, message]);
      }
      if (aiReply) {
        newRows.push([timestamp, "", phone, type, "Agentas", aiReply]);
      }
    }
  }

  smsSheet.clear();
  smsSheet.getRange("A1:F1").setValues([["Data", "Vardas", "Telefonas", "Tipas", "Siuntėjas", "Žinutė"]]);
  smsSheet.getRange("A1:F1").setFontWeight("bold").setFontSize(11)
    .setBackground("#F5F5F7").setFontColor("#1D1D1F");
  smsSheet.setColumnWidth(1, 140);
  smsSheet.setColumnWidth(2, 120);
  smsSheet.setColumnWidth(3, 120);
  smsSheet.setColumnWidth(4, 130);
  smsSheet.setColumnWidth(5, 90);
  smsSheet.setColumnWidth(6, 400);
  smsSheet.setFrozenRows(1);

  if (newRows.length > 0) {
    smsSheet.getRange(2, 1, newRows.length, 6).setValues(newRows);
  }
  Logger.log("SMS Logai-formato migracija baigta, naujų eilučių: " + newRows.length);
}

function migrateHorizontal6ToVertical_(smsSheet) {
  var lastRow = smsSheet.getLastRow();
  Logger.log("Horizontalaus formato migracija, eilučių: " + lastRow);

  if (lastRow <= 1) {
    smsSheet.getRange("E1").setValue("Siuntėjas");
    smsSheet.getRange("F1").setValue("Žinutė");
    return;
  }

  var data = smsSheet.getRange(2, 1, lastRow - 1, 6).getValues();
  var newRows = [];

  for (var i = 0; i < data.length; i++) {
    var timestamp = data[i][0];
    var name = data[i][1] ? data[i][1].toString() : "";
    var phone = data[i][2] ? data[i][2].toString() : "";
    var type = data[i][3] ? data[i][3].toString() : "";
    var clientMsg = data[i][4] ? data[i][4].toString() : "";
    var aiReply = data[i][5] ? data[i][5].toString() : "";

    if (!timestamp && !phone && !clientMsg && !aiReply) continue;

    var sender = "Klientas";
    if (type === "Praleistas skambutis" || type === "Perdavimas" ||
        type === "Uždarytas" || type === "Klaida") {
      sender = "Sistema";
    }

    if (clientMsg) {
      newRows.push([timestamp, name, phone, type, sender, clientMsg]);
    }
    if (aiReply) {
      newRows.push([timestamp, name, phone, type, "Agentas", aiReply]);
    }
  }

  smsSheet.clear();
  smsSheet.getRange("A1:F1").setValues([["Data", "Vardas", "Telefonas", "Tipas", "Siuntėjas", "Žinutė"]]);
  smsSheet.getRange("A1:F1").setFontWeight("bold").setFontSize(11)
    .setBackground("#F5F5F7").setFontColor("#1D1D1F");

  if (newRows.length > 0) {
    smsSheet.getRange(2, 1, newRows.length, 6).setValues(newRows);
  }
  Logger.log("Horizontalaus formato migracija baigta, naujų eilučių: " + newRows.length);
}
