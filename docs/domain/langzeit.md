# Langzeitspiel (seit 0.8.0)

Daten: `career` und `persons` in [`einstellungen.yaml`](../../content/base/einstellungen.yaml).
Entscheidung: [ADR-0018](../adr/0018-langzeitspiel.md). Alle Schwellen, Kosten und Anteile sind
**Annahmen** für das Spiel.

## Laufbahn

Jede Schicht bringt so viele Erfahrungspunkte, wie die Auswertung Punkte zeigt (negative Schichten
zählen als null).

| Stufe                    | ab Erfahrung | Bereich (Faktor auf das Aufkommen) |
| ------------------------ | ------------ | ---------------------------------- |
| Disponent/in             | 0            | 1,0                                |
| Erfahrene/r Disponent/in | 2.500        | 1,1                                |
| Schichtführer/in         | 7.000        | 1,2                                |
| Lagedienstführer/in      | 15.000       | 1,35                               |

Mit jeder Stufe übernimmt man einen größeren Bereich: Es kommen mehr Notrufe und
Krankentransporte – mit denselben Fahrzeugen, solange die Bedarfsplanung nichts nachbessert.

## Bedarfsplanung

Je Punkt einer Schicht gibt es 0,25 Budget. Unter **Auswertung → Bedarfsplanung** lässt sich ein
zusätzliches Fahrzeug an einer Rettungswache beantragen:

| Fahrzeug             | Kosten |
| -------------------- | ------ |
| RTW rund um die Uhr  | 600    |
| Tages-RTW (8–20 Uhr) | 350    |
| KTW                  | 200    |
| NEF                  | 500    |

Bewilligt wird nur ein **begründeter** Antrag: Die Fahrzeuge dieses Typs an der Wache waren in der
letzten Schicht mindestens 35 % der Zeit gebunden, oder die Hilfsfrist wurde verfehlt. Das neue
Fahrzeug steht sofort auf der Wache und bleibt im Spielstand.

## Wiederkehrende Personen und Adressen

Jedes Spiel hat aus seinem Seed drei Vielanrufer, sechs Stammpatienten und drei Gefahrenadressen.
Etwa 6 % der Notrufe kommen von ihnen:

- **Vielanrufer** rufen oft nur an, um jemanden zu hören (Auskunft), manchmal mit einem
  psychiatrischen Notfall.
- **Stammpatienten** haben immer dasselbe Krankheitsbild (COPD, Diabetes, Epilepsie, Stürze).
- **Gefahrenadressen:** Intoxikation oder psychiatrischer Notfall mit Gefahr für die
  Einsatzkräfte. In 60 % der Anrufe erwähnt der Anrufer Aggression oder eine Waffe.

Die Notrufmaske zeigt nach „Wo?“ die **Einsatzhistorie** der Adresse (Zahl, letzte Stichworte,
Gefahrenhinweis) und nach der Rückrufnummer, ob der Anrufer bekannt ist.

### Eigensicherung

An einer Gefahrenadresse warten die Kräfte ohne Polizei 5–10 Minuten, bevor sie zum Patienten
gehen. Den Knopf **„Polizei“** zeigt die Einsatzliste, sobald die Gefahr bekannt ist. War sie bekannt
(Historie oder Hinweis des Anrufers) und die Polizei wurde nicht verständigt, gibt es den Fehler
„Polizei trotz bekannter Gefahr nicht verständigt“ (−10 Punkte).

## Tages-Herausforderung

Im Startbildschirm: **Tages-Herausforderung**. Der Seed stammt aus dem heutigen Datum – an diesem
Tag spielen alle denselben Verlauf. Die Auswertung zeigt die Bestleistung auf diesem Rechner.
Nichts wird versendet.
