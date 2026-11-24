# Lizenzen und Quellen

Jede fremde Komponente, Schrift, Grafik und jeder Datensatz wird hier eingetragen, **bevor**
er ins Repository kommt. Eigene Werke sind als „Eigenwerk" vermerkt. Versionen und Lizenzen sind aus
den installierten Paketen ausgelesen (Stand v0.1.0).

## Projektlizenz

- Quellcode: GPL-3.0-or-later (`LICENSE`)
- Eigene Inhalte, Grafiken, Texte, Regionsdaten: CC BY-SA 4.0 (`content/LICENSE.md`)
- Begründung: ADR-0013. Alle Abhängigkeiten müssen GPL-3.0-kompatibel sein – MIT, ISC,
  BSD-3-Clause und Apache-2.0 sind es.

## Im ausgelieferten Spiel enthalten

| Komponente                              | Version         | Lizenz                             | Zweck           |
| --------------------------------------- | --------------- | ---------------------------------- | --------------- |
| Electron (inkl. Chromium, Node.js)      | 45.4.1          | MIT (Chromium: BSD-3-Clause u. a.) | Desktop-Shell   |
| React, React DOM                        | 19.3.1          | MIT                                | Oberfläche      |
| MapLibre GL JS                          | 6.19.0          | BSD-3-Clause                       | Offline-Karte   |
| Zustand                                 | 5.1.0           | MIT                                | UI-Zustand      |
| i18next / react-i18next                 | 27.2.6 / 18.0.3 | MIT                                | Übersetzungen   |
| Zod                                     | 4.6.7           | MIT                                | Inhalts-Schemas |
| yaml (eemeli/yaml)                      | 2.9.1           | ISC                                | YAML-Parser     |
| pino                                    | 10.4.0          | MIT                                | Logging         |
| SQLite (über `node:sqlite` in Electron) | –               | Public Domain                      | Spielstände     |

## Nur zum Entwickeln und Bauen

| Komponente                          | Version                 | Lizenz     |
| ----------------------------------- | ----------------------- | ---------- |
| TypeScript                          | 6.0.3                   | Apache-2.0 |
| Vite, @vitejs/plugin-react          | 8.3.8                   | MIT        |
| esbuild                             | 0.28.2                  | MIT        |
| electron-builder (NSIS)             | 26.18.0                 | MIT        |
| ESLint, typescript-eslint, Prettier | 10.15.0, 8.74.0, 3.10.1 | MIT        |
| Vitest, fast-check                  | 5.1.1, 4.11.0           | MIT        |
| Playwright                          | 1.65.1                  | Apache-2.0 |

## Geplant (beim Einbau prüfen)

| Komponente          | Erwartete Lizenz | Zweck                                           |
| ------------------- | ---------------- | ----------------------------------------------- |
| Radix UI Primitives | MIT              | zugängliche Dialoge und Menüs                   |
| TanStack Virtual    | MIT              | sehr lange Listen (MANV)                        |
| Noto Sans o. a.     | SIL OFL 1.1      | Kartenbeschriftung als Glyphen (echte Regionen) |

## Daten

| Datensatz                                       | Lizenz                   | Verwendung     | Attribution im Spiel                                  |
| ----------------------------------------------- | ------------------------ | -------------- | ----------------------------------------------------- |
| Fiktiver Landkreis „Brakenfeld"                 | Eigenwerk, CC BY-SA 4.0  | Vertical Slice | „Fiktiver Landkreis – Kartendaten: eigenes Werk"      |
| Straßennamen (Gattungsnamen wie „Lindenstraße") | gemeinfrei, Allgemeingut | Generator      | –                                                     |
| OpenStreetMap (später)                          | ODbL 1.0                 | echte Regionen | „© OpenStreetMap-Mitwirkende" dauerhaft auf der Karte |

## Grafiken, Icons, Sounds, Schriften

| Asset                                | Urheber                                                                | Lizenz       |
| ------------------------------------ | ---------------------------------------------------------------------- | ------------ |
| Logo „112", Kartenstil, Marker (CSS) | Eigenwerk                                                              | CC BY-SA 4.0 |
| Schriften                            | Windows-Systemschriften (Segoe UI, Cascadia Mono) – nicht mitgeliefert | –            |
| Screenshots in `docs/images`         | Eigenwerk (erzeugt aus dem Spiel)                                      | CC BY-SA 4.0 |
