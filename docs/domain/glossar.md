# Glossar

| Begriff           | Bedeutung                                                                                            | Im Code               |
| ----------------- | ---------------------------------------------------------------------------------------------------- | --------------------- |
| AAO               | Alarm- und Ausrückeordnung: welche Fahrzeuge zu welchem Stichwort alarmiert werden                   | `Keyword.aao`         |
| Ausrückzeit       | Zeit von der Alarmierung bis zum Losfahren (Status 3)                                                | `turnout`             |
| Disponent/in      | Fachkraft in der Leitstelle, die Notrufe annimmt und Einsätze führt                                  | –                     |
| Einsatz           | Ein Ereignis, zu dem Kräfte alarmiert werden                                                         | `incident`            |
| Erstbefund        | Erste Rückmeldung der Einsatzkräfte vor Ort                                                          | `assessed`, `finding` |
| FMS               | Funkmeldesystem: Statusmeldungen 0–9 der Fahrzeuge                                                   | `FmsStatus`           |
| Hilfsfrist        | Zeit vom Notrufeingang bis zum Eintreffen des ersten Rettungsmittels                                 | `hilfsfrist`          |
| ILS               | Integrierte Leitstelle für Rettungsdienst und Feuerwehr                                              | –                     |
| KTW               | Krankentransportwagen (ab M7)                                                                        | –                     |
| Meldebild         | Was der Anrufer schildert (nicht unbedingt die wahre Lage)                                           | `reportKey`           |
| NACA              | Schweregrad-Skala 0–7 (vom Notarzt erhoben). Ab 4 akute Lebensgefahr nicht ausgeschlossen, 7 tödlich | `naca`                |
| NEF               | Notarzteinsatzfahrzeug: bringt den Notarzt zum Einsatzort (Rendezvous-System)                        | `base:nef`            |
| Rendezvous-System | Notarzt und RTW fahren getrennt und treffen sich am Einsatzort                                       | –                     |
| RTW               | Rettungswagen: Notfallversorgung und Transport                                                       | `base:rtw`            |
| Sonderrechte      | Fahrt mit Blaulicht und Martinshorn (§ 35 und § 38 StVO)                                             | `emergency`           |
| Sprechwunsch      | Status 5: Das Fahrzeug möchte die Leitstelle sprechen                                                | `requestDestination`  |
| Stichwort         | Einsatzkategorie, die die AAO auslöst (z. B. „RD 2“)                                                 | `Keyword`             |
| Tracer-Diagnose   | Zeitkritische Leitdiagnose mit Zeitfenster (Schlaganfall, ACS, Polytrauma, Reanimation)              | `tracer`              |
| Wahre Lage        | Die tatsächliche Situation hinter einem Notruf, zunächst verborgen                                   | `Truth`               |
| Zielklinik        | Krankenhaus, das den Patienten aufnimmt                                                              | `hospitalId`          |

## FMS-Status im Spiel

| Status | Bedeutung                       | Aufgabe im Kern                           |
| ------ | ------------------------------- | ----------------------------------------- |
| 1      | Einsatzbereit über Funk         | `returning`, auch `turnout` aus der Fahrt |
| 2      | Einsatzbereit auf Wache         | `idle`                                    |
| 3      | Einsatz übernommen / Anfahrt    | `toScene`                                 |
| 4      | Am Einsatzort                   | `onScene`                                 |
| 5      | Sprechwunsch                    | `awaitDestination`                        |
| 6      | Nicht einsatzbereit             | ab M7 (Defekt, Desinfektion)              |
| 7      | Patient aufgenommen / Transport | `toHospital`                              |
| 8      | Am Transportziel                | `handover`                                |
