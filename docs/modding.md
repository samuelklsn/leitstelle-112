# Mods und eigene Inhalte

Leitstelle 112 ist datengetrieben: Fahrzeuge, Wachen, Kliniken, Stichworte, Krankheitsbilder,
Feuerwehrlagen, Großlagen, Wetter, Ereignisse, Szenarien und Einstellungen sind YAML- oder
JSON-Dateien. Mods ergänzen oder ändern diese Inhalte, ohne das Spiel selbst zu verändern
(ADR-0009, [ADR-0019](adr/0019-mods-editoren.md)).

## Wo liegen Mods?

```text
%APPDATA%\Leitstelle112\mods\
  mein-mod\
    mod.yaml          Steckbrief (optional, empfohlen)
    wachen.yaml       beliebig viele Dateien, beliebige Namen
    szenarien.json
```

Im Spiel: **Mods → Mod-Ordner öffnen**. Jeder Unterordner ist ein Mod. Mods werden in
alphabetischer Reihenfolge nach den Basisinhalten geladen.

## Regeln

- **Neue Einträge** brauchen eine eindeutige ID mit Namensraum, z. B. `meinmod:rtw-sued`.
- **Gleiche ID ersetzt** den Eintrag der Basis (oder eines früheren Mods) vollständig. So ändert
  man eine Wache, ein Stichwort oder eine Klinik.
- **Einstellungen** ändert man gezielt mit `settingsOverride` – nur die genannten Werte, alles andere
  bleibt.
- **Fehler** zeigt das Spiel unter **Mods**; ein fehlerhafter Mod wird übersprungen, das Spiel
  startet trotzdem.
- Neue Inhalte gelten für **neue Spiele**. Spielstände merken sich die Prüfsumme ihrer Inhalte und
  lassen sich nach einer Mod-Änderung nicht mehr laden.

## Beispiel

Ein vollständiges Beispiel liegt unter [`docs/examples/mods/beispiel-nachtdienst`](examples/mods/beispiel-nachtdienst):

```yaml
# mod.yaml
mod:
  id: beispiel-nachtdienst
  name: Beispiel – Nachtdienst Süd
  version: 1.0.0
  author: Leitstelle 112
  description: Zweiter RTW in Tannrode, strengere Hilfsfrist, ein Übungsszenario.
```

```yaml
# inhalte.yaml
stations:
  - id: base:rw-tannrode # gleiche ID: ersetzt die Wache der Basis
    name: Rettungswache Tannrode
    kind: rettungswache
    position: [21100, 4500]
    vehicles:
      - { id: base:rtw-3-83-1, callsign: Rettung Tannrode 3/83-1, type: base:rtw }
      - { id: beispiel:rtw-3-83-2, callsign: Rettung Tannrode 3/83-2, type: base:rtw }

settingsOverride:
  hilfsfrist: { minutes: 10, label: 10 Minuten in 95 % (Mod) }
```

## Was sich anpassen lässt

| Schlüssel            | Inhalt                                                       |
| -------------------- | ------------------------------------------------------------ |
| `vehicleTypes`       | Fahrzeugtypen (Transportklasse, Notarzt, Luftrettung, Rolle) |
| `stations`           | Wachen mit Fahrzeugen, Ausrückzeiten, Dienstzeiten, Reserve  |
| `hospitals`          | Kliniken mit Fachabteilungen und Aufnahmeplätzen             |
| `keywords`           | Stichworte mit AAO                                           |
| `diagnoses`          | Krankheitsbilder und Meldebilder                             |
| `fireScenarios`      | Feuerwehrlagen mit Kräftebedarf und Ausbreitung              |
| `mciScenarios`       | Großlagen mit Sichtungsanteilen                              |
| `transportOrders`    | Vorlagen für Krankentransporte                               |
| `weather`, `climate` | Wetterlagen und Klima je Monat                               |
| `worldEvents`        | Ereignisse (Volksfest, Baustelle …)                          |
| `holidays`           | Feiertage (z. B. für ein anderes Bundesland)                 |
| `scenarios`          | Trainingsszenarien                                           |
| `hilfsfristPresets`  | Hilfsfrist-Regeln mit Quelle                                 |
| `settingsOverride`   | einzelne Einstellungen                                       |
| `region`             | eine eigene Region (ersetzt den Landkreis Brakenfeld)        |

Die genauen Felder stehen im Schema [`packages/content/src/schema.ts`](../packages/content/src/schema.ts);
jede Zeile ist dort kommentiert.

## Editoren

- **Szenario-Editor** (Mods → Szenario-Editor): Name, Startzeit, Wetter, übriges Aufkommen, Ziel
  und geplante Notrufe (Rettungsdienst, Feuerwehr, Großlage, optional mit Ort). Speichert in den Mod
  `eigene-inhalte`; das Szenario erscheint danach im Startbildschirm.
- **Wachen-Editor** (Mods → Wachen-Editor): Wache wählen, Standort auf der Karte setzen,
  Fahrzeuge ergänzen. Speichert die geänderte Wache in `eigene-inhalte`.

## Lizenz

Inhalte der Basis stehen unter CC BY-SA 4.0 ([content/LICENSE.md](../content/LICENSE.md)). Wer
Basisinhalte in einem Mod abwandelt und weitergibt, gibt ihn unter derselben Lizenz weiter. Eigene
Inhalte dürfen keine fremden Marken, Logos oder Texte enthalten.
