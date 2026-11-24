# Auswertung, Outcome und Punkte

Code: `packages/sim/src/systems/outcome.ts`, Punktwerte in `systems/calls.ts` (`ERROR_PENALTY`).
Das Modell ist **bewusst einfach** und belohnt, was auch in der Realität zählt: schnelle Hilfe,
der richtige Notarzt-Einsatz und die geeignete Zielklinik.

## Hilfsfrist

- Gemessen vom **Eingang des Notrufs** bis zum Eintreffen des ersten Rettungsmittels (Status 4) am
  richtigen Ort.
- Gezählt werden Notfälle mit Patient, also keine Fehlalarme.
- Preset des Slice: **12 Minuten in 95 % der Fälle**, gekennzeichnet als Annahme. Die
  Landesregelungen unterscheiden sich in Dauer, Messbeginn und Quote. Presets je Bundesland mit
  Quellenangabe folgen (#32).

## Patientenoutcome

| Fall                                 | Modell (Annahme)                                                                                                                         |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Herz-Kreislauf-Stillstand            | Überlebenschance 45 %, minus ca. 7 Prozentpunkte je Minute ab der 4. Minute bis zum Eintreffen; Abzug bei spätem Notarzt; mindestens 2 % |
| ACS / Schlaganfall / schweres Trauma | „gut“, wenn die passende Fachabteilung innerhalb des Zeitfensters (120 / 90 / 60 Min. ab Notruf) erreicht wird; sonst Folgeschäden       |
| Übrige                               | Folgeschäden bei Eintreffen später als die doppelte Hilfsfrist, bei fehlendem Notarzt trotz NACA ≥ 4 oder bei ungeeigneter Klinik        |

## Dispositionsfehler

| Fehler                      | Wann                                                            | Punkte |
| --------------------------- | --------------------------------------------------------------- | ------ |
| Anrufer aufgelegt           | Notruf nicht innerhalb von 45–180 s angenommen                  | −30    |
| Notruf ohne Einsatz beendet | obwohl ein Notfall vorlag                                       | −60    |
| Stichwort zu niedrig        | passendes Stichwort hätte einen Notarzt vorgesehen              | −25    |
| Notarzt ohne Indikation     | Notarzt alarmiert, Stichwort und Befund rechtfertigen ihn nicht | −5     |
| Falscher Einsatzort         | gewählte Adresse > 150 m vom echten Ort                         | −20    |
| Nicht das nächste Fahrzeug  | ein gleichartiges Fahrzeug wäre ≥ 3 Min. schneller gewesen      | −15    |
| Alarmierung verzögert       | > 2 Min. zwischen Einsatzanlage und Alarm                       | −10    |
| Notarzt verspätet alarmiert | > 3 Min. nach Bedarf, obwohl ein Notarzt frei war               | −15    |
| Ungeeignete Zielklinik      | Fachabteilung fehlt                                             | −25    |
| Zielklinik nicht zugewiesen | Besatzung musste selbst entscheiden                             | −10    |

**Fairness:** Bewertet wird nur, was der Disponent erkennen und beeinflussen konnte. Ein Notarzt,
der erst vor Ort nötig wird, ist kein Stichwortfehler. Ist kein Notarzt frei, ist das ein
Strukturproblem des Bereichs und kein Fehler.

## Punkte je Einsatz

| Outcome                  | Punkte                                              |
| ------------------------ | --------------------------------------------------- |
| gut versorgt             | +100                                                |
| mit Folgeschäden         | +40                                                 |
| verstorben               | 0 (−30, wenn kein Herz-Kreislauf-Stillstand vorlag) |
| kein Patient             | +20                                                 |
| Hilfsfrist überschritten | −20                                                 |

## Balance-Check

Ein automatischer „Bot-Disponent“ ohne Fehler erreicht in Testläufen über 12 Stunden **80–93 %
Hilfsfrist** bei rund 30 Einsätzen und 6–7 Minuten mittlerer Eintreffzeit. Die Lücke zu 95 % ist
gewollt: Die abgelegenen Orte Oberwiesel und Hagenried zeigen die Grenzen der Vorhaltung.
