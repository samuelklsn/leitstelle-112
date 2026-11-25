# Changelog

Alle nennenswerten Änderungen an diesem Projekt werden hier dokumentiert.
Format nach [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
Versionierung nach [Semantic Versioning](https://semver.org/lang/de/).

## [Unreleased]

### Hinzugefügt

- **Akustische Signale:** Notrufe klingeln, Sprechwünsche und Nachforderungen piepen, eine Großlage
  löst einen Gong aus. Die Töne entstehen per Web Audio (keine Tondateien) und lassen sich in der
  Kopfzeile abschalten; nur das Hauptfenster gibt Töne aus.
- **Region-Builder vereinfacht das Straßennetz:** Stützpunkte auf geraden Abschnitten derselben
  Straße fallen weg (Abschnitte höchstens 300 m), Kurven, Kreuzungen und Einbahnrichtungen bleiben.
  Das hält das Routing in echten Landkreisen schnell.

## [1.1.0] – 2026-11-25 – Echte Regionen (M13)

### Hinzugefügt

- **OSM-Import (#58):** Der Region-Builder (`tools/region-builder`) wandelt einen
  OpenStreetMap-Auszug in einen Region-Mod um: Orte, Straßennetz mit Einbahnstraßen, Hausnummern,
  Einsatzorte im Freien, Wald und Fluss, dazu Wachen, Kliniken und Krankentransport-Vorlagen aus
  den OSM-Einrichtungen. Anleitung in [docs/regionen.md](docs/regionen.md).
- **Vorgefertigte Welten im Sim-Kern:** Regionen mit `prebuilt` werden zusammengesetzt statt
  prozedural erzeugt.
- **Mods können Listen der Basis ersetzen** (`mod.replaces`), z. B. Wachen und Kliniken einer
  echten Region.
- **Spike Offline-Kacheln (#12):** Entscheidung für PMTiles, sobald Kacheln nötig werden
  (ADR-0006, Nachtrag); bis dahin genügt GeoJSON.
- ADR-0020.

## [1.0.0] – 2026-11-24 – Editoren und Modding (M12)

Erste stabile Version. Das Inhaltsformat ist ab jetzt stabil: Änderungen nur abwärtskompatibel
oder mit Migrationshinweis in [docs/modding.md](docs/modding.md).

### Hinzugefügt

- **Mods (#57):** Unterordner im Mod-Ordner ergänzen Inhalte oder ersetzen Einträge mit gleicher
  ID; `settingsOverride` ändert einzelne Einstellungen. Fehlerhafte Mods werden übersprungen und
  im Dialog **Mods** mit ihren Fehlern angezeigt. Modding-Anleitung mit Beispiel-Mod.
- **Szenario-Editor und Trainingsszenarien (#56):** Startzeit, Wetter, Ereignisse, geplante
  Notrufe und Ziele; drei Szenarien in den Basisinhalten (Blitzeis, zwei Reanimationen,
  Hitzetag mit Volksfest). Die Auswertung zeigt, ob die Ziele erreicht sind.
- **Wachen-Editor (#55):** Standort einer Wache per Klick auf die Karte, Fahrzeuge ergänzen,
  Ergebnis als Mod.
- **Hilfsfrist-Regeln mit Quelle (#32):** Baden-Württemberg, Bayern (nur Fahrzeit), Hessen,
  Nordrhein-Westfalen (ländlich) und die Vorgabe des Landkreises; Messbeginn ab Notruf,
  Alarmierung oder Ausrücken.
- ADR-0019.

## [0.8.0] – 2026-11-24 – Langzeitspiel (M11)

### Hinzugefügt

- **Laufbahn (#53):** Erfahrung aus jeder Schicht, Beförderung bis zur Lagedienstführung. Jede
  Stufe übernimmt einen größeren Bereich mit mehr Aufkommen.
- **Bedarfsplanung (#53):** Budget aus guten Schichten; zusätzliche RTW, Tages-RTW, KTW oder NEF
  beantragen. Bewilligt wird nur, was die Statistik der letzten Schicht begründet.
- **Tages-Herausforderung:** Seed aus dem Datum, für alle gleich, Bestleistung lokal.
- **Wiederkehrende Personen und Adressen (#54):** Vielanrufer, Stammpatienten und
  Gefahrenadressen; Einsatzhistorie und bekannte Rufnummern in der Notrufmaske.
- **Eigensicherung:** Kräfte warten an Gefahrenadressen auf die Polizei; Knopf „Polizei“ in der
  Einsatzliste, Fehler bei bekannter Gefahr ohne Polizei.
- ADR-0018 und Fachdoku `docs/domain/langzeit.md`.

### Geändert

- Spielstände haben die Snapshot-Version 6. Spielstände aus 0.7.0 lassen sich nicht laden.

## [0.7.0] – 2026-11-24 – MANV und Großlagen (M10)

### Hinzugefügt

- **Massenanfall von Verletzten (#51):** Großlagen mit vielen Patienten, Lagemeldung, Sichtung
  (T1–T4) durch Leitenden Notarzt, Arzt oder Besatzungen, Versorgung vor Ort für Leichtverletzte.
- **Seltene Großlagen (#52):** Busunfall, Massenkarambolage (bei Nebel und Glätte häufiger),
  Zugunglück, Großbrand, Chlorgasaustritt, Evakuierung eines Pflegeheims.
- **Neue Stichworte** MANV 1–3, B 4 und ABC 1; **Führung und Reserven:** LNA, OrgL,
  SEG mit RTW, KTW und Gerätewagen Sanität, Gerätewagen Gefahrgut der Feuerwehr.
- **Bereitstellungsraum** gegen Stau an den Ladeplätzen und **Patientenverteilung** nach
  Kapazität; zwei Kliniken der Nachbarkreise fangen Spitzen auf.
- **MANV-Übersicht** mit Sichtungsergebnis, Verbleib jedes Patienten und Verteilung.
- **Spielbeginn „MANV-Übung“:** Die Schicht beginnt mit einer Großlage.
- Bewertung je Patient mit „goldener Stunde“; ADR-0017 und Fachdoku `docs/domain/manv.md`.

### Geändert

- Spielstände haben die Snapshot-Version 5. Spielstände aus 0.6.0 lassen sich nicht laden.

## [0.6.0] – 2026-11-24 – Mehrfenster und Mehrmonitor (M9)

### Hinzugefügt

- **Mehrere Fenster (#50):** Lagekarte, Listen (Einsätze, Aufträge, Kliniken, Funk) und
  Fahrzeugstatus lassen sich in eigene Fenster für weitere Bildschirme auslagern. Dialoge öffnen
  sich im Hauptfenster, die Auswahl gilt in allen Fenstern.
- **Layout-Profile:** mitgelieferte Anordnungen für einen, zwei und drei Bildschirme sowie eigene,
  gespeicherte Layouts. Das zuletzt benutzte Layout wird beim Start wiederhergestellt; Fenster
  eines abgesteckten Monitors landen auf dem Hauptbildschirm.
- **Tastenbelegung (#30):** Alle globalen Aktionen lassen sich neu belegen; bei Konflikten
  tauschen die Aktionen ihre Tasten. Neue Kürzel für Hilfe (F1), Fenster (F8), Auswertung (F9)
  und die Reiter (Strg+1–4).
- **Diagnosepaket (#34):** Protokolle, Absturzberichte und Systeminformationen als ZIP – ohne
  automatischen Versand.

## [0.5.0] – 2026-11-24 – Welt-Dynamik (M8)

### Hinzugefügt

- **Wetter nach Klima und Jahreszeit:** Klar, Regen, Gewitter, Nebel, Schneefall, Glätte und
  Hitze mit Temperatur. Das Wetter verlängert Fahrzeiten (Glätte +67 %), ändert das Aufkommen und
  verschiebt den Einsatzmix: Stürze bei Glätte, Bäume auf der Fahrbahn bei Gewitter, Exsikkose
  und Flächenbrände bei Hitze.
- **Ereignisse der Weltlage:** Silvester, Volksfeste, Weihnachtsmärkte, Grippewellen, Baustellen
  und Veranstaltungen mit Straßensperrung. Die Karte zeigt Sperrungen, der Router leitet um.
- **Feiertage und Wochenmuster:** gesetzliche Feiertage zählen wie Sonntage (Verkehr, KTW-Dienst,
  Krankentransporte). Freitag und Wochenende bringen etwas mehr Notrufe.
- **Sommerzeit (#33):** Die Uhr springt Ende März und Ende Oktober; der Kern läuft gleichmäßig.
- **Einsatz-Regie:** Das Aufkommen wechselt in Phasen zwischen Ruhe und Spitzen, höchstens ± 25 %.
- **Rettungshubschrauber** an der Luftrettungsstation Hohenwarte: fliegt Luftlinie, nur bei
  Tageslicht und Flugwetter, zeitweise im Nachbarbereich gebunden. Die AAO schlägt ihn als
  Alternative zum NEF vor, wenn er schneller ist.
- **Neue Einsätze:** Exsikkose, Verletzung durch Feuerwerkskörper, Flächen- und Waldbrand.
- **Kopfzeile** mit Wetter, Temperatur, Feiertag und laufenden Ereignissen; Wetterwechsel und
  Ereignisse im Funkprotokoll.
- **Startbildschirm:** Spielbeginn heute, im Winter, im Sommer oder in der Silvesternacht.
- ADR-0016 und Fachdoku `docs/domain/welt.md`.

### Geändert

- Spielstände haben die Snapshot-Version 4. Spielstände aus 0.4.0 lassen sich nicht laden.

## [0.4.0] – 2026-11-24 – Rettungsdienst-Logistik (M7)

### Hinzugefügt

- **Neue Fahrzeuge:** 4 KTW, ein ITW und ein Tages-RTW. Der NAW ist als Fahrzeugtyp für Mods und
  andere Regionen vorhanden. Nur Notfall-Rettungsmittel (RTW, NAW) transportieren Notfallpatienten
  und zählen für die Hilfsfrist.
- **Transportaufträge** im neuen Reiter „Aufträge“: Einweisungen, Entlassungen, Dialysefahrten,
  Verlegungen mit Überwachung und Intensivverlegungen, jeweils mit Abholtermin. Zum Schichtbeginn
  liegen vorbestellte Aufträge vor. Pünktlichkeit wird bewertet, liegengebliebene Aufträge werden
  storniert.
- **Kliniken melden sich ab:** Aufnahmeplätze je Fachabteilung, Abmeldung bei Vollbelegung oder
  Geräteausfall, neuer Reiter „Kliniken“. Der Zielklinik-Vorschlag umgeht abgemeldete Abteilungen;
  bei vitaler Bedrohung gilt die Aufnahmepflicht.
- **Fachklinik am Tannenhang** (Geriatrie, Psychiatrie) als dritte Klinik.
- **Status 6 mit Grund:** Desinfektion nach Infektionstransporten, Defekte, Tanken, Pausen und
  Dienstende. Das Fahrzeug fährt zur Wache und ist danach wieder verfügbar.
- **Dienstzeiten, Besatzungswechsel und Pausen:** Fahrzeuge mit Vorhaltezeiten, Wechsel um 7 und
  19 Uhr, Überstunden bei Einsätzen über das Schichtende. Besatzungen bitten nach sechs Stunden um
  ihre Pause; der Disponent genehmigt sie oder beendet sie vorzeitig.
- **Auswertung:** pünktliche Transporte, Überstunden und vier neue Fehlerarten.
- F3 disponiert Notfälle vor Transportaufträgen.
- ADR-0015 und Fachdoku `docs/domain/logistik.md` mit allen Annahmen.

### Geändert

- Spielstände haben die Snapshot-Version 3. Spielstände aus 0.3.0 lassen sich nicht laden.
- Fahrzeug-Hilfsfunktionen liegen in `packages/sim/src/systems/vehicles.ts`.

## [0.3.0] – 2026-11-24 – Feuerwehr (M6)

### Hinzugefügt

- **Feuerwehr im Landkreis Brakenfeld:**
  - Feuerwache Brakenfeld mit hauptamtlicher Wachbereitschaft und 6 Freiwillige Feuerwehren
    mit eigener, längerer Ausrückzeit (Meldeempfänger, Anfahrt zum Gerätehaus).
  - 15 Fahrzeuge: ELW 1, HLF, LF, DLK, RW, TLF.
- **Neues Stichwortschema:** B 1–3 und TH 1–2. Die AAO kennt Ersatzfahrzeuge, ein LF statt eines
  HLF, und der Vorschlag nimmt das schnellste geeignete Fahrzeug.
- **9 Feuerwehrlagen:** Mülleimer- und PKW-Brand, Heimrauchmelder, Küchen-, Wohnungs- und
  Dachstuhlbrand, Ölspur, Baum auf Fahrbahn, Verkehrsunfall mit eingeklemmter Person. Rund 15 %
  aller Notrufe sind Feuerwehrlagen.
- **Lagemeldung und Nachforderung:** Das erste Fahrzeug meldet die echte Lage und fordert
  fehlende Kräfte nach. Der Einsatz wird dann wieder als „Kräfte nachgefordert“ angezeigt.
- **Lageentwicklung:**
  - Ohne Feuerwehr vor Ort breitet sich ein Brand aus (Küche → Wohnung → Dachstuhl).
  - Patienten können sich bei langer Wartezeit um eine NACA-Stufe verschlechtern.
- **Verletzte bei Feuerwehrlagen** werden parallel vom Rettungsdienst versorgt. Eingeklemmte
  Personen sind erst nach der technischen Rettung transportfähig.
- **Auswertung:** Eintreffzeit der Feuerwehr (10 Minuten) als eigene Kennzahl. Brandausbreitung
  wird als Fehler gewertet.
- **Karte:** Feuerwachen werden als „FW“ angezeigt. Fahrzeuge auf ihrer Wache blendet die Karte
  aus, damit sie sich nicht stapeln.

### Behoben

- Der Anrufmix-Test verwendet feste Seeds und ist damit nicht mehr flaky.

## [0.2.0] – 2026-11-24 – Notrufannahme 2.0 (M5)

### Hinzugefügt

- **Strukturierte Notrufabfrage:** Die Fragen Wo, Was, Wer, Bewusstsein, Atmung und Rückrufnummer
  werden einzeln gestellt (Alt+1 bis Alt+6, Alt+0 für alle). Der Anrufer antwortet nach 3–8
  Sekunden, aufgeregte Anrufer brauchen länger. Die Gesprächszeit zählt zur Hilfsfrist.
- **Neue Antworten:** Bewusstsein (wach, reagiert nicht, unklar) und Atmung (normal, schwer, keine,
  unklar) als wichtigste Hinweise auf die Dringlichkeit.
- **Anrufarten:** Hosentaschenanrufe (Stille), Scherzanrufe (Kichern, unterdrückte Nummer),
  Auskunftsanrufe (Apotheke, Bereitschaftsdienst, Krankentransport) und weitere Meldungen zu
  laufenden Einsätzen. Die Notrufmaske schlägt dafür Einsätze in der Nähe zum Zuordnen vor.
- **Polizei-Übergaben (110)** mit vollständig abgefragten, korrekten Angaben.
- **Bewertung:** Doppelt angelegte Einsätze, alarmierte Scherz-, Fehl- und Auskunftsanrufe werden
  als Fehler gewertet. Aufgelegte Fehlanrufe sind kein Fehler.

### Geändert

- **Ein Gespräch zur Zeit:** Während eines Gesprächs lässt sich kein zweiter Notruf annehmen.
  F2 öffnet zuerst das laufende Gespräch.
- Das Tutorial erklärt die Abfrage. Der E2E-Test spielt den Einsatz jetzt mit vollständiger
  Abfrage durch.
- Anrufertexte sind geschlechtsneutral formuliert.

## [0.1.0] – 2026-11-24 – Vertical Slice (M2–M4)

Der erste **spielbare** Stand: eine endlose Schicht im fiktiven Landkreis Brakenfeld, vom Notruf
bis ins Krankenhaus, mit Tutorial, Spielständen und Auswertung.

### Hinzugefügt

- **Weltgenerator (M2):** Landkreis Brakenfeld (26 × 20 km, 7 Orte, ca. 74.000 Einwohner),
  deterministisch aus YAML erzeugt. Dazu gehören Ortsnetze mit Haupt- und Nebenstraßen, Bundes-,
  Landes- und Kreisstraßen, die A 97 mit Anschlussstellen, der Fluss Brake mit wenigen Brücken,
  Wälder, rund 15.000 Hausadressen und Landstraßenabschnitte als Einsatzorte.
- **Routing (M2):** gerichteter Straßengraph (CSR), Dijkstra, One-to-Many-Rückwärtssuche für
  Fahrzeugvorschläge und ein Fahrzeitmodell mit Straßenklasse, Tageszeit, Wochenende und
  Sonderrechten.
- **Inhalte (M2):** Zod-Schemas, YAML-Loader mit Querverweisprüfung und deutschen Fehlermeldungen
  (Datei und Pfad), dazu die Basisinhalte: 2 Fahrzeugtypen, 5 Standorte mit 7 Fahrzeugen,
  2 Kliniken, 4 Stichworte und 14 Krankheitsbilder.
- **Offline-Lagekarte (M2):** MapLibre mit eigenem dunklen Stil, Orten, Wachen, Kliniken,
  Einsätzen und Fahrzeugen. Die Fahrzeuge bewegen sich flüssig mit 60 FPS und zeigen Blaulicht bei
  Sonderrechten.
- **Spielablauf (M3):**
  - Notrufe mit verborgener **wahrer Lage**. Der Anrufer schildert ein Meldebild, kann die
    Hausnummer verwechseln, den Ort vergessen oder die Lage falsch einschätzen.
  - Notrufmaske mit Gesprächsverlauf, Adresssuche und Stichwortwahl.
  - Disposition nach AAO und echter Fahrzeit, übersteuerbar.
  - FMS-Zyklus 2 → 3 → 4 → 5 → 7 → 8 → 1 → 2 mit realistischen Ausrück-, Behandlungs- und
    Übergabezeiten.
  - Erstbefund vor Ort: Notarzt-Nachforderung, Abbestellen überzähliger Kräfte, kein Patient,
    Rückruf bei falscher Adresse.
  - Zielklinik nach Fachabteilung; ohne Zuweisung entscheidet die Besatzung selbst.
  - Patientenoutcome mit Zeitfenstern für Schlaganfall, ACS, Trauma und Reanimation.
  - Funkverkehr als Textlog, Einsatz- und Fahrzeuglisten.
- **v0.1.0 (M4):**
  - Spielstände in SQLite (`node:sqlite`, kein natives Modul) mit Autosave alle 5 Spielminuten.
  - Nach einem Absturz wird automatisch der letzte Autosave fortgesetzt.
  - Schichtwechsel nach 12 Stunden mit Auswertung: Hilfsfrist, Eintreff- und Annahmezeit,
    Outcome, Dispositionsfehler, Auslastung je Fahrzeug.
  - Startbildschirm, geführtes Tutorial (9 Schritte), Hilfe.
  - Tastatur: F2, F3, F4, Enter, Strg+Enter, Esc, Leertaste, 1–4.
- **Doku:** Fachliche Grundlagen in `docs/domain/` mit allen Annahmen, Screenshots im README,
  Release-Workflow für den Windows-Installer.
- **Qualität:** 74 Unit- und Property-Tests, darunter ein **Bot-Disponent**, der ganze Schichten
  spielt und Invarianten prüft. Dazu E2E-Tests mit einem kompletten Einsatz in der echten App und
  dem Fortsetzen nach einem Absturz.

### Geändert

- Zweiter Notarztstandort (Klinik Ellerbach). Mit nur einem NEF war der Notarzt strukturell zu oft
  zu spät.
- Spielstart pausiert, bis auf dem Startbildschirm ein Modus gewählt ist.

### Behoben

- Fahrzeugvorschläge empfahlen nach der Übergabe erneut Kräfte für einen bereits transportierten
  Patienten. Gefunden vom Bot-Disponenten.
- Umdisponierte, fahrende Fahrzeuge sprangen auf der Karte zurück. Jetzt fahren sie bis zur
  nächsten Kreuzung weiter.
- „Stichwort zu niedrig“ wurde auch vergeben, wenn ein Notarzt-Bedarf erst vor Ort erkennbar war.
- „Notarzt verspätet“ wurde auch vergeben, wenn gar kein Notarzt frei war.

## [0.0.1] – 2026-11-24 – Meilenstein M1 „Fundament"

Erster lauffähiger Stand: Die App startet, die Simulation läuft im eigenen Prozess mit Pause
und Zeitraffer, Notrufe gehen ein und können angenommen werden. Noch kein Spielinhalt im
eigentlichen Sinn – das kommt ab M2/M3.

### Hinzugefügt

- **Simulationskern** (`packages/sim`): deterministischer PRNG (xoshiro128\*\*) mit
  unabhängigen Streams je Subsystem, ganzzahlige Spielzeit mit Kalender ohne `Date`,
  Ereigniswarteschlange, Befehle mit Protokoll und Replay, State-Hash, Snapshots.
- **Notrufgenerator** mit realistischem Tagesprofil (nachts weniger, vormittags mehr) und
  Anrufern, die nach 45–180 s Wartezeit auflegen.
- **Protokoll** (`packages/protocol`) zwischen Sim-Host und Fenstern mit Validierung aller
  eingehenden Nachrichten.
- **Desktop-App** (`apps/desktop`): Electron mit Sim-Host im eigenen Prozess, Sandbox, CSP,
  eigenes `app://`-Protokoll, JSON-Lines-Logging, lokale Crash-Reports, automatischer Neustart
  der Simulation nach Absturz, NSIS-Installer-Konfiguration.
- **Oberfläche** (`apps/ui`): dunkles Einsatzleitrechner-Theme, Spieluhr, Pause und
  Zeitraffer 1×/2×/5×/10×, Notrufliste mit Wartezeit-Eskalation, Ereignisprotokoll,
  FMS-Legende, Tastatur (Leertaste, 1–4, F2), deutsche Texte über i18n.
- **Qualität:** 47 Unit- und Property-Tests (Coverage Sim-Kern 96 %), 5 E2E-Tests mit
  Playwright, CI auf `windows-latest` mit Installer-Artefakt, Dependabot.
- **Projekt:** Plan, 14 ADRs, Konventionen, Lizenz (GPL-3.0 / CC BY-SA 4.0), Community-Dateien,
  Issue- und PR-Vorlagen, Konzept für Endlosspiel und prozedurale Vielfalt (ADR-0014).

### Bekannte Einschränkungen

- Spielzeit ohne Sommerzeitumstellung (Annahme, siehe `packages/sim/src/time.ts`).
- Nach einem Absturz startet die Simulation neu beim Schichtbeginn; Autosave folgt in M4.
- Der Installer wird nur in der CI gebaut (Richtlinie des Entwicklungsrechners, PLAN Kapitel 9).

[Unreleased]: https://github.com/samuelklsn/leitstelle-112/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/samuelklsn/leitstelle-112/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/samuelklsn/leitstelle-112/compare/v0.8.0...v1.0.0
[0.8.0]: https://github.com/samuelklsn/leitstelle-112/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/samuelklsn/leitstelle-112/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/samuelklsn/leitstelle-112/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/samuelklsn/leitstelle-112/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/samuelklsn/leitstelle-112/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/samuelklsn/leitstelle-112/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/samuelklsn/leitstelle-112/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/samuelklsn/leitstelle-112/compare/v0.0.1...v0.1.0
[0.0.1]: https://github.com/samuelklsn/leitstelle-112/releases/tag/v0.0.1
