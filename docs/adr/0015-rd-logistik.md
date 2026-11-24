# ADR-0015: Rettungsdienst-Logistik

- Status: Angenommen
- Datum: 2026-11-24

## Kontext

Bis 0.3.0 ist jedes Fahrzeug nach dem Einsatz sofort wieder verfügbar, jede Klinik nimmt jeden
Patienten auf und Arbeit entsteht nur durch Notrufe. In einer echten Leitstelle bestimmen
Logistik und Planung einen großen Teil der Schicht: Krankentransporte mit Termin, Verlegungen,
abgemeldete Kliniken, Fahrzeuge in der Desinfektion oder Werkstatt, Pausen der Besatzungen und
Fahrzeuge, die nur zu bestimmten Zeiten besetzt sind. Meilenstein M7 (Issues #42–#45) soll das
abbilden, ohne den deterministischen Kern (ADR-0004) oder die Datengetriebenheit (ADR-0009)
aufzugeben.

## Entscheidung

1. **Transportaufträge sind Einsätze mit Auftrag.** Krankentransporte, Verlegungen und
   Intensivverlegungen werden als `IncidentState` mit einem Feld `order` geführt (Abholort,
   Ziel, Termin). Sie laufen durch dieselbe Fahrzeugkette (Alarm, Anfahrt, Abholung, Transport,
   Übergabe), brauchen aber keine Notrufabfrage und keine Zielklinik-Zuweisung. Vorlagen kommen
   aus den Inhalten (`transportOrders`), die Häufigkeit aus den Einstellungen.
2. **Transportklassen statt Sonderfälle.** Fahrzeugtypen bekommen `transportClass`
   (`notfall`, `krankentransport`, `intensiv`). Nur die Klasse `notfall` transportiert
   Notfallpatienten und zählt für die Hilfsfrist. Ein NAW ist ein Typ mit `canTransport` und
   `doctor`; er deckt Transport- und Notarztbedarf zugleich.
3. **Aufnahmekapazität je Fachabteilung.** Kliniken haben optional `beds` je Abteilung: freie
   Aufnahmeplätze für Notfallpatienten. Jeder Notfalltransport belegt einen Platz; Plätze werden
   mit der Zeit wieder frei, andere Patienten (Selbsteinweiser, Nachbarbereiche) belegen
   zufällig welche. Ist kein Platz frei oder fällt ein Gerät aus, meldet sich die Abteilung ab.
   Wer trotzdem dorthin fährt, obwohl eine andere geeignete Klinik aufnahmebereit war, macht einen
   Fehler.
4. **Verfügbarkeit von Fahrzeugen.** Ein Fahrzeug kann außer Dienst sein (FMS 6) mit einem Grund:
   Desinfektion nach Infektionstransport, Defekt (Werkstatt), Tanken, Pause, Dienstende. Dienst-
   zeiten (`service`) stehen je Fahrzeug in den Inhalten (z. B. KTW 7–19 Uhr). Pausen beantragt
   die Besatzung nach sechs Stunden Dienst per Funk; der Disponent genehmigt sie
   (`vehicle/break`) und wägt Versorgung gegen Arbeitszeitschutz ab.
5. **Eigene Zufalls-Streams** `logistics`, `hospitals` und `orders`. Damit ändert sich das
   Snapshot-Format (Version 3) und die Golden Replays werden bewusst aktualisiert.

## Konsequenzen

- Mehr Entscheidungen pro Schicht: RTW für einen Krankentransport binden oder auf den KTW
  warten, Pause jetzt genehmigen oder später, abgemeldete Klinik umgehen.
- Alle Zeiten und Anteile sind Annahmen und in `docs/domain/logistik.md` begründet.
- Spielstände aus 0.3.0 lassen sich nicht laden (Snapshot-Version 3). Für Vorabversionen ist
  das akzeptiert; ab 1.0.0 braucht es Migrationen.
- Ein- und Ausstieg in Mehrpatientenlagen (MANV, M10) baut auf Transportklassen und
  Klinikkapazitäten auf.
