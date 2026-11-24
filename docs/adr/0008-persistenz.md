# ADR-0008: Persistenz – SQLite für Spielstände, YAML für Inhalte

- Status: Angenommen
- Datum: 2026-11-24

## Kontext

Vorgabe: SQLite für Spielstände und Stammdaten; zugleich sollen Inhalte datengetrieben in
JSON/YAML mit Schema-Validierung vorliegen, damit sie modbar sind. Beides zugleich als
Quelle der Wahrheit führt zu Doppelpflege.

## Entscheidung

- **Spielstände, Einstellungen, Statistik/Schichtauswertungen:** SQLite über
  **better-sqlite3** im Sim-Host. WAL-Modus, atomare Transaktionen, versionierte Migrationen.
- **Spielstand-Inhalt:** komprimierter Snapshot des Sim-Zustands, Metadaten (Version,
  Region, Content-Hash, Seed, Spielzeit) und Befehlsprotokoll.
- **Stammdaten/Inhalte** (Fahrzeugtypen, Meldebilder, AAO, Wachen, Krankenhäuser):
  **Quelle der Wahrheit ist YAML** im Content-/Mod-Ordner (ADR-0009). SQLite hält höchstens
  einen Cache des validierten, zusammengeführten Inhalts (Schlüssel = Content-Hash), um den
  Start zu beschleunigen.
- In M1 wird geprüft, ob `node:sqlite` in der verwendeten Electron-Version stabil verfügbar
  ist; falls ja, ersetzen wir better-sqlite3 (keine native Abhängigkeit mehr) – Nachtrag hier.

## Alternativen

- Stammdaten direkt in SQLite: für Modder schwer editier- und diffbar.
- Spielstände als JSON-Dateien: einfach, aber keine atomaren Teil-Updates, kein Index über
  viele Saves und Statistiken.

## Konsequenzen

Modder arbeiten mit Textdateien, das Spiel bleibt schnell. Snapshots sind an die Sim-Version
gebunden → Migrationen nötig.

## Nachtrag 2026-11-24 (M4)

`node:sqlite` ist in Electron 45 (Node 24) verfügbar und stabil genug. Wir verwenden es statt
better-sqlite3 – **kein natives Modul**, kein Rebuild für die Electron-ABI, keine DLL, die auf
verwalteten Rechnern blockiert werden könnte. Spielstände: Tabelle `saves` mit deflate-komprimiertem
Snapshot und Befehlsprotokoll, Autosave rollierend (3), Migrationen über `meta.schema`.
