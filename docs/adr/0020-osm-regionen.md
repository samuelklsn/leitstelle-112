# ADR-0020: Echte Regionen aus OpenStreetMap

- Status: Angenommen
- Datum: 2026-11-25

## Kontext

Der fiktive Landkreis Brakenfeld entsteht prozedural aus wenigen Eckdaten. Spieler wünschen sich
ihren eigenen Landkreis. ADR-0006 sieht dafür einen Region-Builder vor, der OpenStreetMap-Daten
in ein Regionspaket umwandelt. Meilenstein M13 (Issues #58, #12) setzt das um. Rahmen: keine
Netzwerkzugriffe zur Laufzeit (CLAUDE.md, Regel 6), nur Daten mit geprüfter Lizenz (Regel 2).

## Entscheidung

1. **Regionspaket als Mod.** Der Region-Builder (`tools/region-builder`) erzeugt aus OSM-XML einen
   Mod: Region mit fertigem Straßennetz und Adressen (`region.prebuilt`), dazu Wachen, Kliniken
   und Krankentransport-Vorlagen aus den OSM-Einrichtungen. Der Mod ersetzt die Wachen, Kliniken,
   Aufträge und Szenarien der Basis (`mod.replaces`); Stichworte, Krankheitsbilder, Fahrzeuge,
   Wetter und Großlagen bleiben.
2. **Kompaktes Tupelformat** für Knoten, Straßenstücke und Adressen – echte Landkreise haben
   Zehntausende Einträge. Der Sim-Kern setzt die Welt nur zusammen (`world/prebuilt.ts`); alle
   Geometrie und Projektion passiert zur Build-Zeit.
3. **OSM-XML als Eingabe.** Der Builder liest XML ohne Fremdbibliothek. PBF-Dateien wandelt der
   Spieler vorher mit Osmium um; ein PBF-Parser wäre eine neue Abhängigkeit mit Tragweite.
4. **Fehlende Daten werden ergänzt, nicht erfunden:** Ohne Hausnummern in OSM setzt der Builder
   Nummern entlang der Wohnstraßen; ohne Klinik oder Rettungswache legt er je eine im größten Ort
   an. Einwohnerzahlen kommen aus `population`, sonst aus Vorgaben je Ortstyp.
5. **Lizenz:** OSM-Daten stehen unter ODbL 1.0. Die Namensnennung steht in der Region und auf der
   Karte. Erzeugte Regionspakete werden nicht mit dem Spiel ausgeliefert; Spieler erzeugen sie
   selbst aus ihrem Auszug.
6. **Kacheln:** vorerst nicht nötig (ADR-0006, Nachtrag M13): Das Netz wird wie beim fiktiven
   Landkreis als GeoJSON gezeichnet.

## Konsequenzen

- Jeder kann seinen Landkreis spielen, offline, ohne dass das Spiel OSM-Daten mitbringt.
- Wachen, Fahrzeuge, Kliniken und Abteilungen aus OSM sind nur ein Ausgangspunkt; der
  Wachen-Editor oder eigene Mod-Dateien verfeinern sie.
- Sehr große Regionen (ganze Bundesländer) sprengen das GeoJSON-Rendering; dafür käme der
  PMTiles-Schritt.
- Ohne Knotenvereinfachung bleiben alle OSM-Stützpunkte im Graph – genaue Geometrie, aber mehr
  Rechenzeit beim Routing. Eine Vereinfachung ist eine spätere Optimierung.
