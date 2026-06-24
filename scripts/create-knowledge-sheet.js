/**
 * PROTEROS SERVISAS — Žinių bazės Google Sheet kūrimas
 *
 * INSTRUKCIJA:
 * 1. Eik į https://script.google.com
 * 2. Sukurk naują projektą (New Project)
 * 3. Įklijuok visą šį kodą
 * 4. Paspausk ▶ Run
 * 5. Leisk prieigą prie Google Sheets kai paprašys
 * 6. Sheet bus sukurtas tavo Google Drive — atidaryk ir nusikopijuok Sheet ID
 * 7. Sheet ID įvesk app nustatymuose (Settings → Žinių bazė)
 *
 * Sheet ID rasi URL adrese tarp /d/ ir /edit:
 * https://docs.google.com/spreadsheets/d/ČIAYRA_SHEET_ID/edit
 */

function createProterosKnowledgeBase() {
  var ss = SpreadsheetApp.create("Proteros Servisas — Žinių bazė");

  // ========== LAPAS 1: Servisas ==========
  var servisas = ss.getActiveSheet();
  servisas.setName("Servisas");

  var servisasData = [
    ["SERVISO INFORMACIJA", "", "Užpildykite stulpelį B pagal savo serviso duomenis"],
    ["Įmonės pavadinimas", "Proteros Servisas", "Kaip agentas prisistatys klientui SMS žinutėje"],
    ["Adresas", "Aukštaičių g. 29-2, Panevėžys", "Automatiškai siunčiamas klientui su Google Maps nuoroda"],
    ["Darbo laikas", "I-V 8:00-17:00", "Kada priimate klientus (agentas nesiūlys laiko ne darbo metu)"],
    ["Telefono numeris", "", "Jei klientas nori paskambinti — agentas duos šį numerį"],
    ["Vizito trukmė (min)", "60", "Kiek minučių trunka vienas vizitas kalendoriuje"],
    ["", "", ""],
    ["AGENTO ELGESYS", "", "Kaip AI agentas bendrauja su klientais"],
    ["Pasisveikinimo žinutė", "Sveiki! Čia Proteros Servisas. Atsiprašome, kad dabar negalėjome atsiliepti. Aprašykite automobilio problemą ir norimą vizito laiką — ir mes iškart pasiūlysime artimiausią laisvą laiką.", "Pirmoji SMS žinutė klientui po praleisto skambučio"],
    ["Max žinučių skaičius", "8", "Po kiek AI žinučių pokalbis perduodamas savininkui (apsauga nuo begalinių pokalbių)"],
    ["Agento tikslas", "Kuo greičiau susitarti dėl vizito laiko. Būk trumpas, konkretus, mandagus. Klientui pasiūlyk 2 artimiausius laisvus laikus.", "Ko agentas siekia kiekviename pokalbyje"],
    ["Papildomas promptas", "Visada paklausk automobilio markės ir modelio prieš siūlydamas laiką. Jei klientas nurodo tik problemą be laiko — iškart pasiūlyk 2 artimiausius laikus.", "Bet kokios papildomos instrukcijos agentui (laisva forma)"]
  ];

  servisas.getRange(1, 1, servisasData.length, 3).setValues(servisasData);

  servisas.getRange("A1").setFontWeight("bold").setFontSize(14).setBackground("#4285F4").setFontColor("white");
  servisas.getRange("A8").setFontWeight("bold").setFontSize(14).setBackground("#4285F4").setFontColor("white");
  servisas.getRange("A1:C1").setBackground("#4285F4").setFontColor("white");
  servisas.getRange("A8:C8").setBackground("#4285F4").setFontColor("white");
  servisas.getRange("C1:C12").setFontColor("#666666").setFontStyle("italic");
  servisas.getRange("B2:B6").setFontWeight("bold");
  servisas.getRange("B9:B12").setFontWeight("bold");
  servisas.setColumnWidth(1, 200);
  servisas.setColumnWidth(2, 500);
  servisas.setColumnWidth(3, 350);

  // ========== LAPAS 2: Paslaugos ==========
  var paslaugos = ss.insertSheet("Paslaugos");

  var paslaugosData = [
    ["TEIKIAMOS PASLAUGOS", "Aprašymas klientui", "Orientacinė kaina", "Trukmė min"],
    ["Važiuoklės remontas", "Amortizatoriai, šarnyrai, guoliai, stabilizatoriai", "Pagal apžiūrą", "60"],
    ["Variklio diagnostika", "Kompiuterinė diagnostika, klaidų nuskaitymas, parametrų tikrinimas", "30-50€", "30"],
    ["Stabdžių sistema", "Stabdžių kaladėlės, diskai, stabdžių skysčio keitimas", "Pagal apžiūrą", "60"],
    ["Pakabos remontas", "Šarnyrai, grandinės, silent blokai, svirtys", "Pagal apžiūrą", "60"],
    ["Techninė apžiūra", "Automobilio paruošimas techninei apžiūrai", "20-40€", "60"],
    ["Kompiuterinė diagnostika", "Klaidų skaitymas, parametrų tikrinimas, sistemos analizė", "20-30€", "30"],
    ["Tepalų keitimas", "Variklio tepalai, pavarų dėžės tepalai, filtrai", "40-80€", "30"],
    ["Ratų montavimas", "Ratų montavimas, balansavimas, sezoniniai ratai", "20-40€", "30"],
    ["Oro kondicionieriaus servisas", "Freon pildymas, sistemos patikra, kvapų šalinimas", "40-60€", "30"],
    ["Sankabos remontas", "Sankabos disko, prispaudimo plokštės keitimas", "Pagal apžiūrą", "120"],
    ["", "", "", ""],
    ["*Pridėkite naują paslaugą naujai eilutei", "", "", ""]
  ];

  paslaugos.getRange(1, 1, paslaugosData.length, 4).setValues(paslaugosData);

  paslaugos.getRange("A1:D1").setFontWeight("bold").setFontSize(12).setBackground("#34A853").setFontColor("white");
  paslaugos.getRange("A2:A11").setFontWeight("bold");
  paslaugos.getRange("A13").setFontColor("#999999").setFontStyle("italic");
  paslaugos.setColumnWidth(1, 250);
  paslaugos.setColumnWidth(2, 400);
  paslaugos.setColumnWidth(3, 150);
  paslaugos.setColumnWidth(4, 100);
  paslaugos.setFrozenRows(1);

  // ========== LAPAS 3: DUK ==========
  var duk = ss.insertSheet("DUK");

  var dukData = [
    ["DAŽNI KLAUSIMAI", "Kaip agentas turi atsakyti"],
    ["Kiek kainuoja remontas?", "Tikslią kainą galėsime pasakyti tik po automobilio apžiūros vizito metu. Užsiregistruokite ir viską aptarsime."],
    ["Ar dirbate savaitgaliais?", "Dirbame tik darbo dienomis I-V 8:00-17:00. Šeštadieniais ir sekmadieniais nepriiminėjame."],
    ["Ar turite garantiją?", "Taip, suteikiame 6 mėn. arba 10 000 km garantiją atliktiems darbams."],
    ["Kokius automobilius remontuojate?", "Remontuojame visų markių lengvuosius automobilius."],
    ["Ar reikia iš anksto registruotis?", "Taip, vizitą reikia registruoti iš anksto, kad galėtume Jums skirti pakankamai laiko."],
    ["Ar galima atvažiuoti be registracijos?", "Rekomenduojame registruotis iš anksto. Jei bus laisvų vietų — priimame ir be registracijos."],
    ["Koks mokėjimo būdas?", "Priimame grynuosius, mokėjimo korteles ir bankinius pavedimus."],
    ["Ar galiu palaukti kol remontuojate?", "Taip, turime patogią laukimo zoną su kava ir Wi-Fi."],
    ["Kiek užtrunka remontas?", "Priklauso nuo darbų apimties. Paprastą diagnostiką atliekame per 30 min, sudėtingesnius darbus — per 1-3 val."],
    ["Ar galite atsiųsti sąskaitą?", "Taip, sąskaitą galime atsiųsti el. paštu arba duoti vietoje."],
    ["Ar taikote nuolaidas?", "Nuolaidos aptariamos individualiai vizito metu."],
    ["", ""],
    ["*Pridėkite naują klausimą naujai eilutei", ""]
  ];

  duk.getRange(1, 1, dukData.length, 2).setValues(dukData);

  duk.getRange("A1:B1").setFontWeight("bold").setFontSize(12).setBackground("#FBBC04").setFontColor("white");
  duk.getRange("A2:A12").setFontWeight("bold");
  duk.getRange("A14").setFontColor("#999999").setFontStyle("italic");
  duk.setColumnWidth(1, 350);
  duk.setColumnWidth(2, 500);
  duk.setFrozenRows(1);

  // ========== LAPAS 4: Taisyklės ==========
  var taisykles = ss.insertSheet("Taisyklės");

  var taisyklesData = [
    ["AGENTO TAISYKLĖS", "Paaiškinimas (šis stulpelis nėra skaitomas agento)"],
    ["NIEKADA nesakyk tikslios kainos — sakyk kad aptarsime vizito metu", "Kainos priklauso nuo situacijos, tikslios kainos nežinome iš anksto"],
    ["Būk trumpas — max 2-3 sakiniai per žinutę", "SMS turi būti trumpas ir aiškus, klientai neskaito ilgų žinučių"],
    ["Atsakyk max 100 simbolių kai įmanoma", "Taupome SMS kainą ir kliento laiką"],
    ["Visada paklausk automobilio markės ir modelio", "Padeda meistrui pasiruošti vizitui ir užsakyti detales"],
    ["Jei klientas pyksta — atsiprašyk ir pasiūlyk paskambinti tiesiogiai", "Nekonfliktuok, perduok savininkui"],
    ["Nesiūlyk paslaugų kurių servise neteikiame", "Siūlyk tik tai kas yra Paslaugų sąraše"],
    ["Jei klientas klausia apie kainą — sakyk kad aptarsime po apžiūros", "Nemeluok ir neišgalvok kainų"],
    ["Jei klientas rašo ne lietuviškai — atsakyk ta pačia kalba", "Aptarnaujame visus klientus"],
    ["Nebūk per daug formalus — bendrauk kaip draugiškas profesionalas", "Klientai labiau pasitiki natūraliu bendravimu"],
    ["", ""],
    ["*Pridėkite naują taisyklę naujai eilutei", ""]
  ];

  taisykles.getRange(1, 1, taisyklesData.length, 2).setValues(taisyklesData);

  taisykles.getRange("A1:B1").setFontWeight("bold").setFontSize(12).setBackground("#EA4335").setFontColor("white");
  taisykles.getRange("B1:B12").setFontColor("#666666").setFontStyle("italic");
  taisykles.getRange("A12").setFontColor("#999999").setFontStyle("italic");
  taisykles.setColumnWidth(1, 500);
  taisykles.setColumnWidth(2, 400);
  taisykles.setFrozenRows(1);

  // ========== LAPAS 5: Garantijos ir sąlygos ==========
  var garantijos = ss.insertSheet("Garantijos ir sąlygos");

  var garantijosData = [
    ["GARANTIJOS IR SĄLYGOS", "Informacija klientui"],
    ["Darbų garantija", "6 mėnesiai arba 10 000 km (kas anksčiau)"],
    ["Detalių garantija", "Pagal gamintojo garantiją (nuo 6 mėn. iki 2 metų)"],
    ["Diagnostikos garantija", "Diagnostika nemokama jei remontas atliekamas pas mus"],
    ["Mokėjimo būdai", "Grynieji, mokėjimo kortelė, bankinis pavedimas"],
    ["Automobilio palikimas", "Galima palikti automobilį ir atsiimti kitą dieną (nemokama)"],
    ["Sąskaita", "Išrašome sąskaitą-faktūrą visiems darbams"],
    ["Panaudotos detalės", "Naudojame tik kokybiškas OEM arba lygiavertes detales"],
    ["Vizito atšaukimas", "Vizitą galima atšaukti arba perkelti nemokamai prieš 2 val."],
    ["", ""],
    ["*Pridėkite naują eilutę žemiau", ""]
  ];

  garantijos.getRange(1, 1, garantijosData.length, 2).setValues(garantijosData);

  garantijos.getRange("A1:B1").setFontWeight("bold").setFontSize(12).setBackground("#8E24AA").setFontColor("white");
  garantijos.getRange("A2:A9").setFontWeight("bold");
  garantijos.getRange("A11").setFontColor("#999999").setFontStyle("italic");
  garantijos.setColumnWidth(1, 250);
  garantijos.setColumnWidth(2, 500);
  garantijos.setFrozenRows(1);

  // ========== LAPAS 6: Logai ==========
  var logai = ss.insertSheet("Logai");

  var logaiHeader = [
    ["Data", "Telefonas", "Tipas", "Žinutė", "AI atsakymas"]
  ];

  logai.getRange(1, 1, 1, 5).setValues(logaiHeader);

  logai.getRange("A1:E1").setFontWeight("bold").setFontSize(12).setBackground("#607D8B").setFontColor("white");
  logai.setColumnWidth(1, 160);
  logai.setColumnWidth(2, 140);
  logai.setColumnWidth(3, 120);
  logai.setColumnWidth(4, 400);
  logai.setColumnWidth(5, 400);
  logai.setFrozenRows(1);

  // ========== LAPAS 7: Pataisymai ==========
  var pataisymai = ss.insertSheet("Pataisymai");

  var pataisymaiHeader = [
    ["Kliento žinutė", "Blogas atsakymas", "Teisingas atsakymas", "Pastaba", "Statusas"]
  ];

  pataisymai.getRange(1, 1, 1, 5).setValues(pataisymaiHeader);

  pataisymai.getRange("A1:E1").setFontWeight("bold").setFontSize(12).setBackground("#E65100").setFontColor("white");
  pataisymai.setColumnWidth(1, 300);
  pataisymai.setColumnWidth(2, 300);
  pataisymai.setColumnWidth(3, 300);
  pataisymai.setColumnWidth(4, 200);
  pataisymai.setColumnWidth(5, 130);
  pataisymai.setFrozenRows(1);

  var pataisymaiHelp = [
    ["Pvz: Ar galima atvežti BMW?", "Taip, priimame visus automobilius.", "Taip, BMW aptarnaujame. Kokia problema? Galiu pasiūlyti laiką vizitui.", "", "Pataisyta"]
  ];
  pataisymai.getRange(2, 1, 1, 5).setValues(pataisymaiHelp);
  pataisymai.getRange("A2:E2").setFontColor("#999999").setFontStyle("italic");

  servisas.activate();

  var id = ss.getId();

  Logger.log("Sheet sukurtas! ID: " + id);
  Logger.log("URL: " + ss.getUrl());

  SpreadsheetApp.getUi().alert(
    "Žinių bazė sukurta!\n\n" +
    "Sheet ID (įveskite app nustatymuose):\n" + id + "\n\n" +
    "Dabar atidarykite app → Nustatymai → Žinių bazė ir įveskite šį ID."
  );

  return id;
}
