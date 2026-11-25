# ADR-0006: Offline-Karte und Regionspakete

- Status: Angenommen
- Datum: 2026-11-24

## Kontext

Karte und Routing müssen vollständig offline funktionieren. Der Vertical Slice nutzt einen
fiktiven Landkreis; später kommen echte Regionen aus OSM-Daten (ODbL) hinzu.

## Entscheidung

- **Regionspaket** als Ordner mit: `region.yaml` (Metadaten, Lizenz, Attribution, Grenzen),
  Vektorkacheln, Routinggraph (binär, ADR-0007), Adressindex, Wachen, Krankenhäuser.
- **Kartendarstellung:** MapLibre GL JS mit eigenem Stil, eigenen Sprites und Glyphen aus
  einer freien Schrift. Kacheln über ein eigenes Electron-Protokoll; die CSP blockiert jedes
  Netzwerk.
- **Kachelformat:** MBTiles oder PMTiles – ein Spike in M2 entscheidet (Kriterien:
  Schreibbarkeit aus unserem TS-Builder, Lesegeschwindigkeit, Tooling für die OSM-Pipeline).
  Das Ergebnis kommt als Nachtrag in dieses ADR.
- **Fiktive Region:** `tools/region-builder` erzeugt aus einer handgepflegten Konfiguration
  (Orte, Hauptachsen, Fluss, Brücken, Seed) Straßennetz, Flächen, Straßennamen und
  Hausnummern. Die erzeugten Daten verwenden OSM-kompatible Tags, damit echte Regionen
  später dieselbe Pipeline nutzen.
- **Attribution:** Pakete mit OSM-Daten tragen „© OpenStreetMap-Mitwirkende (ODbL)" in den
  Metadaten; das UI zeigt die Attribution dann dauerhaft auf der Karte. Fiktive Regionen sind
  Eigenwerk.

## Alternativen

- Online-Kacheln: verstößt gegen die Offline-Anforderung.
- Rasterkacheln: groß, nicht stylebar, schlecht bei DPI-Skalierung.
- Fiktive Region von Hand zeichnen: zu aufwendig für ein realistisches Straßennetz.

## Konsequenzen

Der eigene Builder ist ein nennenswertes Arbeitspaket (M2), zahlt sich aber für den
Regionen-Editor und echte Regionen aus.

## Nachtrag 2026-11-24 (M2)

Für die **fiktive Region** braucht es vorerst keine Vektorkacheln: Der Weltgenerator erzeugt
Straßen, Flächen und Gewässer beim Start in unter einer Sekunde, und MapLibre zeigt sie direkt als
GeoJSON-Quellen (ca. 2.000 Straßenstücke). Das spart ein Build-Werkzeug und generierte Binärdateien
im Repository. Der Kachel-Spike (MBTiles/PMTiles, #12) wird mit der OSM-Pipeline (M13) fällig,
wenn echte Regionen deutlich größer werden.

Beschriftungen kommen als HTML-Marker statt als Kartensymbole – damit entfallen eingebettete
Glyphen (Schriftdateien) vorerst ganz. Der Karten-Worker von MapLibre wird als lokales Asset
ausgeliefert (`setWorkerUrl`), die CSP erlaubt nur `self` und `blob:`.

## Nachtrag 2026-11-24 (M13, Spike #12: MBTiles oder PMTiles)

**Entscheidung: PMTiles, sobald Kacheln nötig werden – vorerst weiter GeoJSON.**

- **PMTiles** ist eine einzelne Datei, die MapLibre über HTTP-Range-Anfragen direkt liest; ein
  Kachelserver entfällt. Offline genügt es, die Datei mit der App auszuliefern und über das
  eigene `app://`-Schema mit Range-Unterstützung bereitzustellen ([Protomaps-Doku][pm],
  [MapLibre][ml]).
- **MBTiles** ist eine SQLite-Datenbank. Ein Browser kann sie nicht direkt lesen; es bräuchte
  einen Kachelserver im Main-Prozess. Für native Apps ist das etabliert, für uns aber ein
  zusätzlicher Dienst ohne Vorteil ([Protomaps-FAQ][faq]).
- Beide Formate lassen sich ineinander umwandeln (`pmtiles convert`), die Entscheidung ist also
  umkehrbar.
- Die importierten OSM-Regionen der Pipeline (M13) sind Landkreise mit einigen Tausend
  Straßenstücken. Das bleibt als GeoJSON aus dem Regionspaket schnell genug – gemessen
  (`tools/region-builder/src/region.perf.ts`): 43.838 OSM-Knoten werden zu 4.382 Graphknoten,
  Import 0,3 s, Spielstart 2,4 s, Tick unter 0,01 ms. Kacheln werden erst bei Regionen nötig, die deutlich größer als ein
  Landkreis sind; dann kommt ein PMTiles-Schritt in den Region-Builder.

[pm]: https://docs.protomaps.com/pmtiles/
[ml]: https://docs.protomaps.com/pmtiles/maplibre
[faq]: https://protomaps.com/faq
