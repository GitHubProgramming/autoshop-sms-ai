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
 */

function setupDashboard() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  findOrMigrateSmsSheet_(ss);
  createCorrectionsSheet_(ss);
  createDashboardSheet_(ss);

  var dashboard = ss.getSheetByName("Dashboard");
  if (dashboard) dashboard.activate();

  SpreadsheetApp.getUi().alert(
    "Viskas paruošta!\n\n" +
    "• Dashboard — pagrindinė informacija\n" +
    "• Pataisymai — AI atsakymų taisymas\n" +
    "• SMS — vertikalus pokalbių formatas\n\n" +
    "Dashboard formulės atsinaujina automatiškai."
  );
}

// ==================== DASHBOARD ====================

function createDashboardSheet_(ss) {
  var existing = ss.getSheetByName("Dashboard");
  if (existing) ss.deleteSheet(existing);

  var sheet = ss.insertSheet("Dashboard", 0);

  // --- Colors (Apple light) ---
  var white = "#FFFFFF";
  var bgLight = "#F5F5F7";       // Apple gray bg
  var cardBg = "#FFFFFF";
  var headerText = "#1D1D1F";    // Apple black
  var subText = "#86868B";       // Apple gray text
  var accent = "#007AFF";        // Apple blue
  var green = "#34C759";
  var orange = "#FF9500";
  var red = "#FF3B30";
  var purple = "#AF52DE";
  var teal = "#5AC8FA";
  var borderColor = "#E5E5EA";   // Apple border

  // Column widths
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

  // Full background
  sheet.getRange("A1:J55").setBackground(bgLight).setFontFamily("Helvetica Neue");

  // ===== HEADER =====
  sheet.setRowHeight(1, 55);
  sheet.getRange("B1:I1").merge().setValue("Proteros Servisas")
    .setFontSize(22).setFontWeight("bold").setFontColor(headerText)
    .setHorizontalAlignment("left").setVerticalAlignment("middle")
    .setBackground(bgLight);

  sheet.setRowHeight(2, 25);
  sheet.getRange("B2:I2").merge()
    .setFormula('=TEXT(NOW(),"yyyy-MM-dd HH:mm") & "  ·  Valdymo pultas"')
    .setFontSize(11).setFontColor(subText)
    .setHorizontalAlignment("left").setBackground(bgLight);

  // ===== ROW 4-6: MAIN KPI CARDS =====
  sheet.setRowHeight(3, 10);

  // KPI 1: SMS šiandien
  appleKpiCard_(sheet, 4, "B", "C", "SMS šiandien",
    '=COUNTIFS(SMS!A:A,">="&TEXT(TODAY(),"yyyy-MM-dd"),SMS!A:A,"<"&TEXT(TODAY()+1,"yyyy-MM-dd"))',
    accent, cardBg, subText, borderColor);

  // KPI 2: Praleisti skambučiai
  appleKpiCard_(sheet, 4, "E", "F", "Praleisti skambučiai",
    '=COUNTIFS(SMS!A:A,">="&TEXT(TODAY(),"yyyy-MM-dd"),SMS!D:D,"Praleistas skambutis")',
    orange, cardBg, subText, borderColor);

  // KPI 3: Booking
  appleKpiCard_(sheet, 4, "H", "I", "Užsakymai",
    '=COUNTIFS(SMS!A:A,">="&TEXT(TODAY(),"yyyy-MM-dd"),SMS!D:D,"Booking")',
    green, cardBg, subText, borderColor);

  sheet.setRowHeight(4, 22);
  sheet.setRowHeight(5, 50);
  sheet.setRowHeight(6, 8);

  // KPI 4: Klaidos
  appleKpiCard_(sheet, 7, "B", "C", "Klaidos",
    '=COUNTIFS(SMS!A:A,">="&TEXT(TODAY(),"yyyy-MM-dd"),SMS!D:D,"Klaida")',
    red, cardBg, subText, borderColor);

  // KPI 5: Perdavimai
  appleKpiCard_(sheet, 7, "E", "F", "Perdavimai savininkui",
    '=COUNTIFS(SMS!A:A,">="&TEXT(TODAY(),"yyyy-MM-dd"),SMS!D:D,"Perdavimas")',
    purple, cardBg, subText, borderColor);

  // KPI 6: Pataisymai laukia
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

  // Stats table
  sheet.setRowHeight(11, 22);
  var statsLabels = ["Rodiklis", "Kiekis"];
  sheet.getRange("B11:C11").setValues([statsLabels])
    .setFontWeight("bold").setFontSize(10).setFontColor(subText).setBackground(cardBg);
  sheet.getRange("E11:F11").setValues([statsLabels])
    .setFontWeight("bold").setFontSize(10).setFontColor(subText).setBackground(cardBg);
  sheet.getRange("H11:I11").setValues([statsLabels])
    .setFontWeight("bold").setFontSize(10).setFontColor(subText).setBackground(cardBg);

  // Left column stats
  var leftStats = [
    ["Pokalbiai (AI)", '=COUNTIFS(SMS!A:A,">="&TEXT(TODAY(),"yyyy-MM-dd"),SMS!D:D,"Pokalbis",SMS!E:E,"Agentas")'],
    ["Klientų žinutės", '=COUNTIFS(SMS!A:A,">="&TEXT(TODAY(),"yyyy-MM-dd"),SMS!E:E,"Klientas")'],
    ["AI atsakymai", '=COUNTIFS(SMS!A:A,">="&TEXT(TODAY(),"yyyy-MM-dd"),SMS!E:E,"Agentas")'],
  ];
  // Middle column stats
  var midStats = [
    ["Uždaryti pokalbiai", '=COUNTIFS(SMS!A:A,">="&TEXT(TODAY(),"yyyy-MM-dd"),SMS!D:D,"Uždarytas")'],
    ["Savininko booking", '=COUNTIFS(SMS!A:A,">="&TEXT(TODAY(),"yyyy-MM-dd"),SMS!D:D,"Savininko booking")'],
    ["Pataisymai (viso)", '=IFERROR(COUNTA(Pataisymai!A2:A),0)'],
  ];
  // Right column stats
  var rightStats = [
    ["Konversija", '=IFERROR(TEXT(COUNTIFS(SMS!A:A,">="&TEXT(TODAY(),"yyyy-MM-dd"),SMS!D:D,"Booking")/COUNTIFS(SMS!A:A,">="&TEXT(TODAY(),"yyyy-MM-dd"),SMS!D:D,"Praleistas skambutis"),"0%"),"—")'],
    ["Sėkmės rodiklis", '=IFERROR(TEXT(1-COUNTIFS(SMS!A:A,">="&TEXT(TODAY(),"yyyy-MM-dd"),SMS!D:D,"Klaida")/COUNTIFS(SMS!A:A,">="&TEXT(TODAY(),"yyyy-MM-dd"),SMS!A:A,"<"&TEXT(TODAY()+1,"yyyy-MM-dd")),"0%"),"—")'],
    ["", ""],
  ];

  for (var i = 0; i < 3; i++) {
    var row = 12 + i;
    sheet.setRowHeight(row, 28);
    // Left
    sheet.getRange("B" + row).setValue(leftStats[i][0]).setFontColor(headerText).setFontSize(11).setBackground(cardBg);
    sheet.getRange("C" + row).setFormula(leftStats[i][1]).setFontColor(headerText).setFontSize(12).setFontWeight("bold").setHorizontalAlignment("center").setBackground(cardBg);
    // Mid
    sheet.getRange("E" + row).setValue(midStats[i][0]).setFontColor(headerText).setFontSize(11).setBackground(cardBg);
    sheet.getRange("F" + row).setFormula(midStats[i][1]).setFontColor(headerText).setFontSize(12).setFontWeight("bold").setHorizontalAlignment("center").setBackground(cardBg);
    // Right
    if (rightStats[i][0]) {
      sheet.getRange("H" + row).setValue(rightStats[i][0]).setFontColor(headerText).setFontSize(11).setBackground(cardBg);
      sheet.getRange("I" + row).setFormula(rightStats[i][1]).setFontColor(accent).setFontSize(12).setFontWeight("bold").setHorizontalAlignment("center").setBackground(cardBg);
    }
  }

  // Card borders for stats
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

    sheet.getRange("B" + row).setFormula('=TEXT(TODAY()-' + d + ',"MM-dd, ddd")')
      .setFontColor(headerText).setFontSize(11).setBackground(rowBg);
    sheet.getRange("C" + row).setFormula('=COUNTIFS(SMS!A:A,">="&TEXT(TODAY()-' + d + ',"yyyy-MM-dd"),SMS!A:A,"<"&TEXT(TODAY()-' + (d-1) + ',"yyyy-MM-dd"))')
      .setFontColor(headerText).setFontWeight("bold").setHorizontalAlignment("center").setBackground(rowBg);
    sheet.getRange("D" + row).setFormula('=COUNTIFS(SMS!A:A,">="&TEXT(TODAY()-' + d + ',"yyyy-MM-dd"),SMS!A:A,"<"&TEXT(TODAY()-' + (d-1) + ',"yyyy-MM-dd"),SMS!D:D,"Praleistas skambutis")')
      .setFontColor(orange).setFontWeight("bold").setHorizontalAlignment("center").setBackground(rowBg);
    sheet.getRange("E" + row).setFormula('=COUNTIFS(SMS!A:A,">="&TEXT(TODAY()-' + d + ',"yyyy-MM-dd"),SMS!A:A,"<"&TEXT(TODAY()-' + (d-1) + ',"yyyy-MM-dd"),SMS!D:D,"Booking")')
      .setFontColor(green).setFontWeight("bold").setHorizontalAlignment("center").setBackground(rowBg);
    sheet.getRange("F" + row).setFormula('=COUNTIFS(SMS!A:A,">="&TEXT(TODAY()-' + d + ',"yyyy-MM-dd"),SMS!A:A,"<"&TEXT(TODAY()-' + (d-1) + ',"yyyy-MM-dd"),SMS!D:D,"Klaida")')
      .setFontColor(red).setFontWeight("bold").setHorizontalAlignment("center").setBackground(rowBg);
    sheet.getRange("G" + row).setFormula('=COUNTIFS(SMS!A:A,">="&TEXT(TODAY()-' + d + ',"yyyy-MM-dd"),SMS!A:A,"<"&TEXT(TODAY()-' + (d-1) + ',"yyyy-MM-dd"),SMS!D:D,"Perdavimas")')
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
    sheet.getRange("B" + row).setFormula(
      '=IFERROR(INDEX(FILTER(SMS!A:A,SMS!D:D="Klaida"),COUNTA(FILTER(SMS!A:A,SMS!D:D="Klaida"))-' + i + '),"—")')
      .setFontColor(subText).setFontSize(10).setBackground(rowBg);
    sheet.getRange("C" + row).setFormula(
      '=IFERROR(INDEX(FILTER(SMS!C:C,SMS!D:D="Klaida"),COUNTA(FILTER(SMS!C:C,SMS!D:D="Klaida"))-' + i + '),"—")')
      .setFontColor(headerText).setFontSize(10).setBackground(rowBg);
    sheet.getRange("D" + row + ":I" + row).merge().setFormula(
      '=IFERROR(INDEX(FILTER(SMS!F:F,SMS!D:D="Klaida"),COUNTA(FILTER(SMS!F:F,SMS!D:D="Klaida"))-' + i + '),"—")')
      .setFontColor(red).setFontSize(10).setBackground(rowBg).setWrap(true);
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
    var cols = ["A", "B", "C", "D", "E", "F"];
    var colTargets = ["B", "C", "D", "E", "F", "G"];
    for (var c = 0; c < cols.length; c++) {
      var formula = '=IFERROR(INDEX(SMS!' + cols[c] + ':' + cols[c] + ',COUNTA(SMS!A:A)+1-' + (i + 1) + '),"")';
      if (c === 5) {
        sheet.getRange(colTargets[c] + row + ":I" + row).merge().setFormula(formula)
          .setFontColor(headerText).setFontSize(10).setBackground(rowBg).setWrap(true);
      } else if (c === 4) {
        sheet.getRange(colTargets[c] + row).setFormula(formula)
          .setFontColor(accent).setFontSize(10).setFontWeight("bold").setBackground(rowBg);
      } else {
        sheet.getRange(colTargets[c] + row).setFormula(formula)
          .setFontColor(headerText).setFontSize(10).setBackground(rowBg);
      }
    }
  }
  sheet.getRange("B35:I45").setBorder(true, true, true, true, false, false, borderColor, SpreadsheetApp.BorderStyle.SOLID);

  // Protect + gridlines
  sheet.protect().setDescription("Dashboard — automatinės formulės").setWarningOnly(true);
  sheet.setHiddenGridlines(true);
}

function appleKpiCard_(sheet, startRow, col1, col2, label, formula, valueColor, cardBg, subText, borderColor) {
  // Label row
  sheet.getRange(col1 + startRow + ":" + col2 + startRow).merge()
    .setValue(label)
    .setFontSize(11).setFontColor(subText)
    .setBackground(cardBg).setHorizontalAlignment("center").setVerticalAlignment("bottom");

  // Value row
  var valueRow = startRow + 1;
  sheet.getRange(col1 + valueRow + ":" + col2 + valueRow).merge()
    .setFormula(formula)
    .setFontSize(32).setFontWeight("bold").setFontColor(valueColor)
    .setHorizontalAlignment("center").setVerticalAlignment("middle")
    .setBackground(cardBg);

  // Card border (rounded look via border)
  sheet.getRange(col1 + startRow + ":" + col2 + valueRow)
    .setBorder(true, true, true, true, false, false, borderColor, SpreadsheetApp.BorderStyle.SOLID);
}

// ==================== PATAISYMAI ====================

function createCorrectionsSheet_(ss) {
  if (ss.getSheetByName("Pataisymai")) return;

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
}

// ==================== SMS MIGRACIJA ====================

function findOrMigrateSmsSheet_(ss) {
  var smsSheet = ss.getSheetByName("SMS");
  var logaiSheet = ss.getSheetByName("Logai");

  // 1. Jei "SMS" jau yra su teisingu formatu — nieko nedaryti
  if (smsSheet) {
    var header = smsSheet.getRange("A1:F1").getValues()[0];
    if (header[4] === "Siuntėjas") return; // jau vertikalus

    // "SMS" su senu 6-stulpeliu horizontaliu formatu
    if (header[4] === "Kliento žinutė") {
      migrateHorizontal6ToVertical_(smsSheet);
      return;
    }
  }

  // 2. Jei "Logai" egzistuoja — migruoti į "SMS"
  if (logaiSheet) {
    migrateLogaiToSms_(logaiSheet);
    return;
  }

  // 3. Nieko nerasta — sukurti tuščią "SMS" lapą
  if (!smsSheet) {
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
}

// "Logai" lapas (5 stulpeliai): Data | Telefonas | Tipas | Žinutė | AI atsakymas
// → "SMS" lapas (6 stulpeliai): Data | Vardas | Telefonas | Tipas | Siuntėjas | Žinutė
function migrateLogaiToSms_(logaiSheet) {
  var lastRow = logaiSheet.getLastRow();
  var newRows = [];

  if (lastRow > 1) {
    var data = logaiSheet.getRange(2, 1, lastRow - 1, 5).getValues();

    for (var i = 0; i < data.length; i++) {
      var timestamp = data[i][0];
      var phone = data[i][1] ? data[i][1].toString() : "";
      var type = data[i][2] ? data[i][2].toString() : "";
      var message = data[i][3] ? data[i][3].toString() : "";
      var aiReply = data[i][4] ? data[i][4].toString() : "";

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

  // Pervadinti "Logai" → "SMS"
  logaiSheet.setName("SMS");

  // Išvalyti senus duomenis
  if (lastRow > 0) {
    logaiSheet.clear();
  }

  // Naujas header (6 stulpeliai)
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
}

// "SMS" su senu horizontaliu formatu (6 stulpeliai):
// Data | Vardas | Telefonas | Tipas | Kliento žinutė | AI atsakymas
function migrateHorizontal6ToVertical_(smsSheet) {
  var lastRow = smsSheet.getLastRow();
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
}
