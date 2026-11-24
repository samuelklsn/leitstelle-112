# ADR-0019: Mods, Editoren und Trainingsszenarien

- Status: Angenommen
- Datum: 2026-11-24

## Kontext

ADR-0009 legt fest, dass Inhalte datengetrieben und modbar sind. Bis 0.8.0 gibt es aber nur die
Basisinhalte; eigene Inhalte bedeuten, das Repository zu ändern. Meilenstein M12 (Issues #32,
#55–#57) soll Mods, Editoren und Trainingsszenarien bringen und Version 1.0.0 abschließen.

## Entscheidung

1. **Inhalte in Schichten.** Zuerst die Basis, dann jeder Unterordner des Mod-Ordners
   (`%APPDATA%\Leitstelle112\mods`) in alphabetischer Reihenfolge. Ein Mod ergänzt neue Einträge
   und **ersetzt Einträge mit gleicher ID** (Klima je Monat, Feiertage je Name). Innerhalb einer
   Schicht müssen IDs eindeutig sein.
2. **Einstellungen gezielt ändern** über `settingsOverride` (tiefe Zusammenführung, Listen werden
   ersetzt). Das Ergebnis wird wie die Basis validiert.
3. **Jeder Mod wird einzeln geprüft.** Ein fehlerhafter Mod wird übersprungen und mit seinen
   Fehlern gemeldet; das Spiel startet trotzdem. Optionaler Steckbrief `mod` (ID, Name, Version).
4. **Editoren schreiben Mods.** Szenario- und Wachen-Editor speichern JSON-Dateien (JSON ist
   gültiges YAML) in den Mod `eigene-inhalte`. Der Main-Prozess prüft Namen und Größe, der
   Sim-Host lädt die Inhalte neu. Neue Inhalte gelten ab dem nächsten neuen Spiel; ein laufendes
   Spiel und alte Spielstände bleiben bei ihren Inhalten (Prüfsumme, ADR-0008).
5. **Trainingsszenarien** sind Inhalte: Startzeit, Wetter, Ereignisse, geplante Notrufe mit Ort
   und Ziele. Der Kern plant die Notrufe als Ereignisse; das übrige Aufkommen setzt der Sim-Host
   über `callRateFactor`.
6. **Hilfsfrist-Regeln als Presets** mit Quelle und Messbeginn (Notruf, Alarmierung, Ausrücken).
   Der Kern misst je nach Regel; die Auswertung zeigt die geltende Regel.
7. **Mit 1.0.0 gilt ein stabiles Inhaltsformat:** Änderungen am Schema nur abwärtskompatibel
   (neue Felder mit Vorgaben) oder mit Migrationshinweis in der Modding-Doku.

## Konsequenzen

- Spieler können ohne Programmierung eigene Übungen und Wachen bauen und teilen.
- Ein Mod kann das Spiel nicht mehr blockieren, nur sich selbst.
- Der Regionen-Editor bearbeitet in 1.0.0 Wachen und Fahrzeuge; Straßen und Orte kommen mit der
  OSM-Pipeline (M13).
