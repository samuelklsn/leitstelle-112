# Der fiktive Landkreis Brakenfeld

Daten: [`content/base/region-brakenfeld.yaml`](../../content/base/region-brakenfeld.yaml),
Generator: `packages/sim/src/world/generator.ts`.

Alle Namen sind frei erfunden. Ähnlichkeiten mit realen Orten sind zufällig.

## Aufbau

- 26 × 20 km, rund 74.000 Einwohner in 7 Orten. Kreisstadt ist Brakenfeld mit 41.200 Einwohnern.
- Die Autobahn A 97 im Süden hat drei Anschlussstellen. Dazu kommen Bundes-, Landes- und
  Kreisstraßen.
- Der Fluss **Brake** teilt den Kreis. Brücken gibt es nur an den Hauptachsen und an jeder n-ten
  Querstraße. Das erzeugt glaubwürdige Umwege.
- Wälder dienen als Orientierung auf der Karte.

## Wie die Welt entsteht

Aus der Konfiguration erzeugt der Generator **deterministisch**: gleicher Seed, gleiche Welt auf
jedem Rechner.

1. **Ortsnetze:** gedrehte, leicht verrauschte Raster mit unregelmäßigem Rand. Die beiden Mittelachsen
   sind Hauptstraßen, etwa 7 % der Nebenstraßenstücke entfallen.
2. **Straßennamen** aus einer Liste gebräuchlicher Gattungsnamen. Die Hausnummern folgen alle 28 m,
   ungerade links und gerade rechts.
3. **Überörtliche Straßen** verbinden Ortsränder, mit leichter Krümmung.
4. Nur das größte zusammenhängende Netz bleibt erhalten, abgeschnittene Reste fallen weg.

Ergebnis: rund 1.300 Kreuzungen, 2.000 Straßenstücke, 15.000 Hausadressen und
10 Landstraßenabschnitte als Einsatzorte im Freien.

## Vorhaltung

| Standort                         | Fahrzeuge              |
| -------------------------------- | ---------------------- |
| Rettungswache Brakenfeld         | RTW 1/83-1, RTW 1/83-2 |
| Notarztstandort Kreisklinikum    | NEF 1/82-1             |
| Rettungswache Ellerbach          | RTW 2/83-1, RTW 2/83-2 |
| Notarztstandort Klinik Ellerbach | NEF 2/82-1             |
| Rettungswache Tannrode           | RTW 3/83-1             |

| Krankenhaus              | Versorgungsstufe | Fachabteilungen                                                                                             |
| ------------------------ | ---------------- | ----------------------------------------------------------------------------------------------------------- |
| Kreisklinikum Brakenfeld | Schwerpunkt      | Innere, Chirurgie, Unfallchirurgie, Neurologie, Stroke Unit, Herzkatheter, Pädiatrie, Gynäkologie, Intensiv |
| Klinik Ellerbach         | Grundversorgung  | Innere, Chirurgie, Psychiatrie                                                                              |

**Bewusste Schwäche:** Oberwiesel im Nordosten liegt 10–11 Minuten Fahrzeit von der nächsten Wache
entfernt. Damit ist die Hilfsfrist dort kaum einzuhalten, wie in vielen echten Flächenkreisen. Die
Gebietsabsicherung, also das Umsetzen freier Fahrzeuge, kommt mit M6.
