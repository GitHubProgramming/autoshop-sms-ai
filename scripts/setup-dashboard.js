/**
 * PROTEROS SERVISAS — Dashboard + Pataisymai + SMS migracija
 *
 * INSTRUKCIJA:
 * 1. Atidaryk savo Proteros žinių bazės Sheet'ą
 * 2. Viršuje paspausk: Extensions → Apps Script
 * 3. Ištrink esamą kodą ir įklijuok visą šį kodą
 * 4. Paspausk ▶ Run (paleisk funkciją setupDashboard)
 * 5. Leisk prieigą kai paprašys
 * 6. Dashboard, Pataisymai lapai bus sukurti automatiškai
 */

function setupDashboard() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  migrateSmsToVertical_(ss);
  createCorrectionsSheet_(ss);
  createDashboardSheet_(ss);

  var dashboard = ss.getSheetByName("📊 Dashboard");
  if (dashboard) dashboard.activate();

  SpreadsheetApp.getUi().alert(
    "✅ Viskas paruošta!\n\n" +
    "• 📊 Dashboard — pagrindinė informacija\n" +
    "• 📝 Pataisymai — AI atsakymų taisymas\n" +
    "• SMS — vertikalus pokalbių formatas\n\n" +
    "Dashboard atsinaujina automatiškai kas kartą atidarius Sheet'ą."
  );
}

// ==================== DASHBOARD ====================

function createDashboardSheet_(ss) {
  var existing = ss.getSheetByName("📊 Dashboard");
  if (existing) ss.deleteSheet(existing);

  var sheet = ss.insertSheet("📊 Dashboard", 0);

  // Column widths
  sheet.setColumnWidth(1, 30);   // spacer
  sheet.setColumnWidth(2, 220);
  sheet.setColumnWidth(3, 140);
  sheet.setColumnWidth(4, 30);   // spacer
  sheet.setColumnWidth(5, 220);
  sheet.setColumnWidth(6, 140);
  sheet.setColumnWidth(7, 30);   // spacer
  sheet.setColumnWidth(8, 220);
  sheet.setColumnWidth(9, 140);

  // Background
  sheet.getRange("A1:I50").setBackground("#1a1a2e");

  // ===== HEADER =====
  sheet.getRange("B1:I1").merge().setValue("PROTEROS SERVISAS — VALDYMO PULTAS")
    .setFontSize(18).setFontWeight("bold").setFontColor("#00d4aa")
    .setHorizontalAlignment("center").setVerticalAlignment("middle")
    .setBackground("#1a1a2e");
  sheet.setRowHeight(1, 50);

  sheet.getRange("B2:I2").merge()
    .setValue('=TEXT(NOW(),"yyyy-MM-dd HH:mm") & "  •  Atnaujinta automatiškai"')
    .setFontSize(10).setFontColor("#666680")
    .setHorizontalAlignment("center").setBackground("#1a1a2e");

  // ===== ROW 4-5: MAIN KPI CARDS =====
  var kpiRow = 4;
  sheet.setRowHeight(3, 15); // spacer

  // KPI 1: Viso SMS šiandien
  formatKpiCard_(sheet, "B" + kpiRow, "C" + kpiRow,
    "📱 SMS ŠIANDIEN",
    '=COUNTIFS(SMS!A:A,">="&TEXT(TODAY(),"yyyy-MM-dd"),SMS!A:A,"<"&TEXT(TODAY()+1,"yyyy-MM-dd"))',
    "#0f3460", "#e94560");

  // KPI 2: Praleisti skambučiai šiandien
  formatKpiCard_(sheet, "E" + kpiRow, "F" + kpiRow,
    "📞 PRALEISTI SKAMBUČIAI",
    '=COUNTIFS(SMS!A:A,">="&TEXT(TODAY(),"yyyy-MM-dd"),SMS!D:D,"Praleistas skambutis")',
    "#0f3460", "#ffa726");

  // KPI 3: Booking šiandien
  formatKpiCard_(sheet, "H" + kpiRow, "I" + kpiRow,
    "📅 BOOKING ŠIANDIEN",
    '=COUNTIFS(SMS!A:A,">="&TEXT(TODAY(),"yyyy-MM-dd"),SMS!D:D,"Booking")',
    "#0f3460", "#66bb6a");

  sheet.setRowHeight(kpiRow, 25);
  sheet.setRowHeight(kpiRow + 1, 55);

  // ===== ROW 7-8: SECONDARY KPIs =====
  var kpi2Row = 7;
  sheet.setRowHeight(6, 15);

  // Klaidos šiandien
  formatKpiCard_(sheet, "B" + kpi2Row, "C" + kpi2Row,
    "⚠️ KLAIDOS ŠIANDIEN",
    '=COUNTIFS(SMS!A:A,">="&TEXT(TODAY(),"yyyy-MM-dd"),SMS!D:D,"Klaida")',
    "#0f3460", "#ef5350");

  // Perdavimai (handover)
  formatKpiCard_(sheet, "E" + kpi2Row, "F" + kpi2Row,
    "🔄 PERDAVIMAI ŠIANDIEN",
    '=COUNTIFS(SMS!A:A,">="&TEXT(TODAY(),"yyyy-MM-dd"),SMS!D:D,"Perdavimas")',
    "#0f3460", "#ab47bc");

  // Pataisymai laukia
  formatKpiCard_(sheet, "H" + kpi2Row, "I" + kpi2Row,
    "📝 LAUKIA PATAISYMO",
    '=IFERROR(COUNTIF(Pataisymai!E:E,"Laukia pataisymo"),0)',
    "#0f3460", "#42a5f5");

  sheet.setRowHeight(kpi2Row, 25);
  sheet.setRowHeight(kpi2Row + 1, 55);

  // ===== ROW 10: SECTION — ŠIANDIENOS STATISTIKA =====
  sheet.setRowHeight(9, 15);
  sheet.getRange("B10:I10").merge().setValue("ŠIANDIENOS STATISTIKA")
    .setFontSize(13).setFontWeight("bold").setFontColor("#00d4aa")
    .setBackground("#16213e").setHorizontalAlignment("left");
  sheet.setRowHeight(10, 35);

  // Stats table
  var statsData = [
    ["Rodiklis", "Reikšmė", "", "Rodiklis", "Reikšmė"],
    ["Pokalbiai (AI atsakė)",
      '=COUNTIFS(SMS!A:A,">="&TEXT(TODAY(),"yyyy-MM-dd"),SMS!D:D,"Pokalbis",SMS!E:E,"Agentas")',
      "", "Konversijos rodiklis",
      '=IFERROR(TEXT(COUNTIFS(SMS!A:A,">="&TEXT(TODAY(),"yyyy-MM-dd"),SMS!D:D,"Booking")/COUNTIFS(SMS!A:A,">="&TEXT(TODAY(),"yyyy-MM-dd"),SMS!D:D,"Praleistas skambutis"),"0%"),"—")'],
    ["Klientų žinutės",
      '=COUNTIFS(SMS!A:A,">="&TEXT(TODAY(),"yyyy-MM-dd"),SMS!E:E,"Klientas")',
      "", "Sėkmės rodiklis",
      '=IFERROR(TEXT(1-COUNTIFS(SMS!A:A,">="&TEXT(TODAY(),"yyyy-MM-dd"),SMS!D:D,"Klaida")/COUNTIFS(SMS!A:A,">="&TEXT(TODAY(),"yyyy-MM-dd"),SMS!A:A,"<"&TEXT(TODAY()+1,"yyyy-MM-dd")),"0%"),"—")'],
    ["Agento atsakymai",
      '=COUNTIFS(SMS!A:A,">="&TEXT(TODAY(),"yyyy-MM-dd"),SMS!E:E,"Agentas")',
      "", "Uždaryti pokalbiai",
      '=COUNTIFS(SMS!A:A,">="&TEXT(TODAY(),"yyyy-MM-dd"),SMS!D:D,"Uždarytas")'],
    ["Savininko booking",
      '=COUNTIFS(SMS!A:A,">="&TEXT(TODAY(),"yyyy-MM-dd"),SMS!D:D,"Savininko booking")',
      "", "Pataisymai (viso)",
      '=IFERROR(COUNTA(Pataisymai!A2:A),0)'],
  ];

  sheet.getRange("B11:F11").setValues([statsData[0]])
    .setFontWeight("bold").setFontSize(10).setFontColor("#8888aa")
    .setBackground("#1a1a2e");
  sheet.getRange("H11").setValue(statsData[0][3])
    .setFontWeight("bold").setFontSize(10).setFontColor("#8888aa")
    .setBackground("#1a1a2e");
  sheet.getRange("I11").setValue(statsData[0][4])
    .setFontWeight("bold").setFontSize(10).setFontColor("#8888aa")
    .setBackground("#1a1a2e");

  for (var i = 1; i < statsData.length; i++) {
    var row = 11 + i;
    sheet.getRange("B" + row).setValue(statsData[i][0])
      .setFontColor("#ccccdd").setFontSize(10).setBackground("#1a1a2e");
    sheet.getRange("C" + row).setFormula(statsData[i][1])
      .setFontColor("#ffffff").setFontSize(12).setFontWeight("bold")
      .setHorizontalAlignment("center").setBackground("#1a1a2e");
    sheet.getRange("H" + row).setValue(statsData[i][3])
      .setFontColor("#ccccdd").setFontSize(10).setBackground("#1a1a2e");
    sheet.getRange("I" + row).setFormula(statsData[i][4])
      .setFontColor("#ffffff").setFontSize(12).setFontWeight("bold")
      .setHorizontalAlignment("center").setBackground("#1a1a2e");
  }

  // ===== ROW 17: 7 DIENŲ APŽVALGA =====
  sheet.setRowHeight(16, 15);
  sheet.getRange("B17:I17").merge().setValue("SAVAITĖS APŽVALGA (paskutinės 7 dienos)")
    .setFontSize(13).setFontWeight("bold").setFontColor("#00d4aa")
    .setBackground("#16213e").setHorizontalAlignment("left");
  sheet.setRowHeight(17, 35);

  var weekHeaders = ["Diena", "SMS", "Skambučiai", "Booking", "Klaidos", "Perdavimai", "", ""];
  sheet.getRange("B18:I18").setValues([weekHeaders])
    .setFontWeight("bold").setFontSize(10).setFontColor("#8888aa")
    .setBackground("#1a1a2e");

  for (var d = 0; d < 7; d++) {
    var row = 19 + d;
    sheet.getRange("B" + row).setFormula('=TEXT(TODAY()-' + d + ',"yyyy-MM-dd ddd")')
      .setFontColor("#ccccdd").setFontSize(10).setBackground("#1a1a2e");
    sheet.getRange("C" + row).setFormula('=COUNTIFS(SMS!A:A,">="&TEXT(TODAY()-' + d + ',"yyyy-MM-dd"),SMS!A:A,"<"&TEXT(TODAY()-' + (d-1) + ',"yyyy-MM-dd"))')
      .setFontColor("#ffffff").setFontWeight("bold").setHorizontalAlignment("center").setBackground("#1a1a2e");
    sheet.getRange("D" + row).setFormula('=COUNTIFS(SMS!A:A,">="&TEXT(TODAY()-' + d + ',"yyyy-MM-dd"),SMS!A:A,"<"&TEXT(TODAY()-' + (d-1) + ',"yyyy-MM-dd"),SMS!D:D,"Praleistas skambutis")')
      .setFontColor("#ffa726").setFontWeight("bold").setHorizontalAlignment("center").setBackground("#1a1a2e");
    sheet.getRange("E" + row).setFormula('=COUNTIFS(SMS!A:A,">="&TEXT(TODAY()-' + d + ',"yyyy-MM-dd"),SMS!A:A,"<"&TEXT(TODAY()-' + (d-1) + ',"yyyy-MM-dd"),SMS!D:D,"Booking")')
      .setFontColor("#66bb6a").setFontWeight("bold").setHorizontalAlignment("center").setBackground("#1a1a2e");
    sheet.getRange("F" + row).setFormula('=COUNTIFS(SMS!A:A,">="&TEXT(TODAY()-' + d + ',"yyyy-MM-dd"),SMS!A:A,"<"&TEXT(TODAY()-' + (d-1) + ',"yyyy-MM-dd"),SMS!D:D,"Klaida")')
      .setFontColor("#ef5350").setFontWeight("bold").setHorizontalAlignment("center").setBackground("#1a1a2e");
    sheet.getRange("G" + row).setFormula('=COUNTIFS(SMS!A:A,">="&TEXT(TODAY()-' + d + ',"yyyy-MM-dd"),SMS!A:A,"<"&TEXT(TODAY()-' + (d-1) + ',"yyyy-MM-dd"),SMS!D:D,"Perdavimas")')
      .setFontColor("#ab47bc").setFontWeight("bold").setHorizontalAlignment("center").setBackground("#1a1a2e");
  }

  // ===== ROW 27: PASKUTINĖS KLAIDOS =====
  sheet.setRowHeight(26, 15);
  sheet.getRange("B27:I27").merge().setValue("⚠️ PASKUTINĖS KLAIDOS")
    .setFontSize(13).setFontWeight("bold").setFontColor("#ef5350")
    .setBackground("#16213e").setHorizontalAlignment("left");
  sheet.setRowHeight(27, 35);

  sheet.getRange("B28:I28").setValues([["Data", "Telefonas", "", "Žinutė", "", "", "", ""]])
    .setFontWeight("bold").setFontSize(10).setFontColor("#8888aa")
    .setBackground("#1a1a2e");

  for (var i = 0; i < 5; i++) {
    var row = 29 + i;
    var n = i + 1;
    sheet.getRange("B" + row).setFormula(
      '=IFERROR(INDEX(FILTER(SMS!A:A,SMS!D:D="Klaida"),COUNTA(FILTER(SMS!A:A,SMS!D:D="Klaida"))-' + i + '),"—")')
      .setFontColor("#999999").setFontSize(10).setBackground("#1a1a2e");
    sheet.getRange("C" + row).setFormula(
      '=IFERROR(INDEX(FILTER(SMS!C:C,SMS!D:D="Klaida"),COUNTA(FILTER(SMS!C:C,SMS!D:D="Klaida"))-' + i + '),"—")')
      .setFontColor("#ccccdd").setFontSize(10).setBackground("#1a1a2e");
    sheet.getRange("D" + row + ":I" + row).merge().setFormula(
      '=IFERROR(INDEX(FILTER(SMS!F:F,SMS!D:D="Klaida"),COUNTA(FILTER(SMS!F:F,SMS!D:D="Klaida"))-' + i + '),"—")')
      .setFontColor("#ef5350").setFontSize(10).setBackground("#1a1a2e").setWrap(true);
  }

  // ===== ROW 35: PASKUTINIAI POKALBIAI =====
  sheet.setRowHeight(34, 15);
  sheet.getRange("B35:I35").merge().setValue("💬 PASKUTINIAI POKALBIAI")
    .setFontSize(13).setFontWeight("bold").setFontColor("#42a5f5")
    .setBackground("#16213e").setHorizontalAlignment("left");
  sheet.setRowHeight(35, 35);

  sheet.getRange("B36:I36").setValues([["Data", "Vardas", "Tel.", "Tipas", "Siuntėjas", "Žinutė", "", ""]])
    .setFontWeight("bold").setFontSize(10).setFontColor("#8888aa")
    .setBackground("#1a1a2e");

  for (var i = 0; i < 10; i++) {
    var row = 37 + i;
    var offset = i;
    var cols = ["A", "B", "C", "D", "E", "F"];
    var colTargets = ["B", "C", "D", "E", "F", "G"];
    for (var c = 0; c < cols.length; c++) {
      var formula = '=IFERROR(INDEX(SMS!' + cols[c] + ':' + cols[c] + ',COUNTA(SMS!A:A)+1-' + (offset + 1) + '),"")';
      if (c === 5) {
        sheet.getRange(colTargets[c] + row + ":I" + row).merge().setFormula(formula)
          .setFontColor("#ccccdd").setFontSize(10).setBackground("#1a1a2e").setWrap(true);
      } else {
        sheet.getRange(colTargets[c] + row).setFormula(formula)
          .setFontColor(c === 4 ? "#42a5f5" : "#ccccdd").setFontSize(10).setBackground("#1a1a2e");
      }
    }
  }

  // ===== ROW 48: DEVICE STATUS =====
  sheet.setRowHeight(47, 15);
  sheet.getRange("B48:I48").merge().setValue("📱 ĮRENGINIO STATUSAS")
    .setFontSize(13).setFontWeight("bold").setFontColor("#00d4aa")
    .setBackground("#16213e").setHorizontalAlignment("left");
  sheet.setRowHeight(48, 35);

  sheet.getRange("B49").setValue("Žiūrėk 'Statusas' lapą detaliam vaizdui →")
    .setFontColor("#666680").setFontSize(10).setFontStyle("italic").setBackground("#1a1a2e");

  // Protect from edits
  sheet.protect().setDescription("Dashboard — automatinės formulės").setWarningOnly(true);

  // Hide gridlines
  sheet.setHiddenGridlines(true);
}

function formatKpiCard_(sheet, labelCell, valueCell, label, formula, bgColor, valueColor) {
  sheet.getRange(labelCell).setValue(label)
    .setFontSize(9).setFontWeight("bold").setFontColor("#8888aa")
    .setBackground(bgColor).setHorizontalAlignment("center");
  sheet.getRange(valueCell).setValue("")
    .setBackground(bgColor);

  var valueRow = parseInt(labelCell.replace(/\D/g, '')) + 1;
  var labelCol = labelCell.replace(/\d/g, '');
  var valCol = valueCell.replace(/\d/g, '');

  sheet.getRange(labelCol + valueRow + ":" + valCol + valueRow).merge()
    .setFormula(formula)
    .setFontSize(28).setFontWeight("bold").setFontColor(valueColor)
    .setHorizontalAlignment("center").setVerticalAlignment("middle")
    .setBackground(bgColor);
}

// ==================== PATAISYMAI ====================

function createCorrectionsSheet_(ss) {
  if (ss.getSheetByName("Pataisymai")) return;

  var sheet = ss.insertSheet("Pataisymai");

  var header = ["Kliento žinutė", "Blogas atsakymas", "Teisingas atsakymas", "Pastaba", "Statusas"];
  sheet.getRange(1, 1, 1, 5).setValues([header]);
  sheet.getRange("A1:E1").setFontWeight("bold").setFontSize(12)
    .setBackground("#E65100").setFontColor("white");

  sheet.setColumnWidth(1, 300);
  sheet.setColumnWidth(2, 300);
  sheet.setColumnWidth(3, 300);
  sheet.setColumnWidth(4, 200);
  sheet.setColumnWidth(5, 130);
  sheet.setFrozenRows(1);

  // Pavyzdys
  var example = [
    "Ar galima atvežti BMW?",
    "Taip, priimame visus automobilius.",
    "Taip, BMW aptarnaujame. Kokia problema? Galiu pasiūlyti laiką vizitui.",
    "Pavyzdys — ištrinkit",
    "Pataisyta"
  ];
  sheet.getRange(2, 1, 1, 5).setValues([example]);
  sheet.getRange("A2:E2").setFontColor("#999999").setFontStyle("italic");

  // Instrukcija
  sheet.getRange("A4").setValue("INSTRUKCIJA: Kai app atsakė blogai — nukopijuok kliento žinutę ir blogą atsakymą čia, parašyk teisingą atsakymą, ir pakeisk statusą į \"Pataisyta\". App automatiškai mokysis iš šių pataisymų.")
    .setFontColor("#666666").setFontStyle("italic");
  sheet.getRange("A4:E4").merge();
}

// ==================== SMS MIGRACIJA ====================

function migrateSmsToVertical_(ss) {
  var smsSheet = ss.getSheetByName("SMS");
  if (!smsSheet) return;

  var header = smsSheet.getRange("A1:F1").getValues()[0];
  // Jei jau vertikalus formatas
  if (header[4] === "Siuntėjas") return;
  // Jei ne horizontalus — nežinomas formatas, praleisti
  if (header[4] !== "Kliento žinutė") return;

  var lastRow = smsSheet.getLastRow();
  if (lastRow <= 1) {
    // Tik header — tiesiog pakeisti
    smsSheet.getRange("E1").setValue("Siuntėjas");
    smsSheet.getRange("F1").setValue("Žinutė");
    return;
  }

  var data = smsSheet.getRange(2, 1, lastRow - 1, 6).getValues();
  var newRows = [];

  for (var i = 0; i < data.length; i++) {
    var timestamp = data[i][0];
    var name = data[i][1];
    var phone = data[i][2];
    var type = data[i][3];
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

  // Išvalyti senus duomenis
  smsSheet.getRange(1, 1, lastRow, 6).clearContent();

  // Naujas header
  smsSheet.getRange("A1:F1").setValues([["Data", "Vardas", "Telefonas", "Tipas", "Siuntėjas", "Žinutė"]]);
  smsSheet.getRange("A1:F1").setFontWeight("bold").setFontSize(12)
    .setBackground("#607D8B").setFontColor("white");

  // Įrašyti naujus duomenis
  if (newRows.length > 0) {
    smsSheet.getRange(2, 1, newRows.length, 6).setValues(newRows);
  }

  Logger.log("Migruota " + data.length + " eilučių į " + newRows.length + " vertikalių eilučių");
}
