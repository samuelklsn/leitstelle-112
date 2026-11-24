# Spielzeit und Schichten

- Spielzeit sind **ganzzahlige Millisekunden** seit 1970-01-01 00:00 in Normalzeit (MEZ). Ein
  Tick ist eine Sekunde (ADR-0004).
- Kalenderfelder werden ohne `Date` mit einem Ganzzahl-Algorithmus nach H. Hinnant berechnet.
  Damit ist das Ergebnis auf jedem Rechner bitgleich.
- **Sommerzeit (seit 0.5.0):** Der Kern rechnet ohne Sprünge in Normalzeit. Erst die Uhrzeit
  berücksichtigt die Sommerzeit (MESZ): am letzten Sonntag im März springt sie von 2 auf 3 Uhr,
  am letzten Sonntag im Oktober läuft die Stunde von 2 bis 3 Uhr doppelt. Schichten in diesen
  Nächten dauern 11 bzw. 13 Stunden (ADR-0016).
- Ein neues Spiel beginnt zum heutigen Schichtbeginn (07:00 Uhr) – oder, im Startbildschirm
  gewählt, im Winter, im Sommer oder in der Silvesternacht (19 Uhr). Eine Schicht dauert 12 Stunden.
  Zum Schichtwechsel hält das Spiel an, zeigt die Auswertung und speichert automatisch. Danach geht
  es endlos weiter.
- Autosave alle 5 Spielminuten (die letzten 3 bleiben erhalten), beim Beenden und zum Schichtende.
