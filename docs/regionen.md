# Eigene Region aus OpenStreetMap

Leitstelle 112 spielt im fiktiven Landkreis Brakenfeld. Mit dem Region-Builder lässt sich daraus
ein echter Landkreis machen – aus OpenStreetMap-Daten, offline und ohne dass das Spiel diese Daten
selbst mitbringt ([ADR-0020](adr/0020-osm-regionen.md)).

## 1. OSM-Auszug besorgen

- Kleine Gebiete: in [JOSM](https://josm.openstreetmap.de/) oder über die Overpass-API laden und als
  `.osm` speichern.
- Landkreise: PBF-Auszug des Bundeslands (z. B. von Geofabrik) herunterladen und mit
  [Osmium](https://osmcode.org/osmium-tool/) auf den Kreis zuschneiden und umwandeln:

  ```powershell
  osmium extract -b 9.1,50.8,9.6,51.1 bundesland.osm.pbf -o kreis.osm.pbf
  ```

  ```powershell
  osmium cat kreis.osm.pbf -o kreis.osm
  ```

Benötigt werden Straßen (`highway=*`), Orte (`place=city|town|village|hamlet`), möglichst
Hausnummern (`addr:street`, `addr:housenumber`), Kliniken (`amenity=hospital`), Feuerwachen
(`amenity=fire_station`) und Rettungswachen (`emergency=ambulance_station`). Wald (`landuse=forest`)
und Flüsse (`waterway=river`) erscheinen auf der Karte.

## 2. Region-Mod erzeugen

```powershell
pnpm --filter @ls112/region-builder region -- --input kreis.osm --id mein-kreis --name "Landkreis Musterstadt" --out "$env:APPDATA\Leitstelle112\mods\mein-kreis"
```

Der Builder schreibt einen Mod mit drei Dateien:

| Datei                | Inhalt                                                       |
| -------------------- | ------------------------------------------------------------ |
| `mod.json`           | Steckbrief; ersetzt Wachen, Kliniken, Aufträge und Szenarien |
| `region.json`        | Orte, Straßennetz, Adressen, Wald, Fluss, Namensnennung      |
| `einrichtungen.json` | Wachen mit Fahrzeugen, Kliniken, Krankentransport-Vorlagen   |

## 3. Spielen und verfeinern

Beim nächsten Start lädt das Spiel den Mod (Menü **Mods** zeigt, ob er fehlerfrei ist). Ein neues
Spiel beginnt in der echten Region.

Was OSM nicht weiß, setzt der Builder mit Vorgaben:

- **Fahrzeuge:** je Rettungswache zwei RTW und ein KTW (7–19 Uhr), ein NEF an der ersten Klinik,
  je Feuerwache HLF und LF bzw. bei einer Feuerwache mit Berufsfeuerwehr HLF, ELW und DLK.
  Freiwillige Feuerwehren bekommen die längere Ausrückzeit.
- **Kliniken:** Die erste Klinik ist Schwerpunktversorger mit allen Abteilungen, weitere sind
  Grundversorger. Abteilungen und Aufnahmeplätze stimmen damit nicht mit der Wirklichkeit
  überein – bitte im Wachen-Editor bzw. in `einrichtungen.json` anpassen.
- **Hausnummern:** Fehlen sie in OSM, setzt der Builder Nummern entlang der Wohnstraßen.
- **Einwohner:** aus `population`, sonst 60.000 (Stadt), 12.000 (Kleinstadt), 1.200 (Dorf) bzw.
  150 (Weiler).

## Lizenz

OpenStreetMap-Daten stehen unter der [ODbL 1.0](https://opendatacommons.org/licenses/odbl/).
Das Regionspaket nennt die Quelle („© OpenStreetMap-Mitwirkende“), die Karte zeigt sie unten
rechts. Wer ein Regionspaket weitergibt, gibt es ebenfalls unter der ODbL weiter.
