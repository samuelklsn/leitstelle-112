# Welt-Dynamik (seit 0.5.0)

Daten: [`content/base/welt.yaml`](../../content/base/welt.yaml) und
[`content/base/einstellungen.yaml`](../../content/base/einstellungen.yaml) (`weather`, `director`,
`daylight`, `air`, `calls.weekdayFactor`). Entscheidung: [ADR-0016](../adr/0016-welt-dynamik.md).
Alle Faktoren sind **Annahmen** für ein glaubwürdiges Spiel. Sie sind keine statistischen
Auswertungen eines realen Rettungsdienstbereichs.

Grundsatz: Die Welt verschiebt **Raten und Gewichte**. Sie erfindet keine Einsätze, die es sonst
nicht gäbe, und ändert keine Physik.

## Wetter

Die Wetterlage hält 3–8 Stunden. Beim Wechsel bleibt sie mit 40 % gleich, sonst wird sie nach dem
Klima des Monats neu gewählt. Die Temperatur passt zur Lage: Hitze erst ab 30 °C, Schnee und Glätte
höchstens bei 1 °C.

| Wetterlage | Fahrzeit | Aufkommen | Hubschrauber | Einsatzmix (Faktor)                               |
| ---------- | -------- | --------- | ------------ | ------------------------------------------------- |
| Klar       | normal   | normal    | fliegt       | –                                                 |
| Bewölkt    | normal   | normal    | fliegt       | –                                                 |
| Regen      | +9 %     | +4 %      | fliegt       | Verkehrsunfall ×1,3                               |
| Gewitter   | +18 %    | +12 %     | **am Boden** | Baum auf Fahrbahn ×8, Dachstuhlbrand ×1,6         |
| Nebel      | +22 %    | +3 %      | **am Boden** | Verkehrsunfall ×1,6                               |
| Schneefall | +39 %    | +8 %      | **am Boden** | Sturz ×1,6, Verkehrsunfall ×1,8, Eingeklemmt ×1,8 |
| Glätte     | +67 %    | +25 %     | fliegt       | Sturz ×2,6, Verkehrsunfall ×2,2                   |
| Hitze      | normal   | +15 %     | fliegt       | Exsikkose ×6, Atemnot ×1,3, Flächenbrand ×12      |

Die Fahrzeit-Aufschläge ergeben sich aus dem Geschwindigkeitsfaktor (z. B. 0,6 bei Glätte). Sie
gelten für alle Straßenklassen und auch mit Sonderrechten. Wie oft welche Lage vorkommt, steht
je Monat in `climate`. Glätte und Schnee gibt es von November bis März, Hitze von Juni bis August.

## Kalender

- **Wochentage:** Freitag ×1,04, Samstag ×1,1, Sonntag ×1,04, Dienstag und Mittwoch ×0,96
  (Annahme: mehr Freizeitunfälle und Alkohol am Wochenende).
- **Feiertage** (Neujahr, Karfreitag, Ostermontag, 1. Mai, Himmelfahrt, Pfingstmontag,
  Fronleichnam, 3. Oktober, Weihnachten) zählen wie ein **Sonntag**: Verkehr wie am Wochenende,
  werktags besetzte KTW bleiben auf der Wache, Krankentransporte ×0,35. Ostern wird ohne
  Systemkalender rein rechnerisch bestimmt (Algorithmus nach Meeus/Jones/Butcher).
- **Sommerzeit:** Die Uhr springt am letzten Sonntag im März von 2 auf 3 Uhr und läuft am letzten
  Sonntag im Oktober die Stunde von 2 bis 3 Uhr zweimal. Die Nachtschicht ist dann 11 bzw.
  13 Stunden lang – wie in einer echten Leitstelle.

## Ereignisse der Weltlage

| Ereignis                 | Wann                              | Wirkung                                                       |
| ------------------------ | --------------------------------- | ------------------------------------------------------------- |
| Silvester                | 31.12., 18 Uhr, 12 Stunden        | Aufkommen ×1,9, Feuerwerksverletzungen, Container-/PKW-Brände |
| Volksfest                | Mai–Sept., Fr–So, 12 % je Tag     | in einem Ort ab 3.000 Einw.: 35 % der Notrufe, Alkohol ×4     |
| Weihnachtsmarkt          | Dezember, Fr–So, 30 % je Tag      | Ort ab 9.000 Einw.: 25 % der Notrufe, Alkohol ×2,5, Sturz     |
| Grippewelle              | Dez.–März, 3 % je Tag, 10–20 Tage | Aufkommen ×1,12, Atemnot ×1,7                                 |
| Baustelle (Vollsperrung) | 25 % je Tag, 1–7 Tage             | Straßenabschnitt gesperrt, Umleitung                          |
| Veranstaltungssperrung   | April–Sept., Sa/So, 20 % je Tag   | Straßenabschnitt für einige Stunden gesperrt                  |

Laufende Ereignisse zeigt die Kopfzeile, Beginn und Ende stehen im Funkprotokoll. Gesperrte
Abschnitte markiert die Karte mit ⛔. Der Router macht sie 15-mal langsamer: Fahrzeuge fahren
in aller Regel einen Umweg, im Notfall kommen sie mit Absprache aber noch durch.

## Einsatz-Regie

Das Aufkommen wandert in Phasen von 30–90 Minuten linear zu einem neuen Faktor zwischen 0,75 und
1,25. So wechseln ruhige Abschnitte und Häufungen, wie sie Disponenten aus der Praxis kennen. Die
Regie wirkt nur auf die Rate, nie auf einzelne Einsätze (ADR-0014, Punkt 8).

## Luftrettung

Der Rettungshubschrauber **RTH 1/10-1** steht an der Luftrettungsstation Hohenwarte am
nordöstlichen Kreisrand und bringt einen Notarzt mit.

- **Flug:** Luftlinie mit 220 km/h, Start 2–4 Minuten, Landung 2–3 Minuten. Staus und Glätte
  spielen keine Rolle – dafür Wetter und Licht.
- **Verfügbar** nur bei Tageslicht laut Monatstabelle (z. B. Dezember 8–16 Uhr, Juni 5–21 Uhr)
  und bei Flugwetter. Bei Nebel, Gewitter und Schneefall bleibt er am Boden (Status 6).
- **Einsätze außerhalb:** Zu jeder vollen Stunde ist er mit 12 % für 45–90 Minuten im
  Nachbarbereich gebunden.
- Die AAO schlägt den RTH als **Alternative zum NEF** vor, wenn er schneller am Einsatzort ist.
- Transportiert wird vorrangig mit dem RTW. Der RTH transportiert nur, wenn kein RTW vor Ort ist.
  Bei schweren Fällen fliegt sein Notarzt zur Zielklinik nach.

## Spielbeginn

Im Startbildschirm lässt sich der Beginn des freien Spiels wählen:

- **Heute:** Wetter und Kalender wie draußen.
- **Winter:** 20. Januar, Glätte, Schnee, Grippewelle möglich.
- **Sommer:** 18. Juli, Hitze, Gewitter, Volksfeste.
- **Silvesternacht:** 31. Dezember, 19 Uhr.
