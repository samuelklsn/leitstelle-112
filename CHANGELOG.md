# Changelog

Alle nennenswerten Änderungen an diesem Projekt werden hier dokumentiert.
Format nach [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
Versionierung nach [Semantic Versioning](https://semver.org/lang/de/).

## [Unreleased]

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

[Unreleased]: https://github.com/samuelklsn/leitstelle-112/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/samuelklsn/leitstelle-112/compare/v0.0.1...v0.1.0
[0.0.1]: https://github.com/samuelklsn/leitstelle-112/releases/tag/v0.0.1
