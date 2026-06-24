/**
 * PROTEROS SERVISAS — SMS + Pataisymai Sheet atnaujinimas
 *
 * INSTRUKCIJA:
 * 1. Atidaryk savo Žinių bazės Google Sheet
 * 2. Eik į Extensions → Apps Script
 * 3. Įklijuok visą šį kodą (ištrink seną jei yra)
 * 4. Paspausk ▶ Run (paleisk funkciją "updateSheets")
 * 5. Leisk prieigą kai paprašys
 *
 * Ką daro:
 * - Sukuria "Pataisymai" lapą (jei dar nėra) su header ir pavyzdžiu
 * - Pakeičia SMS lapo formatą iš horizontalaus į vertikalų
 * - Migruoja senus SMS duomenis
 */

function updateSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // ========== 1. PATAISYMAI LAPAS ==========
  var pataisymai = ss.getSheetByName("Pataisymai");
  if (!pataisymai) {
    pataisymai = ss.insertSheet("Pataisymai");

    var header = [["Kliento žinutė", "Blogas atsakymas", "Teisingas atsakymas", "Pastaba", "Statusas"]];
    pataisymai.getRange(1, 1, 1, 5).setValues(header);
    pataisymai.getRange("A1:E1").setFontWeight("bold").setFontSize(12).setBackground("#E65100").setFontColor("white");
    pataisymai.setColumnWidth(1, 300);
    pataisymai.setColumnWidth(2, 300);
    pataisymai.setColumnWidth(3, 300);
    pataisymai.setColumnWidth(4, 200);
    pataisymai.setColumnWidth(5, 130);
    pataisymai.setFrozenRows(1);

    // Pavyzdinis įrašas (kursyvu, pilka)
    var example = [["Pvz: Ar galima atvežti BMW?", "Taip, priimame visus automobilius.", "Taip, BMW aptarnaujame. Kokia problema? Galiu pasiūlyti laiką vizitui.", "", "Pataisyta"]];
    pataisymai.getRange(2, 1, 1, 5).setValues(example);
    pataisymai.getRange("A2:E2").setFontColor("#999999").setFontStyle("italic");

    Logger.log("✓ Pataisymai lapas sukurtas!");
  } else {
    Logger.log("Pataisymai lapas jau egzistuoja — praleidžiama.");
  }

  // ========== 2. SMS FORMATAS: HORIZONTALUS → VERTIKALUS ==========
  var sms = ss.getSheetByName("SMS");
  if (!sms) {
    Logger.log("SMS lapas nerastas — praleidžiama.");
    SpreadsheetApp.getUi().alert("✓ Pataisymai lapas sukurtas!\n\nSMS lapas nerastas — bus sukurtas automatiškai kai app gaus pirmą SMS.");
    return;
  }

  var headerRow = sms.getRange("A1:F1").getValues()[0];

  // Patikrinti ar jau vertikalus
  if (headerRow[4] === "Siuntėjas") {
    Logger.log("SMS lapas jau vertikalaus formato — praleidžiama.");
    SpreadsheetApp.getUi().alert("✓ Viskas jau tvarkoje!\n\nPataisymai lapas: ✓\nSMS formatas: jau vertikalus ✓");
    return;
  }

  // Migruoti horizontalų → vertikalų
  var lastRow = sms.getLastRow();
  if (lastRow <= 1) {
    // Tik header — tiesiog pakeisti header
    sms.getRange("A1:F1").setValues([["Data", "Vardas", "Telefonas", "Tipas", "Siuntėjas", "Žinutė"]]);
    Logger.log("SMS header atnaujintas (tuščias lapas).");
    SpreadsheetApp.getUi().alert("✓ Atnaujinta!\n\nPataisymai lapas: ✓\nSMS header: atnaujintas ✓");
    return;
  }

  // Nuskaityti senus duomenis
  var oldData = sms.getRange(2, 1, lastRow - 1, 6).getValues();
  var newRows = [];

  for (var i = 0; i < oldData.length; i++) {
    var timestamp = oldData[i][0];
    var name = oldData[i][1];
    var phone = oldData[i][2];
    var type = oldData[i][3];
    var clientMsg = oldData[i][4] ? oldData[i][4].toString() : "";
    var aiReply = oldData[i][5] ? oldData[i][5].toString() : "";

    // Nustatyti siuntėją pagal tipą
    var sender;
    if (type === "Praleistas skambutis" || type === "Perdavimas" || type === "Uždarytas" || type === "Klaida") {
      sender = "Sistema";
    } else {
      sender = "Klientas";
    }

    // Kliento/sistemos žinutė
    if (clientMsg.length > 0) {
      newRows.push([timestamp, name, phone, type, sender, clientMsg]);
    }

    // AI atsakymas — atskira eilutė
    if (aiReply.length > 0) {
      newRows.push([timestamp, name, phone, type, "Agentas", aiReply]);
    }
  }

  // Ištrinti senus duomenis ir įrašyti naujus
  sms.clear();
  sms.getRange("A1:F1").setValues([["Data", "Vardas", "Telefonas", "Tipas", "Siuntėjas", "Žinutė"]]);
  sms.getRange("A1:F1").setFontWeight("bold").setFontSize(12).setBackground("#607D8B").setFontColor("white");
  sms.setFrozenRows(1);

  if (newRows.length > 0) {
    sms.getRange(2, 1, newRows.length, 6).setValues(newRows);
  }

  // Stulpelių plotis
  sms.setColumnWidth(1, 160);
  sms.setColumnWidth(2, 140);
  sms.setColumnWidth(3, 120);
  sms.setColumnWidth(4, 120);
  sms.setColumnWidth(5, 100);
  sms.setColumnWidth(6, 400);

  Logger.log("✓ SMS migruotas: " + oldData.length + " eilučių → " + newRows.length + " vertikalių eilučių");

  SpreadsheetApp.getUi().alert(
    "✓ Viskas atnaujinta!\n\n" +
    "Pataisymai lapas: ✓ sukurtas\n" +
    "SMS formatas: " + oldData.length + " eilučių → " + newRows.length + " vertikalių eilučių\n\n" +
    "Dabar kiekviena žinutė rodoma atskiroje eilutėje su 'Siuntėjas' stulpeliu (Klientas / Agentas / Sistema)."
  );
}
