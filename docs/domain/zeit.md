# Spielzeit und Schichten

- Spielzeit sind **ganzzahlige Millisekunden** seit 1970-01-01 00:00 in Ortszeit. Ein Tick ist eine
  Sekunde (ADR-0004).
- Kalenderfelder werden ohne `Date` mit einem Ganzzahl-Algorithmus nach H. Hinnant berechnet.
  Damit ist das Ergebnis auf jedem Rechner bitgleich.
- **Annahme:** Es gibt keine Sommerzeitumstellung. Die Umstellung kommt mit #33.
- Ein neues Spiel beginnt zum heutigen Schichtbeginn (07:00 Uhr). Eine Schicht dauert 12 Stunden.
  Zum Schichtwechsel hält das Spiel an, zeigt die Auswertung und speichert automatisch. Danach geht
  es endlos weiter.
- Autosave alle 5 Spielminuten (die letzten 3 bleiben erhalten), beim Beenden und zum Schichtende.
