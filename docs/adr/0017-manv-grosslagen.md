# ADR-0017: Massenanfall von Verletzten und Großlagen

- Status: Angenommen
- Datum: 2026-11-24

## Kontext

Bis 0.6.0 hat jeder Einsatz genau einen Patienten. Großlagen wie ein Busunfall oder ein Großbrand
gehören aber zum Alltag einer Leitstelle, auch wenn sie selten sind. Sie verlangen andere
Entscheidungen: Führungskräfte alarmieren, Reserven (SEG) einsetzen, Patienten auf Kliniken
verteilen, Fahrzeuge geordnet heranführen. Meilenstein M10 (Issues #51, #52) soll das abbilden.

## Entscheidung

1. **Großlage als Wahrheit mit vielen Patienten.** `Truth.mci` enthält Patienten mit
   Sichtungskategorie (T1–T4), Krankheitsbild und Transportbedarf. Der Einsatzablauf (Alarm,
   Anfahrt, Transport, Übergabe) bleibt derselbe; `systems/mci.ts` entscheidet nur, was an der
   Einsatzstelle mit den Patienten geschieht.
2. **Sichtung als Phase.** Nach der Lagemeldung kennt die Leitstelle nur eine geschätzte Zahl.
   Erst die Sichtung (mit LNA bzw. Arzt schnell, ohne Arzt langsam) zeigt Kategorien. Transporte
   beginnen nach der Sichtung; Schwerverletzte nur, wenn ein Arzt vor Ort ist.
3. **Ladeplätze und Bereitstellungsraum.** Mehr als vier Fahrzeuge gleichzeitig an der
   Einsatzstelle verlangsamen das Beladen (Stau). Ein Bereitstellungsraum mit OrgL verhindert das
   gegen einen kleinen Abrufzuschlag.
4. **Patientenverteilung.** Entweder fragt jedes Transportmittel per Sprechwunsch nach dem Ziel,
   oder die Leitstelle schaltet die Verteilung nach Kapazität ein. Wer eine Klinik überlastet,
   obwohl andere Plätze hatten, macht einen Fehler.
5. **Reserven nur bei Großlagen.** Stationen mit `reserve` (SEG, Einsatzleitung) schlägt der
   Vorschlag nur bei Großlagen-Stichworten oder nach einer Großlagen-Lagemeldung vor.
6. **Technischer Teil über die Feuerwehrlogik.** Brand, technische Rettung und Gefahrgut einer
   Großlage nutzen dieselbe Abarbeitung wie Feuerwehrlagen (`fireSpec`).
7. **Bewertung je Patient** mit „goldener Stunde“ für Schwerverletzte. Snapshot-Version 5.

## Konsequenzen

- Großlagen sind selten (etwa alle drei Wochen) und lassen sich als „MANV-Übung“ gezielt starten.
- Alle Zeiten und Anteile sind Annahmen (`docs/domain/manv.md`), kein reales MANV-Konzept.
- Behandlungsplatz, Patientenablage und Transportorganisation sind vereinfacht. Eine eigene
  Karte des Schadensraums ist nicht vorgesehen.
