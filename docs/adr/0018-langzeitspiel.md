# ADR-0018: Langzeitspiel – Laufbahn, Bedarfsplanung, wiederkehrende Personen

- Status: Angenommen
- Datum: 2026-11-24

## Kontext

ADR-0014 (Punkte 7 und 9) verlangt ein Spiel ohne Ende: Schichten sollen aufeinander aufbauen,
die Region soll ein Gedächtnis haben, und es soll Ziele über viele Schichten geben. Meilenstein M11
(Issues #53, #54) setzt das um – ohne den deterministischen Kern aufzugeben.

## Entscheidung

1. **Laufbahn im Spielstand.** `SimState.career` sammelt Erfahrung aus den Punkten jeder Schicht.
   Stufen sind Daten (`settings.career.ranks`). Höhere Stufen übernehmen einen **größeren
   Bereich**: Ein Flächenfaktor erhöht das Aufkommen von Notrufen und Transportaufträgen. Die
   Physik (Fahrzeiten, Kliniken) ändert sich nicht.
2. **Bedarfsplanung mit eigener Statistik.** Gute Schichten bringen Budget. Ein Antrag auf ein
   zusätzliches Fahrzeug (RTW, Tages-RTW, KTW, NEF) an einer Wache wird bewilligt, wenn Budget da
   ist und die letzte Schicht ihn begründet: hohe Auslastung der Fahrzeuge dieses Typs an der
   Wache oder verfehlte Hilfsfrist. Bewilligte Fahrzeuge stehen im Spielstand
   (`career.extraVehicles`) und gehen in die Weltdaten für die Oberfläche ein; der Sim-Host sendet
   die Weltdaten nach einer Bewilligung neu.
3. **Wiederkehrende Personen.** Je Spiel entstehen aus dem Seed Vielanrufer, Stammpatienten und
   Gefahrenadressen mit fester Adresse und Rufnummer. Ein Teil der Notrufe kommt von ihnen.
4. **Einsatzhistorie je Adresse.** Abgeschlossene Einsätze schreiben Zahl, Stichworte und Hinweise
   (Gefahr, Vielanrufer) fort. Die Notrufmaske zeigt sie, sobald Adresse bzw. Rufnummer erfragt
   sind – wie ein Einsatzleitsystem.
5. **Eigensicherung.** An Gefahrenadressen warten die Kräfte ohne Polizei, bevor sie zum Patienten
   gehen. War die Gefahr bekannt (Historie oder Hinweis des Anrufers), ist das ein Fehler.
6. **Tages-Herausforderung.** Der Sim-Host leitet den Seed offline aus dem Datum ab; alle spielen
   an diesem Tag denselben Verlauf. Die Bestleistung bleibt lokal.
7. Snapshot-Version 6.

## Konsequenzen

- Lange Spielstände werden schwerer und abwechslungsreicher; Fehler wirken über die Schicht hinaus
  (Budget, Historie).
- Alle Schwellen und Kosten sind Annahmen (`docs/domain/langzeit.md`) und als Daten änderbar.
- Mehr Fläche heißt im Spiel nur „mehr Aufkommen“; neue Orte und Wachen kommen mit dem
  Regionen-Editor (M12) und echten Regionen (M13).
