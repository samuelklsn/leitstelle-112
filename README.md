<div align="center">

# 🚑 Leitstelle 112

**Realistischer Leitstellensimulator für Rettungsdienst, Feuerwehr und Katastrophenschutz –
offline, für Windows.**

[![CI](https://github.com/samuelklsn/leitstelle-112/actions/workflows/ci.yml/badge.svg)](https://github.com/samuelklsn/leitstelle-112/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/samuelklsn/leitstelle-112?include_prereleases&label=Version)](https://github.com/samuelklsn/leitstelle-112/releases)
[![Lizenz: GPL-3.0](https://img.shields.io/badge/Code-GPL--3.0-blue.svg)](LICENSE)
[![Inhalte: CC BY-SA 4.0](https://img.shields.io/badge/Inhalte-CC%20BY--SA%204.0-lightgrey.svg)](content/LICENSE.md)
![Plattform](https://img.shields.io/badge/Plattform-Windows%2010%2F11-0078D6)

[Herunterladen](https://github.com/samuelklsn/leitstelle-112/releases) ·
[Roadmap](https://github.com/samuelklsn/leitstelle-112/milestones) · [Plan](docs/PLAN.md) ·
[Architektur](docs/adr/README.md) · [Fachliche Grundlagen](docs/domain/README.md) ·
[Mitmachen](CONTRIBUTING.md)

![Lagekarte des Landkreises Brakenfeld mit Einsatz und Fahrzeugen](docs/images/einsatzliste.png)

</div>

## Worum geht es?

Du sitzt als Disponentin oder Disponent in der Integrierten Leitstelle Brakenfeld. Das Telefon
klingelt. Eine Angehörige meldet, ihr Mann sei „total verwirrt“. Du fragst ab, findest die Adresse,
wählst das Stichwort und alarmierst den nächsten RTW nach **echter Fahrzeit**. Vor Ort meldet die
Besatzung: **Verdacht auf Schlaganfall**. Jetzt zählt die richtige Zielklinik mit Stroke Unit, und
auf Leitung 2 klingelt schon der nächste Notruf.

## Was dieses Spiel ausmacht

- **Die gemeldete Lage ist nicht die wahre Lage.** Anrufer übertreiben, verharmlosen, nennen die
  falsche Hausnummer oder vergessen den Ort. Erst die Rückmeldung vor Ort zeigt, was wirklich los ist:
  Notarzt nachfordern, Kräfte abbestellen, Rückruf bei falscher Adresse.
- **Echte Fahrzeiten:** lokales Routing auf dem Straßennetz, abhängig von Straßentyp, Tageszeit,
  Berufsverkehr und Sonderrechten. Ein Fluss mit wenigen Brücken sorgt für echte Umwege.
- **Realistische Abläufe:** FMS-Status 1–8, Sprechwünsche, Alarm- und Ausrückeordnung,
  Ausrückzeiten bei Tag und Nacht, Übergabe im Krankenhaus, Rückfahrt zur Wache.
- **Nie durchgespielt:** Einsätze entstehen aus Bausteinen (Krankheitsbild × Patient × Ort ×
  Anrufer × Tageszeit). Rund 15.000 Adressen, 14 Krankheitsbilder und unzählige Kombinationen sorgen
  dafür, dass jede Schicht anders verläuft ([ADR-0014](docs/adr/0014-endlosspiel-prozedurale-vielfalt.md)).
- **Ehrliche Auswertung:** Hilfsfrist-Quote, Eintreff- und Annahmezeiten, Patientenoutcome,
  Dispositionsfehler und Auslastung jedes Fahrzeugs.
- **Komplett offline:** keine Accounts, keine Telemetrie. Spielstände bleiben lokal.
- **Modbar:** Region, Wachen, Fahrzeuge, Stichworte und Krankheitsbilder sind YAML-Dateien mit
  Schema-Prüfung.

## Screenshots

|                                                                   |                                                               |
| ----------------------------------------------------------------- | ------------------------------------------------------------- |
| ![Startbildschirm](docs/images/startbildschirm.png)               | ![Notrufabfrage](docs/images/notrufabfrage.png)               |
| **Startbildschirm:** freies Spiel, Tutorial oder Spielstand laden | **Notrufabfrage:** Gesprächsverlauf, Adresssuche, Stichwort   |
| ![Disposition](docs/images/disposition.png)                       | ![Lagekarte und Funk](docs/images/lagekarte-funk.png)         |
| **Disposition:** Vorschlag nach AAO und echter Fahrzeit           | **Lagekarte und Funk:** Anfahrt mit Sonderrechten, FMS-Status |
| ![Zielklinik](docs/images/zielklinik.png)                         | ![Auswertung](docs/images/auswertung.png)                     |
| **Sprechwunsch:** Zielklinik nach Befund und Fachabteilung        | **Schichtauswertung:** Hilfsfrist, Fehler, Outcome            |
| ![Transportaufträge](docs/images/auftraege.png)                   | ![Kliniken](docs/images/kliniken.png)                         |
| **Aufträge:** Krankentransporte mit Termin, Status 6 mit Grund    | **Kliniken:** Aufnahmeplätze und Abmeldungen je Abteilung     |
| ![MANV-Übersicht](docs/images/manv.png)                           | ![Fenster und Layouts](docs/images/fenster.png)               |
| **MANV:** Sichtung, Verbleib, Patientenverteilung                 | **Mehrere Bildschirme:** Fenster und Layouts                  |

## Spielen

1. Installer von der [Release-Seite](https://github.com/samuelklsn/leitstelle-112/releases)
   herunterladen (`Leitstelle112-Setup-x.y.z.exe`).
2. Installieren, ohne Administratorrechte.
3. Zum Einstieg **Tutorial** wählen: Es führt durch den ersten Einsatz vom Notruf bis ins Krankenhaus.

> Der Installer ist noch nicht signiert. Windows SmartScreen zeigt deshalb eine Warnung
> („Weitere Informationen“ → „Trotzdem ausführen“).

### Tastatur

| Taste                  | Funktion                                       |
| ---------------------- | ---------------------------------------------- |
| `F2`                   | Ältesten Notruf annehmen                       |
| `F3`                   | Einsatz ohne (ausreichende) Kräfte disponieren |
| `F4`                   | Ältesten Sprechwunsch bearbeiten (Zielklinik)  |
| `Enter` / `Strg+Enter` | Vorschlag bestätigen / Einsatz anlegen         |
| `Leertaste`            | Pause                                          |
| `1`–`4`                | Zeitraffer 1×, 2×, 5×, 10×                     |
| `Esc`                  | Dialog schließen                               |
| `Strg+1`–`Strg+4`      | Reiter Einsätze, Aufträge, Kliniken, Funk      |
| `F1` / `F8` / `F9`     | Hilfe / Fenster und Layouts / Auswertung       |

Alle Tasten außer Enter und Alt+Ziffer in der Notrufmaske lassen sich unter **Tasten** neu
belegen.

### Mehrere Bildschirme

Unter **Fenster** öffnen Lagekarte, Listen (Einsätze, Aufträge, Kliniken, Funk) und
Fahrzeugstatus je ein eigenes Fenster für weitere Bildschirme. Dialoge öffnen sich immer im
Hauptfenster, die Auswahl eines Einsatzes gilt in allen Fenstern. Mitgelieferte Layouts passen
sich der Zahl der Bildschirme an; eigene Anordnungen lassen sich speichern und werden beim
nächsten Start wiederhergestellt.

![Fenster und Layouts](docs/images/fenster.png)

### Fehler melden

**Hilfe → Diagnosepaket erstellen** speichert Protokolle und Absturzberichte als ZIP. Es wird
nichts automatisch versendet – das Paket kann einem
[Fehlerbericht](https://github.com/samuelklsn/leitstelle-112/issues/new/choose) angehängt werden.

## Stand und Roadmap

**v0.7.0:** Massenanfall von Verletzten und Großlagen. **v0.6.0:** Mehrere Fenster und Bildschirme, eigene Tastenbelegung, Diagnosepaket. **v0.5.0:** Wetter, Feiertage, Ereignisse, Rettungshubschrauber. **v0.4.0:** Krankentransporte, Klinikabmeldungen, Pausen. **v0.3.0:** Feuerwehr mit Brand- und Hilfeleistungslagen, die sich ausbreiten. **v0.2.0:** strukturierte Notrufabfrage mit Fehl-, Scherz- und Doppelanrufen. **Seit v0.1.0:** Rettungsdienst im fiktiven Landkreis Brakenfeld. Dazu gehören
7 Orte, 3 Rettungswachen, 2 Notarztstandorte, 2 Krankenhäuser, 4 Stichworte und
14 Krankheitsbilder, außerdem Tutorial, Speichern und Laden sowie die Schichtauswertung.

| Meilenstein          | Inhalt                                                                      | Stand                                                              |
| -------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| M1 Fundament         | Monorepo, CI, Electron, deterministischer Simulationskern                   | ✅                                                                 |
| M2 Welt & Routing    | Landkreis-Generator, Straßengraph, Fahrzeitmodell, Offline-Karte            | ✅                                                                 |
| M3 Vertical Slice    | Notruf → Disposition → Anfahrt → Befund → Transport → Krankenhaus           | ✅                                                                 |
| M4 v0.1.0            | Speichern, Autosave, Auswertung, Tutorial, Tastatur                         | ✅                                                                 |
| M5 Notrufannahme 2.0 | Strukturierte Abfrage, Fehl-, Scherz- und Doppelanrufe, Polizei-Übergaben   | ✅                                                                 |
| M6 Feuerwehr         | Feuerwachen, B/TH-Stichworte, Lagemeldung, Nachforderung, Brandausbreitung  | ✅                                                                 |
| M7 RD-Logistik       | KTW/ITW, Krankentransporte, Klinikabmeldungen, Status 6, Pausen             | ✅                                                                 |
| M8 Welt-Dynamik      | Wetter, Feiertage, Sommerzeit, Ereignisse, Sperrungen, Regie, RTH           | ✅                                                                 |
| M9 Mehrfenster       | Fenster je Ansicht, Layout-Profile, Tastenbelegung, Diagnosepaket           | ✅                                                                 |
| M10 MANV             | Großlagen, Sichtung, LNA/OrgL/SEG, Bereitstellungsraum, Patientenverteilung | ✅                                                                 |
| M11 – M12            | Langzeitspiel, Editoren                                                     | [geplant](https://github.com/samuelklsn/leitstelle-112/milestones) |

## Technik

Electron · TypeScript (strict) · React · MapLibre GL · SQLite (`node:sqlite`) · Zod · Vitest ·
fast-check · Playwright

Der Simulationskern ist deterministisch: Gleicher Seed und gleiche Eingaben ergeben immer denselben
Verlauf. So lassen sich Abstürze per Replay nachstellen, und Bots können ganze Schichten
automatisiert testen. Details: [Architektur-Entscheidungen](docs/adr/README.md).

## Entwickeln

Voraussetzungen: Windows 10/11 x64, Node.js LTS, pnpm 10.

```powershell
pnpm install
pnpm dev
```

```powershell
pnpm lint; pnpm typecheck; pnpm test
```

Weitere Befehle und Konventionen: [CONTRIBUTING.md](CONTRIBUTING.md).

## Lizenz

- Code: [GPL-3.0-or-later](LICENSE)
- Inhalte (Daten, Karten, Texte): [CC BY-SA 4.0](content/LICENSE.md)
- Fremdkomponenten: [docs/LICENSES.md](docs/LICENSES.md)

> **Hinweis:** Leitstelle 112 ist ein Spiel. Es ist kein Schulungswerkzeug mit fachlicher
> Verbindlichkeit für den realen Leitstellen- oder Rettungsdienstbetrieb. Alle Orte, Personen und
> Einrichtungen im Landkreis Brakenfeld sind frei erfunden.
