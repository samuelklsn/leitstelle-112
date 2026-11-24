# Leitstelle 112 – Projektplan (Phase 0)

> Status: **Freigegeben** (2026-11-24) · Arbeitstitel änderbar

## 1. Vision

**Leitstelle 112** ist ein realistischer, offline lauffähiger Leitstellensimulator für Windows.
Der Spieler sitzt als Disponent in einer Integrierten Leitstelle (Rettungsdienst, Brandschutz,
Katastrophenschutz). Er nimmt Notrufe an, fragt strukturiert ab, alarmiert nach Alarm- und
Ausrückeordnung, führt Fahrzeuge über FMS-Status und Funk und sorgt dafür, dass Patienten
rechtzeitig im passenden Krankenhaus ankommen.

Leitgedanken:

1. **Glaubwürdige Abläufe vor Effekten.** Jede Mechanik orientiert sich am realen
   Leitstellenalltag: Fahrzeiten aus echtem Routing, FMS-Zyklen, Übergabezeiten,
   Bettenkapazitäten, Hilfsfristen.
2. **Ein Werkzeug, kein Spielzeug.** Die Oberfläche fühlt sich an wie ein Einsatzleitrechner:
   dicht, schnell, per Tastatur bedienbar, mehrere Monitore.
3. **Deterministisch und nachvollziehbar.** Gleicher Seed + gleiche Eingaben = gleicher
   Verlauf. Das macht Tests, Replays, Bugreports und faire Auswertungen möglich.
4. **Offen für Inhalte.** Einsatzarten, Fahrzeuge, Wachen, Krankenhäuser und Regionen sind
   Daten, keine Code-Konstanten. Die Community kann eigene Leitstellenbereiche bauen.
5. **Eigenständig.** Kein Code, keine Grafiken, Texte, Daten oder Namen aus LstSim.de oder
   anderen Spielen. LstSim.de dient nur als Genre-Referenz.
6. **Nie durchgespielt.** Kein Ende, keine auswendig lernbaren Einsätze. Vielfalt entsteht aus
   kombinierbaren Bausteinen, einer verborgenen „wahren Lage", sich entwickelnden Einsätzen
   und einer lebendigen Welt (Kapitel 3a, ADR-0014).

Nicht-Ziele (bewusst):

- Kein Online-/Multiplayer-Zwang, keine Accounts, keine Telemetrie.
- Kein medizinisches oder einsatztaktisches Schulungswerkzeug mit Anspruch auf fachliche
  Verbindlichkeit (Hinweis im Spiel).
- Keine Polizei-Disposition als Spielerrolle; Polizei ist externe Lage.

## 2. Feature-Liste

Legende: **MVP** = Vertical Slice (v0.1), **1.0** = erste vollständige Version,
**Später** = nach 1.0 oder bei Bedarf.

### 2.1 Notrufannahme

| Feature                                                                        | MVP | 1.0 | Später |
| ------------------------------------------------------------------------------ | :-: | :-: | :----: |
| Eingehender Notruf mit generiertem Dialog (Textbausteine)                      |  ●  |     |        |
| Strukturierte Abfrage: Wo, Was, Wie viele, Welche Verletzungen, Rückrufnummer  |  ●  |     |        |
| Adresssuche mit Straßen/Hausnummern der Region (Geocoding offline)             |  ●  |     |        |
| Unklare/panische Anrufer, unvollständige Angaben, Nachfragen nötig             |     |  ●  |        |
| Fehlalarme, Missbrauchsanrufe, Doppelmeldungen zum selben Ereignis             |     |  ●  |        |
| Mehrere Leitungen, Warteschlange, Wartezeit-Bewertung                          |     |  ●  |        |
| Übergaben von 110 (Polizei) und Nachbarleitstellen                             |     |  ●  |        |
| Abfrageprotokolle je Meldebild (standardisierte Notrufabfrage, eigenes Schema) |     |  ●  |        |
| Sprachausgabe der Anrufer (Windows-TTS, offline)                               |     |     |   ●    |

### 2.2 Disposition

| Feature                                                                        |        MVP        |       1.0       | Später |
| ------------------------------------------------------------------------------ | :---------------: | :-------------: | :----: |
| Einsatzstichworte mit AAO-Vorschlag, Spieler kann überstimmen                  |         ●         |                 |        |
| Vorschlag nächstes geeignetes Fahrzeug nach **Fahrzeit** (nicht Luftlinie)     |         ●         |                 |        |
| RTW, NEF                                                                       |         ●         |                 |        |
| KTW, ITW, NAW                                                                  |                   |        ●        |        |
| RTH/ITH (Tagbetrieb, wetterabhängig, Landeplatz/Zwischenlandung)               |                   |        ●        |        |
| Feuerwehr: HLF, LF, TLF, DLK, RW, ELW 1/2, GW-Typen                            |                   |        ●        |        |
| SEG / Schnell-Einsatz-Gruppen, Alarmierung über Meldeempfänger mit Ausrückzeit |                   |        ●        |        |
| Polizei als externe Lage (Anforderung, Eintreffen gemeldet)                    |                   |        ●        |        |
| FMS-Status 0–9 inkl. Sprechwunsch (5) und priorisiertem Sprechwunsch (0)       | ● (1,2,3,4,6,7,8) | ● (vollständig) |        |
| Funkverkehr als Textlog                                                        |         ●         |                 |        |
| Nachalarmierung, Rückmeldungen von der Einsatzstelle ("Lage")                  |                   |        ●        |        |
| Rendezvous-System Notarzt (NEF + RTW, NA-Begleitung, Nachforderung)            |                   |        ●        |        |
| Nachbarschaftshilfe über Bereichsgrenzen                                       |                   |        ●        |        |
| Gebietsabsicherung / Umsetzen von Fahrzeugen (Bedarfsplanung)                  |                   |        ●        |        |

### 2.3 Rettungsdienst-Logistik

| Feature                                                                    |     MVP      | 1.0 | Später |
| -------------------------------------------------------------------------- | :----------: | :-: | :----: |
| Krankenhäuser mit Fachabteilungen und Versorgungsstufen                    | ● (2 Häuser) |     |        |
| Zielklinikvorschlag nach Diagnose und Entfernung                           |      ●       |     |        |
| Bettenkapazität, Abmeldungen, Behandlungskapazitäten-Nachweis              |              |  ●  |        |
| Übergabezeit, Rückfahrt zur Wache                                          |      ●       |     |        |
| Desinfektion nach Infektionstransport                                      |              |  ●  |        |
| Fahrzeugdefekte, Tankstopps, Pausen, Schichtwechsel                        |              |  ●  |        |
| Krankentransporte inkl. geplanter Termine, Verlegungen, Intensivtransporte |              |  ●  |        |

### 2.4 Welt & Dynamik

| Feature                                                                                   |     MVP      |           1.0           | Später |
| ----------------------------------------------------------------------------------------- | :----------: | :---------------------: | :----: |
| Tageszeit- und Wochentagsmuster im Einsatzaufkommen                                       | ● (einfach)  |        ● (fein)         |        |
| Verkehrsfaktoren (Berufsverkehr, Nacht, Wochenende) auf Fahrzeiten                        |      ●       |                         |        |
| Wetter (Regen, Schnee, Glätte, Hitze, Nebel) auf Fahrzeit und Aufkommen                   |              |            ●            |        |
| Feiertage, Silvester, Großveranstaltungen                                                 |              |            ●            |        |
| Großschadenslagen / MANV: Sichtung, Bereitstellungsraum, ELW-Führung, Patientenverteilung |              |            ●            |        |
| Hilfsfristen je Bundesland, konfigurierbar                                                | ● (1 Preset) | ● (Presets mit Quellen) |        |
| Echte Regionen aus OSM und öffentlichen Verzeichnissen                                    |              |                         |   ●    |

### 2.5 Bewertung & Fortschritt

| Feature                                                                          |             MVP              |       1.0       | Später |
| -------------------------------------------------------------------------------- | :--------------------------: | :-------------: | :----: |
| Schichtauswertung: Hilfsfrist, Dispositionsqualität, Fehler, Outcome, Auslastung |          ● (Basis)           |        ●        |        |
| Tutorial                                                                         | ● (geführter erster Einsatz) | ● (vollständig) |        |
| Trainingsmodus, Schwierigkeitsgrade                                              |                              |        ●        |        |
| Freies Spiel                                                                     |              ●               |                 |        |
| Szenario-Editor                                                                  |                              |        ●        |        |
| Regionen-Editor (Wachen, Fahrzeuge, Krankenhäuser auf der Karte)                 |                              |        ●        |        |
| Replays (Seed + Eingabeprotokoll)                                                |                              |        ●        |        |
| Steam-Workshop o. Ä. Mod-Verteilung                                              |                              |                 |   ●    |

### 2.6 UI/UX & Technik

| Feature                                                                                |           MVP           |    1.0    | Später |
| -------------------------------------------------------------------------------------- | :---------------------: | :-------: | :----: |
| Dunkles Einsatzleitrechner-Theme, klare Statusfarben                                   |            ●            |           |        |
| Karte (MapLibre, offline), Einsatzliste, Fahrzeugstatus, Notrufmaske, Funklog          | ● (ein Fenster, Panels) |           |        |
| Mehrfenster / Mehrmonitor mit gespeichertem Layout                                     |                         |     ●     |        |
| Vollständige Tastatursteuerung, konfigurierbare Shortcuts                              |     ● (Kernabläufe)     | ● (alles) |        |
| Barrierearmut: Kontraste (WCAG AA), skalierbare Schrift, farbunabhängige Statusanzeige |            ●            |           |        |
| Pause, Zeitraffer 1x/2x/5x/10x                                                         |            ●            |           |        |
| Autosave, mehrere Speicherstände                                                       |            ●            |           |        |
| Strukturiertes Logging, lokale Crash-Reports                                           |            ●            |           |        |
| Windows-Installer (NSIS)                                                               |            ●            |           |        |
| Deutsche UI, i18n-fähig (Englisch als zweite Sprache)                                  |         ● (DE)          |           | ● (EN) |
| Mod-Ordner mit Schema-Validierung und Fehlermeldungen                                  |                         |     ●     |        |

## 3. Vertical Slice (MVP, v0.1)

Ein spielbarer, vollständiger Ablauf in einem kleinen Gebiet:

**Notruf → Abfrage → Einsatz anlegen → Disposition → Alarmierung → Anfahrt → am Einsatzort →
Patient aufgenommen → Transport → Krankenhaus → Übergabe → Rückfahrt → frei.**

Inhalt:

- **Fiktiver Landkreis „Brakenfeld"** (Arbeitsname): Kreisstadt (~40.000 EW) und
  4–6 Gemeinden, ca. 25 × 20 km. Autobahnabschnitt, Bundes-, Landes-, Kreis- und
  Ortsstraßen, ein Fluss mit wenigen Brücken (wichtig für realistische Umwege), Wald,
  Gewerbegebiet.
- **3 Rettungswachen** (5 RTW gesamt), **1 Notarztstandort** (1 NEF, am Krankenhaus).
- **2 Krankenhäuser**: Kreisklinikum (Schwerpunktversorgung, Stroke Unit,
  Herzkatheter) und ein kleines Haus der Grundversorgung.
- **~12 Meldebilder** im Rettungsdienst (z. B. internistischer Notfall, Brustschmerz,
  Schlaganfallverdacht, Sturz, Verkehrsunfall mit Verletztem, Bewusstlosigkeit, Atemnot,
  Kinder-Notfall) mit eigenem Stichwortschema.
- Einsatzaufkommen nach einfacher Tageskurve, Verkehrsfaktoren nach Uhrzeit.
- Schichtauswertung mit Hilfsfrist-Quote und Fehlerliste.

Abnahmekriterium: Ein neuer Spieler schafft mit dem Tutorial einen kompletten Einsatz
und danach 30 Minuten freies Spiel ohne Absturz; alle automatischen Tests grün;
Installer läuft auf einem frischen Windows 11.

## 3a. Wiederspielbarkeit – warum das Spiel nie gleich ist

Details und Begründung: ADR-0014. Kurzfassung der Mechaniken und wann sie kommen:

| Mechanik                                                                                | Beispiel                                                                                                   | ab                             |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------ |
| Einsätze aus Bausteinen (Meldebild × Patient × Ort × Umstände × Anrufer × Komplikation) | „Sturz" wird zu: 84-Jährige, 3. OG ohne Aufzug, Hund in der Wohnung, Nachbarin ruft an, nachts, Glätte     | M3 (einfach), M5 (voll)        |
| Wahre Lage ≠ gemeldete Lage                                                             | „Bewusstlose Person" → vor Ort Reanimation; „Kleinbrand" → Wohnungsbrand mit Menschenleben in Gefahr       | M3 (Datenmodell), M5/M6 (voll) |
| Lageentwicklung und Folgeeinsätze                                                       | Patient verschlechtert sich während der Anfahrt; Unfall → Stau → Auffahrunfall                             | M6                             |
| Ortsabhängiges Aufkommen                                                                | Seniorenheim nachts, Freibad im Sommer, Disco am Samstag, Autobahn im Berufsverkehr                        | M3 (einfach), M8               |
| Ereigniskalender und Weltlage                                                           | Glätte, Hitzewelle, Unwetter, Grippewelle, Volksfest, Silvester, Baustellen/Sperrungen, Klinik-Abmeldungen | M7/M8                          |
| Seltene Großereignisse                                                                  | Busunfall, Zugunglück, Gefahrgut, Großbrand, Evakuierung                                                   | M10                            |
| Wiederkehrende Personen und Adressen                                                    | Vielanrufer, Stammpatienten, bekannte Problemadressen                                                      | M11                            |
| Einsatz-Regie (Director)                                                                | Wechsel von Ruhephasen und Spitzen innerhalb realistischer Grenzen                                         | M8                             |
| Langzeitspiel                                                                           | Endlosbetrieb mit Kalender, Laufbahn, größere Bereiche, Bedarfsplanung, Tages-Seed-Herausforderung         | M11                            |
| Community-Inhalte                                                                       | eigene Regionen, Bausteine, Szenarien                                                                      | M12                            |

## 4. Architektur

### 4.1 Überblick

```
┌─────────────────────────── Electron-App ────────────────────────────┐
│                                                                     │
│  Main-Prozess (dünn)                                                │
│  - Fenster/Monitore, Menüs, Lifecycle                               │
│  - Logging-Sammelstelle, Crash-Handler                              │
│  - startet Sim-Host, verteilt MessagePorts an Fenster               │
│           │                                                         │
│           ▼                                                         │
│  Sim-Host (utilityProcess, Node)                                    │
│  - lädt Inhalte (YAML, validiert) und Regionspaket                  │
│  - betreibt @ls112/sim: fester Tick, Zeitraffer, Pause              │
│  - nimmt Befehle an, sendet State-Deltas + Ereignisse               │
│  - Persistenz: SQLite (Speicherstände, Autosave, Statistik)         │
│           ▲ MessagePort (je Fenster)                                │
│           │                                                         │
│  Renderer-Fenster 1..n (React)                                      │
│  - Karte (MapLibre), Einsatzliste, Fahrzeugstatus, Notrufmaske, Funk│
│  - nur Darstellung + Eingabe; interpoliert Bewegungen auf 60 FPS    │
│  - Kartenkacheln über eigenes Protokoll (app-tiles://)              │
└─────────────────────────────────────────────────────────────────────┘
```

Kernregel: **Die Simulation kennt kein UI, keinen DOM, kein Node-API und keine Systemzeit.**
Sie ist eine reine TypeScript-Bibliothek. Der Sim-Host ist nur Adapter (Zeitgeber,
Persistenz, Nachrichten).

### 4.2 Pakete (pnpm-Monorepo)

| Paket                     | Inhalt                                                                          | darf abhängen von           |
| ------------------------- | ------------------------------------------------------------------------------- | --------------------------- |
| `packages/sim`            | Simulationskern: Zeit, PRNG, Entitäten, Systeme, Befehle, Ereignisse, Bewertung | `routing`, `content-schema` |
| `packages/routing`        | Straßengraph (Typed Arrays), Dijkstra/A*, One-to-Many, Fahrzeitmodell           | –                           |
| `packages/content-schema` | Zod-Schemas für alle Inhalte, generierte JSON-Schemas, Typen                    | –                           |
| `packages/content-loader` | YAML laden, validieren, Mods zusammenführen, Fehlerberichte                     | `content-schema`            |
| `packages/protocol`       | Typen für Befehle, Deltas, Ereignisse zwischen Sim-Host und UI                  | `sim` (nur Typen)           |
| `apps/desktop`            | Electron Main + Preload + Sim-Host, SQLite, Logging, Crash, Installer           | alle Pakete                 |
| `apps/ui`                 | React-Renderer (Vite), i18n, Theme, Shortcuts                                   | `protocol`                  |
| `tools/region-builder`    | Generator für fiktive Regionen, später OSM-Import; erzeugt Regionspakete        | `routing`, `content-schema` |
| `content/base`            | Basisinhalte (YAML): Fahrzeugtypen, Meldebilder, AAO, Region Brakenfeld         | –                           |

Abhängigkeitsrichtung wird per ESLint-Regel (`import/no-restricted-paths` bzw.
`eslint-plugin-boundaries`) erzwungen.

### 4.3 Simulationskern

- **Zeit:** Ganzzahlige Spielzeit in Millisekunden ab Szenariostart, Kalender wird daraus
  abgeleitet. **Fester Tick = 1 s Spielzeit.** Zeitraffer erhöht die Anzahl der Ticks pro
  Echtzeitsekunde (1, 2, 5, 10); Pause stoppt den Zeitgeber. Der Kern selbst kennt nur
  `step()`.
- **Hybridmodell:** Tick-Systeme (Bewegungsfortschritt, Zustandsverfall von Patienten)
  plus eine Ereigniswarteschlange mit festen Zeitpunkten (Anruf geht ein, Übergabe fertig).
  Ereignisse mit gleichem Zeitpunkt werden nach stabiler Sequenznummer abgearbeitet.
- **Zufall:** Eigener PRNG (PCG32 oder xoshiro128\*\*), aus Master-Seed per SplitMix
  abgeleitete **Streams je Subsystem** (Anrufe, Patienten, Verkehr, Wetter …). So verschiebt
  ein neues Feature nicht die Zufallsfolge anderer Systeme.
- **Determinismus-Regeln:** kein `Math.random`, kein `Date`, keine Iteration über
  Objekte mit unklarer Reihenfolge, keine transzendenten Funktionen (`Math.sin` u. a.)
  in Kernlogik ohne eigene Implementierung; Geometrie wird zur Build-Zeit vorberechnet.
  Ein **State-Hash** pro Tick (optional) erlaubt Determinismus-Tests.
- **Befehle:** Jede Spielerhandlung ist ein serialisierbarer Befehl
  (`DispatchVehicle`, `SetStatus`, `CreateIncident` …), wird zum nächsten Tick angewendet
  und mit Tick-Nummer protokolliert → Replays und reproduzierbare Bugreports.
- **Zustand:** Normalisierte Tabellen (Map nach ID) für Anrufe, Einsätze, Patienten,
  Fahrzeuge, Wachen, Krankenhäuser. Systeme als reine Funktionen über den Zustand
  (ECS-light), Fahrzeugabläufe als explizite Zustandsautomaten entlang der FMS-Status.
- **Ausgabe:** Ereignisse (für Funklog, Benachrichtigungen, Auswertung) und
  Deltas (für das UI). Texte erzeugt der Kern **nicht**, nur Meldungsschlüssel +
  Parameter → i18n im UI.
- **Patientenmodell:** Schweregrad (angelehnt an NACA), zeitkritische Tracer-Diagnosen
  (Schlaganfall, ACS, Polytrauma, Reanimation) mit Zeitfenstern; Outcome hängt von
  Eintreffzeit, passenden Rettungsmitteln (NA-Indikation) und passender Zielklinik ab.

### 4.4 Routing und Fahrzeiten

- Regionspaket enthält einen **vorberechneten, gerichteten Straßengraphen** als binäre
  Typed Arrays (CSR-Format): Knoten, Kanten, Länge, Straßenklasse, Höchstgeschwindigkeit,
  Abbiege-/Einbahnregeln, Polylinien-Index für die Darstellung.
- **Fahrzeit einer Kante** = Länge / Basisgeschwindigkeit(Klasse, Tempolimit)
  × Verkehrsfaktor(Klasse, Tageszeit, Wochentag) × Wetterfaktor × Sonderrechtefaktor.
  Sonderrechte wirken je Straßenklasse unterschiedlich (innerorts großer Gewinn,
  Autobahn kaum) und werden vom Verkehrsfaktor gedämpft, nicht aufgehoben.
- **Nächstes Fahrzeug:** Ein einzelner Dijkstra **rückwärts vom Einsatzort** liefert die
  Fahrzeit für alle Fahrzeuge in einem Durchlauf (One-to-Many) – auch für fahrende
  Fahrzeuge, deren Position auf ihrer Route bekannt ist.
- **Einzelrouten:** A* mit Fahrzeit-Heuristik. Für den Landkreis (~50–150 Tsd. Knoten)
  reicht das im Millisekundenbereich; für große echte Regionen kommen Contraction
  Hierarchies hinzu (vorberechnet im Region-Builder).
- Die Route wird bei Abfahrt berechnet und bei Statuswechsel/Umleitung neu bestimmt;
  nicht in jedem Tick.

### 4.5 Karte (offline)

- **MapLibre GL JS** im Renderer, Kacheln aus dem Regionspaket über ein eigenes
  Electron-Protokoll, keinerlei Netzwerkzugriff (CSP verbietet externe Hosts).
- Kartenstil, Glyphen (freie Schrift, z. B. Noto Sans/OFL) und Sprites eigen und im Repo.
- Fiktive Region: Der **Region-Builder** erzeugt aus einer Konfiguration (Orte, Achsen,
  Fluss, Seed) Straßen, Flächennutzung, Adressen und daraus Vektorkacheln + Routinggraph.
  Echte Regionen später: OSM-Extrakt (Geofabrik) → gleiche Pipeline. ODbL-Attribution
  wird angezeigt, **sobald** ein Paket OSM-Daten enthält (Metadatenfeld im Paket).
- Fahrzeuge/Einsätze als GeoJSON-Quellen mit Symbol-Layern; Positionen interpoliert der
  Renderer aus Route + Fortschritt, die Sim sendet nur Fortschritt (ca. 4–10 Hz).

### 4.6 Persistenz

- **Speicherstände:** SQLite-Datei je Profil (`%APPDATA%\Leitstelle112\saves.db`).
  Ein Spielstand = komprimierter Snapshot des Sim-Zustands + Metadaten (Region,
  Content-Hash, Spielzeit, Version) + Befehlsprotokoll seit Start (für Replays).
  Autosave rollierend (z. B. alle 5 Spielminuten, letzte 3 behalten), Schreiben atomar in
  einer Transaktion.
- **Schema-Migrationen** für Saves sind versioniert; inkompatible Saves werden klar
  gemeldet, nicht still verworfen.
- **Stammdaten/Inhalte** liegen als YAML im Content-Ordner (Quelle der Wahrheit, modbar).
  SQLite dient optional als Cache des validierten Inhalts (Startzeit). Begründung:
  Siehe ADR-0008.

### 4.7 UI

- React 19 + Vite, TypeScript strict, Zustand (State-Store, gefüttert aus Sim-Deltas),
  CSS Modules + Design-Tokens (CSS-Variablen) für Theme und Statusfarben,
  Radix-Primitives für zugängliche Dialoge/Menüs, TanStack Virtual für lange Listen.
- Shortcut-Manager mit konfigurierbarer Belegung, Fokusführung wie im Einsatzleitrechner
  (z. B. F-Tasten für Masken, Enter bestätigt Vorschlag, Esc verwirft).
- Statusfarben sind nie das einzige Merkmal (zusätzlich Ziffer/Symbol/Text).
- i18n mit i18next; alle Texte inkl. Funksprüche/Anruferdialoge in Sprachdateien.

### 4.8 Qualitätssicherung

| Ebene          | Werkzeug                                    | Was                                                                                                                    |
| -------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Statik         | TypeScript strict, ESLint (typed), Prettier | bei jedem Commit (lint-staged) und in CI                                                                               |
| Unit           | Vitest                                      | alle Pakete                                                                                                            |
| Property-based | fast-check                                  | Sim-Invarianten (s. u.), Routing (Dreiecksungleichung, Symmetrie bei ungerichteten Kanten), Serialisierung (Roundtrip) |
| Determinismus  | Vitest + Golden-Replays                     | gleicher Seed + Befehle → gleicher State-Hash                                                                          |
| Inhalte        | Content-Validator CLI                       | Schemas + Querverweise (AAO verweist auf existierende Fahrzeugtypen …)                                                 |
| E2E            | Playwright (`_electron`)                    | Kernabläufe auf echtem Build                                                                                           |
| Performance    | Vitest bench + E2E-FPS-Messung              | Budgets: Tick bei 10x mit 300 Fz/100 Einsätzen < 5 ms, UI ≥ 60 FPS, Start < 5 s                                        |
| CI             | GitHub Actions `windows-latest`             | lint, typecheck, test, content-validate, build, e2e, Installer als Artefakt                                            |

Sim-Invarianten (Beispiele): Ein Fahrzeug ist höchstens einem Einsatz zugeordnet; nur
erlaubte FMS-Übergänge; Patienten gehen nicht verloren; Spielzeit monoton; Belegung eines
Krankenhauses nie negativ; nach Pause ändert sich der Zustand nicht.

### 4.9 Betrieb

- **Logging:** strukturierte JSON-Lines (pino) aus allen Prozessen, gesammelt im Main,
  Rotation, `%APPDATA%\Leitstelle112\logs\`.
- **Crash-Reports:** Electron-`crashReporter` lokal (ohne Upload) für native Abstürze;
  JS-Fehler in allen Prozessen → JSON-Report mit Version, Seed, letzten Befehlen,
  Log-Auszug unter `…\crashes\`. Dialog bietet „Ordner öffnen" an, nichts wird gesendet.
- **Installer:** electron-builder → NSIS, Benutzer-Installation ohne Adminrechte
  (Option für alle Benutzer). Code-Signing vorbereitet, Zertifikat später.

## 5. Tech-Stack – Entscheidung

| Bereich       | Wahl                                          | Kurzbegründung                                                                                       | ADR  |
| ------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ---- |
| Desktop-Shell | **Electron** (statt Tauri 2)                  | eine Sprache, Sim als Node-Prozess für viele Fenster, Playwright-E2E nativ, stabile Mehrmonitor-APIs | 0002 |
| Sprache       | TypeScript (aktuelle stabile Version), strict | Vorgabe; ein Typsystem von Inhalten bis UI                                                           | 0003 |
| Monorepo      | pnpm workspaces                               | schnelle, strikte Abhängigkeiten                                                                     | 0003 |
| UI            | React 19, Vite, Zustand, CSS Modules, Radix   | ausgereift, gut testbar                                                                              | 0011 |
| Karte         | MapLibre GL JS, eigene Vektorkacheln          | offline, frei lizenziert (BSD-3)                                                                     | 0006 |
| Routing       | eigene Implementierung in TS                  | deterministisch, im Sim-Kern nutzbar, keine native Abhängigkeit                                      | 0007 |
| Persistenz    | SQLite (better-sqlite3) für Saves             | robust, atomar, eine Datei                                                                           | 0008 |
| Inhalte       | YAML + Zod-Schemas → JSON-Schema              | lesbar für Modder, Typen aus einer Quelle                                                            | 0009 |
| Tests         | Vitest, fast-check, Playwright                | Vorgabe                                                                                              | 0010 |
| Logging       | pino + Electron crashReporter                 | strukturiert, lokal                                                                                  | 0012 |
| i18n          | i18next                                       | Standard im React-Umfeld                                                                             | 0011 |
| Installer     | electron-builder (NSIS)                       | per-User-Installation, ohne Admin                                                                    | 0002 |

## 6. Meilensteine

**Stand 2026-11-24:** M0–M4 abgeschlossen (v0.1.0, spielbarer Vertical Slice). Nächster Meilenstein: M5.

Jeder Meilenstein endet lauffähig, getestet, committet, mit CHANGELOG-Eintrag und
Zusammenfassung an den Product Owner.

| #    | Name                                 | Ergebnis                                                                                                                                                                                     | Grobe Größe           |
| ---- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| M0   | Planung                              | dieses Dokument, ADRs, CLAUDE.md                                                                                                                                                             | erledigt mit Freigabe |
| M1   | Fundament                            | Monorepo, Tooling, CI auf `windows-latest`, leeres Electron-Fenster mit Dark-Theme, Sim-Host-Prozess mit Tick/Pause/Zeitraffer, PRNG, Logging, Crash-Handler, NSIS-Installer als CI-Artefakt | S                     |
| M2   | Welt & Routing                       | Region-Builder für „Brakenfeld", Routinggraph, Fahrzeitmodell, Offline-Karte mit Straßen/Orten/Wachen/Krankenhäusern, Adresssuche                                                            | L                     |
| M3   | Vertical Slice – Ablauf              | Notruf mit Abfrage, Einsatz, AAO-Vorschlag, Alarmierung, FMS-Zyklus, Anfahrt auf der Karte, Transport, Übergabe, Rückfahrt; Einsatzliste, Fahrzeugliste, Funklog                             | L                     |
| M4   | Vertical Slice – fertig (v0.1.0)     | Speichern/Laden/Autosave, Schichtauswertung, Tutorial, Tastatursteuerung, Performance-Test mit 300 Fz/100 Einsätzen (synthetisch), E2E-Tests, Installer manuell geprüft                      | M                     |
| M5   | Notrufannahme & Einsatzgenerator 2.0 | Dialoggenerator, Bausteinsystem für Einsätze, wahre vs. gemeldete Lage, mehrere Leitungen, Warteschlange, Fehl-/Missbrauchs-/Doppelanrufe, 110- und Nachbarübergaben                         | L                     |
| M6   | Feuerwehr & AAO                      | Fahrzeugtypen Feuerwehr, Brand-/TH-Stichworte, Nachalarmierung, Lagemeldungen, NEF-Rendezvous, KTW/ITW/NAW                                                                                   | L                     |
| M7   | RD-Logistik                          | Bettenkapazität und Abmeldungen, Krankentransport-Termine, Verlegungen, Desinfektion, Defekte, Tanken, Pausen, Schichtwechsel                                                                | M                     |
| M8   | Welt-Dynamik                         | feine Tages-/Wochenmuster, Wetter, Feiertage, Silvester, Ereigniskalender, Straßensperrungen, Einsatz-Regie, RTH/ITH                                                                         | M                     |
| M9   | Mehrfenster & Mehrmonitor            | frei anordenbare Fenster, Layout-Profile, vollständige Shortcuts                                                                                                                             | M                     |
| M10  | MANV & Großlagen                     | Sichtung, Bereitstellungsraum, ELW-Führung, Patientenverteilung, SEG, seltene Großereignisse                                                                                                 | L                     |
| M11  | Langzeitspiel                        | Endlosbetrieb mit Kalender, Laufbahn, Bereichsübernahme, Bedarfsplanung, wiederkehrende Personen, Tages-Seed-Herausforderung                                                                 | M                     |
| M12  | Editoren & Modding (v1.0.0)          | Regionen- und Szenario-Editor, Mod-Ordner, Schema-Doku, Trainingsmodus, Schwierigkeitsgrade, Hilfsfrist-Presets aller Länder mit Quellen                                                     | L                     |
| M13+ | Echte Regionen                       | OSM-Pipeline, Import öffentlicher Wachen-/Krankenhausdaten mit Lizenzprüfung                                                                                                                 | –                     |

Reihenfolge nach M4 ist verhandelbar; M9 kann vorgezogen werden, falls Mehrmonitor früh
wichtig ist.

## 7. Risiken

| Risiko                                                | Auswirkung                       | Gegenmaßnahme                                                                                                           |
| ----------------------------------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Glaubwürdige fiktive Karte ist aufwendig              | Slice wirkt künstlich            | Generator mit handgesetzten Achsen/Orten statt reinem Zufall; früh visuell prüfen (M2)                                  |
| Fachlicher Realismus (AAO, Medizin, Hilfsfristen)     | Fehler fallen Kennern sofort auf | Annahmen in `docs/domain/` mit Quellen dokumentieren, Werte datengetrieben, Review durch Fachleute aus dem Spielerkreis |
| Determinismus bricht unbemerkt                        | Replays/Tests unbrauchbar        | Lint-Verbote, Golden-Replay-Tests in CI                                                                                 |
| Performance der Karte bei vielen Objekten             | Ruckeln                          | GeoJSON-Updates gedrosselt, Interpolation im Renderer, Benchmark ab M4                                                  |
| Native Module (better-sqlite3) und Electron-Versionen | Build-Probleme                   | Prebuilds, Rebuild in CI, Fallback `node:sqlite` prüfen                                                                 |
| Firmenrechner blockiert Programme in AppData          | Werkzeuge starten nicht          | Werkzeuge und Caches unter `C:\dev`, CI als maßgebliche Build-Umgebung (Kapitel 9)                                      |
| Vielfalt wirkt nach einiger Zeit doch repetitiv       | Spieler verlieren Interesse      | Bausteinsystem, wahre vs. gemeldete Lage, Long-Tail-Ereignisse, Statistik über Wiederholungen (ADR-0014)                |
| Unsigned Installer                                    | SmartScreen-Warnung              | dokumentieren; Code-Signing-Zertifikat vor öffentlicher Verteilung                                                      |

## 8. Entscheidungen des Product Owners (2026-11-24)

1. **Plan freigegeben**, Electron als Desktop-Shell (ADR-0002 angenommen).
2. **Speicherort:** Repo liegt unter `C:\dev\leitstelle-112` (außerhalb von OneDrive).
3. **GitHub:** öffentliches Repository, Pflege über Issues, Meilensteine und Pull Requests.
4. **Lizenz:** an das Team delegiert → GPL-3.0-or-later für Code, CC BY-SA 4.0 für Inhalte
   (ADR-0013).
5. **Landkreis:** „Brakenfeld" bestätigt.
6. **Werkzeuge:** Node.js LTS, pnpm 10 und GitHub CLI installiert.
7. **Neu:** Das Spiel soll realistisch und nicht durchspielbar sein, mit ständig neuen
   Situationen (Kapitel 3a, ADR-0014).

## 9. Hinweise zur Entwicklungsumgebung

Der Entwicklungsrechner ist ein verwalteter Firmenrechner: Programme aus `%APPDATA%` bzw.
`%LOCALAPPDATA%` dürfen nicht starten (pnpm 11 als native `.exe` wurde blockiert). Deshalb:

- pnpm 10 (JavaScript-basiert) unter `C:\dev\tools\pnpm`.
- Werkzeug-Caches, die ausführbare Dateien enthalten (z. B. electron-builder/NSIS), werden
  per Umgebungsvariable nach `C:\dev\.cache` umgeleitet.
- Die CI auf GitHub Actions ist davon unabhängig und die maßgebliche Build-Umgebung.
- **Der Windows-Installer wird nur in der CI gebaut.** Lokal bricht electron-builder mit
  `spawn EPERM` ab, weil die Richtlinie den frisch erzeugten, unsignierten Installer-Stub nicht
  starten lässt. Lint, Tests, Build und E2E laufen lokal normal.
