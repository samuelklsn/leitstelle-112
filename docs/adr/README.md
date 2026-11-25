# Architecture Decision Records

Jede wichtige, schwer umkehrbare Entscheidung wird hier als ADR festgehalten
(Vorlage: `0000-vorlage.md`). ADRs werden nicht nachträglich umgeschrieben; eine geänderte
Entscheidung bekommt ein neues ADR, das alte wird auf „Abgelöst" gesetzt. Nachträge
(z. B. Ergebnis eines Spikes) sind als datierter Abschnitt „Nachtrag" erlaubt.

| Nr.                                              | Titel                                                | Status     |
| ------------------------------------------------ | ---------------------------------------------------- | ---------- |
| [0001](0001-adrs-verwenden.md)                   | ADRs zur Dokumentation von Entscheidungen            | Angenommen |
| [0002](0002-desktop-shell-electron.md)           | Electron als Desktop-Shell                           | Angenommen |
| [0003](0003-monorepo-typescript.md)              | pnpm-Monorepo mit TypeScript strict                  | Angenommen |
| [0004](0004-deterministischer-sim-kern.md)       | Deterministischer Simulationskern                    | Angenommen |
| [0005](0005-prozessarchitektur.md)               | Prozessarchitektur: Sim-Host und Fenster             | Angenommen |
| [0006](0006-offline-karte-regionspakete.md)      | Offline-Karte und Regionspakete                      | Angenommen |
| [0007](0007-routing-fahrzeitmodell.md)           | Eigenes Routing und Fahrzeitmodell                   | Angenommen |
| [0008](0008-persistenz.md)                       | Persistenz: SQLite für Spielstände, YAML für Inhalte | Angenommen |
| [0009](0009-inhalte-modding.md)                  | Datengetriebene Inhalte und Modding                  | Angenommen |
| [0010](0010-teststrategie.md)                    | Teststrategie                                        | Angenommen |
| [0011](0011-ui-stack-i18n.md)                    | UI-Stack und Internationalisierung                   | Angenommen |
| [0012](0012-logging-crash-reports.md)            | Logging und Crash-Reports                            | Angenommen |
| [0013](0013-lizenz.md)                           | Lizenz: GPL-3.0 für Code, CC BY-SA 4.0 für Inhalte   | Angenommen |
| [0014](0014-endlosspiel-prozedurale-vielfalt.md) | Endlosspiel und prozedurale Vielfalt                 | Angenommen |
| [0015](0015-rd-logistik.md)                      | Rettungsdienst-Logistik                              | Angenommen |
| [0016](0016-welt-dynamik.md)                     | Welt-Dynamik: Wetter, Kalender, Ereignisse, Regie    | Angenommen |
| [0017](0017-manv-grosslagen.md)                  | Massenanfall von Verletzten und Großlagen            | Angenommen |
| [0018](0018-langzeitspiel.md)                    | Langzeitspiel: Laufbahn, Bedarfsplanung, Personen    | Angenommen |
