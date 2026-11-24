# ADR-0016: Welt-Dynamik – Wetter, Kalender, Ereignisse, Regie, Luftrettung

- Status: Angenommen
- Datum: 2026-11-24

## Kontext

ADR-0014 verlangt ein Spiel, das sich nicht durchspielen lässt: Jede Schicht soll anders sein.
Bis 0.4.0 unterscheiden sich Schichten nur durch Zufall im Einsatzmix. Die Welt selbst ändert sich
nicht: kein Wetter, keine Jahreszeit, keine Feiertage, kein Volksfest, keine Baustelle. Meilenstein
M8 (Issues #33, #46–#49) soll das ändern, ohne den deterministischen Kern (ADR-0004) aufzugeben.

## Entscheidung

1. **Weltzustand im Sim-Kern.** `SimState.world` enthält Wetterlage, Temperatur, laufende
   Ereignisse und die Phase der Einsatz-Regie. Alles entsteht aus dem eigenen Zufalls-Stream
   `world` und geplanten Ereignissen. Das Snapshot-Format steigt auf Version 4.
2. **Wetter aus Klimadaten.** Je Monat gibt es Gewichte der Wetterlagen und einen
   Temperaturbereich. Eine Wetterlage hält einige Stunden und bleibt mit einer gewissen
   Wahrscheinlichkeit bestehen. Jede Lage wirkt über **Faktoren**: auf die Fahrgeschwindigkeit
   (Routing-Kontext), das Notrufaufkommen, einzelne Krankheitsbilder und Feuerwehrlagen sowie die
   Flugtauglichkeit für Hubschrauber.
3. **Ereignisse der Weltlage** sind Daten: festes Datum (Silvester) oder zufällig in passenden
   Monaten und an passenden Wochentagen (Volksfest, Grippewelle, Baustelle). Sie wirken über
   dieselben Faktoren. Optional binden sie Notrufe an einen Ort oder sperren einen Straßenabschnitt.
4. **Sperrungen im Router.** Gesperrte Kanten werden um einen festen Faktor langsamer. Der
   Router leitet damit um, Einsatzfahrzeuge kommen im Notfall aber noch durch. Sperrungen sind
   abgeleiteter Zustand und werden nach dem Laden aus dem Weltzustand wiederhergestellt.
5. **Kalender:** Gesetzliche Feiertage (fest oder relativ zu Ostern) zählen wie Sonntage für
   Verkehr, Aufkommen und Vorhaltung. Wochentage bekommen einen eigenen Faktor.
6. **Sommerzeit (#33):** Die Spielzeit bleibt durchgehende **Normalzeit (MEZ)**. Erst die
   Umrechnung in die Uhrzeit berücksichtigt die Sommerzeit. So läuft der Kern ohne Sprünge.
   Die Umstellungsnächte haben 23 bzw. 25 Stunden, die Uhr springt wie in der Realität.
7. **Einsatz-Regie:** Das Aufkommen wandert in Phasen von 30–90 Minuten linear zu einem neuen
   Faktor innerhalb von ± 25 % der Basisrate. Ruhe und Spitzen wechseln sich ab. Die Regie erfindet
   keine Einsätze und verändert keine Physik.
8. **Luftrettung:** Fahrzeugtypen mit `air` fliegen Luftlinie mit Reisegeschwindigkeit, Start-
   und Landezeit. Sie sind nur bei Tageslicht laut Monatstabelle und bei Flugwetter verfügbar und
   werden zeitweise für Einsätze außerhalb des Bereichs gebraucht. Die AAO kann den RTH als
   Alternative zum NEF vorschlagen. Bodengebundene RTW transportieren vorrangig.
9. **Startdatum wählbar:** Neben „heute“ kann ein Winter-, Sommer- oder Silvesterbeginn gewählt
   werden. Das bleibt Sache des Sim-Hosts, der Kern bekommt nur eine Startzeit.

## Konsequenzen

- Jede Schicht hat ein eigenes Gepräge, abhängig von Datum, Wetter und Lage. Der Einsatzmix
  verschiebt sich dabei glaubwürdig, nicht willkürlich.
- Alle Faktoren sind Annahmen und in `docs/domain/welt.md` beschrieben. Mods können eigene
  Wetterlagen, Ereignisse, Feiertage (andere Bundesländer) und Klimadaten mitbringen.
- Spielstände aus 0.4.0 lassen sich nicht laden (Snapshot-Version 4).
- Intensivtransporthubschrauber (ITH) und Nachtflugfähigkeit sind vorbereitet, aber noch nicht
  umgesetzt.
