# Einsätze, Anrufer und die „wahre Lage“

Daten: [`content/base/einsaetze.yaml`](../../content/base/einsaetze.yaml),
[`einstellungen.yaml`](../../content/base/einstellungen.yaml). Konzept: ADR-0014.

## Stichwortschema (eigenes Schema)

Die Stichwortkataloge in Deutschland unterscheiden sich je Land und je Leitstelle. Wir verwenden
deshalb ein **eigenes, bewusst schlankes Schema** und übernehmen keinen realen Katalog:

| Stichwort | Bedeutung                                            | AAO           |
| --------- | ---------------------------------------------------- | ------------- |
| RD 0      | Hilfeleistung, nicht zeitkritisch, ohne Sonderrechte | 1 RTW         |
| RD 1      | Notfall ohne erkennbare Notarzt-Indikation           | 1 RTW         |
| RD 2      | Notfall mit Notarzt-Indikation                       | 1 RTW + 1 NEF |
| RD 3      | Reanimation                                          | 2 RTW + 1 NEF |

## Vom Notruf zur wahren Lage

Jeder Notruf entsteht aus Bausteinen:

1. **Krankheitsbild** nach Häufigkeit (`weight`): z. B. häuslicher Sturz häufig, Reanimation selten.
2. **Einsatzort** nach Einwohnern gewichtet. Bei Einsätzen im Freien (Verkehrsunfall,
   Intoxikation) ist es teilweise ein Abschnitt einer Landstraße.
3. **Patient:** Alter aus dem typischen Bereich des Krankheitsbilds, Geschlecht, NACA-Schweregrad.
   Ob ein Notarzt nötig ist, wird zufällig nach `doctorNeeded` bestimmt. Ab NACA 5 ist er immer nötig.
4. **Anrufer:** Betroffener, Angehörige, Nachbarn, Passanten oder Pflegekräfte, je nach Situation.

Der Anrufer schildert ein **Meldebild**, das nicht immer zur Diagnose passt. Beim Schlaganfall
meldet er zum Beispiel oft „hängender Mundwinkel“, manchmal aber nur „verwirrt“. Außerdem gilt
(Annahmen, `settings.caller`):

| Effekt                                      | Wahrscheinlichkeit | Folge                                                                                      |
| ------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------ |
| Falsche Hausnummer (Nachbarhaus)            | 6 %                | Ab 150 m Abweichung findet die Besatzung niemanden → Rückruf, 1–2 Min. Verzug              |
| Ort nicht genannt                           | 12 %               | Straßenname kommt in mehreren Orten vor → Disponent muss nachfragen bzw. sorgfältig wählen |
| Fehleinschätzung (Panik oder Verharmlosung) | 20 %               | Ton des Anrufers täuscht über die Dringlichkeit                                            |

Die wahre Lage wird erst mit dem **Erstbefund** sichtbar, 1,5–3,5 Minuten nach Eintreffen. Dann
gilt Folgendes:

- **Notarzt nötig, aber nicht alarmiert:** Nachforderung per Sprechwunsch.
- **Notarzt alarmiert, aber nicht nötig:** Das NEF wird wieder frei.
- **Mehrere RTW, nur ein Patient:** Die überzähligen RTW werden frei.
- **Kein Patient angetroffen:** Alle Kräfte rücken ein.

## Notrufabfrage (seit 0.2.0)

Der Anrufer verrät nichts von selbst. Der Disponent stellt die Fragen der strukturierten Abfrage
(**Wo? Was? Wer? Bewusstsein? Atmung? Rückrufnummer?**), und jede Antwort kommt nach **3–8 Sekunden**.
Bei aufgeregten Anrufern dauert es 3 Sekunden länger. Die Zeit läuft in die Hilfsfrist ein: Wer alles
abfragt, verliert Zeit. Wer zu früh alarmiert, schickt vielleicht das falsche Stichwort oder
übersieht einen Fehlanruf.

- **Bewusstsein und Atmung** sind die stärksten Hinweise. „Reagiert nicht, atmet nicht“ heißt RD 3.
- Ein Disponent führt **immer nur ein Gespräch**. Weitere Notrufe klingeln, bis die Leitung frei
  ist, und legen nach 45–180 s auf.
- **Polizei-Übergaben (110):** ein Viertel der Einsätze im Freien. Alle Angaben sind bereits
  abgefragt und korrekt.

## Anrufarten (Anteile, Annahme)

| Art                          | Anteil   | Erkennbar an                                                                                | Richtig          |
| ---------------------------- | -------- | ------------------------------------------------------------------------------------------- | ---------------- |
| Hosentaschen- oder Fehlanruf | 6 %      | Stille, Rascheln, unterdrückte Nummer                                                       | Gespräch beenden |
| Scherzanruf                  | 3 %      | Kichern im Hintergrund, unterdrückte Nummer, dramatische Schilderung                        | Gespräch beenden |
| Auskunftsanruf               | 5 %      | Fragt nach Apotheke, Bereitschaftsdienst, Krankentransport                                  | Gespräch beenden |
| Weitere Meldung              | bis 12 % | Gleicher Ort wie ein laufender Einsatz; die Maske schlägt Einsätze im Umkreis von 600 m vor | „Zuordnen“       |

Wer einen Scherz- oder Fehlanruf alarmiert, schickt Kräfte ins Leere. Vor Ort ist niemand, das
bringt −10 Punkte. Eine doppelt angelegte Meldung löst einen zweiten Einsatz aus, die Kräfte
treffen auf die Kollegen. Das bringt −15 Punkte. Wird dagegen ein echter Notfall beendet oder einem
fremden Einsatz zugeordnet, ist das ein schwerer Fehler: Ein Patient bleibt ohne Hilfe.

## Behandlung, Transport, Übergabe

| Phase                | Dauer (Annahme)                                          | Daten                       |
| -------------------- | -------------------------------------------------------- | --------------------------- |
| Behandlung vor Ort   | je Krankheitsbild 5–55 Min.                              | `onSceneMinutes`            |
| Mit Notarzt          | frühestens 10 Min. nach seinem Eintreffen transportfähig | Kern                        |
| Zielklinik-Zuweisung | Besatzung entscheidet nach 3 Min. selbst (Fehler)        | `destinationTimeoutSeconds` |
| Übergabe RTW         | 15–25 Min. inkl. Dokumentation und Herrichten            | `handoverMinutes`           |
| Übergabe Notarzt     | 8–12 Min.                                                | Kern                        |

Bei schweren Fällen (NACA ≥ 4 mit Notarzt-Indikation) begleitet der Notarzt den Transport, das NEF
fährt hinterher. Sonst wird es nach der Übergabe an den RTW wieder frei.

## Notrufaufkommen

Das Aufkommen folgt einem Tagesprofil mit einem Minimum gegen 3–4 Uhr und einem Maximum am späten
Vormittag. Annahme für die Spielbalance: **2,4 Notrufe je 100.000 Einwohner und Stunde**, etwa das
Doppelte eines realen Mittelwerts. Sonst bestünde eine Schicht größtenteils aus Warten. Ab M12 lässt
sich das über Schwierigkeitsgrade einstellen.
