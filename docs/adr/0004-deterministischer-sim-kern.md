# ADR-0004: Deterministischer Simulationskern

- Status: Angenommen
- Datum: 2026-11-24

## Kontext

Die Simulation muss ohne UI testbar, reproduzierbar (Bugreports, Replays, faire
Auswertung) und im Zeitraffer bis 10x stabil sein.

## Entscheidung

- `packages/sim` ist reines TypeScript ohne DOM, Node-API, Systemzeit oder globalen Zufall.
- **Spielzeit** ganzzahlig in ms; **fester Tick = 1 s Spielzeit**. Zeitraffer = mehr Ticks pro
  Echtzeitsekunde, Pause = keine Ticks. Der Zeitgeber liegt außerhalb des Kerns, der Kern
  bietet nur `step()`.
- **Hybrid:** Tick-Systeme + Ereigniswarteschlange (Zeitpunkt, Sequenznummer) für exakte
  Termine.
- **PRNG:** eigener, kleiner Generator (PCG32 oder xoshiro128\*\*), Streams je Subsystem per
  SplitMix aus dem Master-Seed abgeleitet. Der PRNG-Zustand ist Teil des Spielstands.
- **Befehle** (Spielerhandlungen) sind serialisierbare Objekte, werden am Tick-Anfang
  angewendet und mit Tick-Nummer protokolliert.
- **Verboten im Kern (per Lint):** `Math.random`, `Date`, `performance.now`, Timer,
  `for…in`, transzendente `Math`-Funktionen ohne Freigabe. Geometrie wird zur Build-Zeit
  vorberechnet.
- **State-Hash** (schnelle Prüfsumme über den Zustand) für Determinismus-Tests.
- Ausgaben: Ereignisse und Deltas mit Meldungsschlüsseln statt fertiger Texte.

## Alternativen

- Variable Zeitschritte (`dt` nach Echtzeit): nicht reproduzierbar.
- Reine Ereignissimulation ohne Tick: elegant, aber Bewegung, Patientenverfall und
  UI-Fortschritt werden komplizierter.
- Feinerer Tick (100 ms): unnötig, Leitstellenabläufe liegen im Sekundenbereich;
  die UI interpoliert Bewegungen.

## Konsequenzen

Saubere Tests und Replays. Disziplin nötig: jede Neuerung muss die Regeln einhalten;
Golden-Replay-Tests fangen Verstöße ab. Spielstand-Kompatibilität bei Änderungen der
Simulationslogik erfordert Versionierung.

## Nachtrag 2026-11-24 (M2)

`Math.sqrt` ist im Kern erlaubt: IEEE 754 schreibt ein korrekt gerundetes Ergebnis vor, es ist also
auf allen Engines bitgleich. Sinus und Kosinus berechnet der Weltgenerator mit einer eigenen
Taylorreihe (`detSin`/`detCos`), weil `Math.sin` nicht bitgenau spezifiziert ist.
