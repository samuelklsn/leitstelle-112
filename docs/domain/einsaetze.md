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
