# Feuerwehr (seit 0.3.0)

Daten: [`content/base/feuerwehr.yaml`](../../content/base/feuerwehr.yaml). Alle Zeiten, Anteile
und der Kräftebedarf sind **Annahmen** für ein glaubwürdiges Spiel. Sie sind keine Vorgaben
einer realen Feuerwehr-Dienstvorschrift oder Alarm- und Ausrückeordnung (AAO).

## Wachen und Ausrückzeiten

| Standort                                      | Art                            | Ausrückzeit Tag / Nacht | Fahrzeuge                   |
| --------------------------------------------- | ------------------------------ | ----------------------- | --------------------------- |
| Feuerwache Brakenfeld                         | hauptamtliche Wachbereitschaft | 1–2 / 1,5–2,5 Min.      | ELW 1, 2× HLF, DLK, RW, TLF |
| FF Ellerbach                                  | Freiwillige Feuerwehr          | 4–7 / 5–8 Min.          | HLF, LF, DLK                |
| FF Tannrode                                   | Freiwillige Feuerwehr          | 4–7 / 5–8 Min.          | HLF, LF                     |
| FF Hagenried, Oberwiesel, Mühlsteg, Kaltenhof | Freiwillige Feuerwehr          | 5–8 / 5–9 Min.          | je ein LF                   |

Bei Freiwilligen Feuerwehren alarmiert der Meldeempfänger die Kräfte. Sie fahren zum Gerätehaus,
ziehen sich um und rücken aus. Deshalb ist der nächste Standort nicht immer der schnellste: Die
hauptamtliche Wache in Brakenfeld kann trotz längerer Fahrt früher eintreffen. Der
Fahrzeugvorschlag rechnet beides ein.

## Stichworte (eigenes Schema)

| Stichwort | Bedeutung                                   | AAO                                 |
| --------- | ------------------------------------------- | ----------------------------------- |
| B 1       | Kleinbrand, PKW, Mülleimer, Heimrauchmelder | 1 HLF (oder LF)                     |
| B 2       | Brand Gebäude (Küche, Wohnung)              | ELW 1, 2 HLF/LF, DLK, RTW           |
| B 3       | Großbrand, Dachstuhl                        | ELW 1, 3 HLF/LF, DLK, TLF, RTW, NEF |
| TH 1      | Ölspur, Baum auf Fahrbahn                   | 1 LF (oder HLF), ohne Sonderrechte  |
| TH 2      | Verkehrsunfall mit eingeklemmter Person     | HLF/LF, RW, RTW, NEF                |

„oder LF“ heißt: Die AAO nimmt das schnellste geeignete Fahrzeug. Ein LF ersetzt ein HLF.

## Ablauf und Lageentwicklung

1. **Lagemeldung:** Das erste Fahrzeug vor Ort meldet nach 1,5–3,5 Min., was tatsächlich los ist.
   Reichen die Kräfte nicht, fordert es nach („Lage größer als gemeldet“). Der Einsatz erscheint
   dann wieder als „Kräfte nachgefordert“, und der Vorschlag enthält genau das Fehlende.
2. **Abarbeitung:** Erst wenn alle nötigen Kräfte vor Ort sind, läuft die Arbeitszeit der Lage,
   zum Beispiel 45–75 Minuten bei einem Wohnungsbrand. Danach meldet die Feuerwehr „Feuer aus“
   und rückt ein.
3. **Ausbreitung:** Ist nach einer bestimmten Zeit kein Feuerwehrfahrzeug vor Ort, breitet sich die
   Lage aus. Aus dem Küchenbrand (nach 9–15 Min.) wird ein Wohnungsbrand, aus dem Wohnungsbrand
   (nach weiteren 16–25 Min.) ein Dachstuhlbrand. Das bringt mehr Kräftebedarf, längere Arbeit und
   ein schlechteres Ergebnis.
4. **Verletzte:** Manche Lagen haben eine verletzte Person, etwa mit Rauchgasvergiftung oder
   eingeklemmt nach einem Unfall. Der Rettungsdienst arbeitet dann parallel. Eingeklemmte Personen
   sind erst nach der technischen Rettung transportfähig. Ohne Verletzte werden alarmierte RTW und
   NEF nach der Lagemeldung wieder frei.

## Bewertung

- Eintreffzeit Feuerwehr: erstes Feuerwehrfahrzeug innerhalb von **10 Minuten** ab Notrufeingang
  (Annahme; typische Planungsgrößen liegen bei 8–10 Minuten). Bei Überschreitung gibt es −20 Punkte.
- **Brandausbreitung:** −20 Punkte. Das Outcome lautet „mit Folgeschäden“.
- **Stichwort zu niedrig:** wenn das zur Lage beim Notruf passende Stichwort dringlicher war
  (z. B. B 1 statt B 2).

## Lageentwicklung beim Patienten

Seit 0.3.0 gilt auch im Rettungsdienst: Wer lange auf Hilfe wartet, dem geht es schlechter. Ab
der Hilfsfrist steigt die Wahrscheinlichkeit, dass sich der Zustand bis zum Eintreffen um eine
NACA-Stufe verschlechtert. Sie wächst mit jeder weiteren Minute und liegt höchstens bei 60 %. Ab
NACA 5 wird dann ein Notarzt nötig.
