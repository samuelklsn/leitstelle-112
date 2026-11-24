# Fahrzeitmodell

Code: `packages/routing/src/travel-model.ts` (ADR-0007). Alle Werte sind **Annahmen** für ein
glaubwürdiges Spielgefühl. Sie sind keine Messwerte und ab M8 als Inhalte konfigurierbar.

## Grundgeschwindigkeit ohne Sonderrechte

Gemeint sind Reisegeschwindigkeiten inklusive Kreuzungen, Kurven und Ortsdurchfahrten, nicht die
zulässige Höchstgeschwindigkeit.

| Straßenklasse             | km/h | Verkehrsempfindlichkeit | Faktor Sonderrechte |
| ------------------------- | ---- | ----------------------- | ------------------- |
| Autobahn                  | 110  | 0,6                     | 1,08                |
| Bundesstraße              | 80   | 0,6                     | 1,20                |
| Landesstraße              | 72   | 0,4                     | 1,22                |
| Kreisstraße               | 62   | 0,3                     | 1,22                |
| Innerörtliche Hauptstraße | 38   | 1,0                     | 1,45                |
| Wohnstraße                | 26   | 0,5                     | 1,35                |

**Begründung Sonderrechte:** Der größte Zeitgewinn entsteht innerorts, wo der Rettungsdienst
Ampeln, Vorfahrt und Kolonnen überwinden darf. Auf der Autobahn ist der Gewinn klein, denn auch mit
Blaulicht wird selten deutlich schneller gefahren als der Verkehrsfluss.

## Verkehr

Ein Stundenprofil für Werktage (Berufsverkehr 7–9 Uhr und 16–18 Uhr) und eines für Wochenenden.
Der Faktor wirkt je nach Verkehrsempfindlichkeit der Straßenklasse. Mit Sonderrechten bleibt nur die
Hälfte des Verkehrseinflusses wirksam (`emergencyTrafficShare`).

Beispiel innerörtliche Hauptstraße: nachts 40 km/h, im Berufsverkehr 29 km/h. Mit Sonderrechten
sind es rund 58 bzw. 49 km/h.

## Routing

- Schnellste Route per Dijkstra auf einem gerichteten Straßengraphen (Einbahnstraßen möglich).
- **Fahrzeugvorschlag:** Ein einziger Rückwärts-Dijkstra vom Einsatzort liefert die Anfahrtszeit
  aller Fahrzeuge, auch der gerade fahrenden.
- Wird ein fahrendes Fahrzeug umdisponiert, fährt es bis zur nächsten Kreuzung weiter und biegt dort
  ab. Es wendet nicht auf der Stelle.

## Ausrückzeiten (Alarm bis Status 3)

| Situation                              | Sekunden (Annahme) |
| -------------------------------------- | ------------------ |
| Wache, tagsüber                        | 50–90              |
| Wache, nachts (22–6 Uhr)               | 90–150             |
| Bereits frei auf der Straße (Status 1) | 10–25              |
