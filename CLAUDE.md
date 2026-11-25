# CLAUDE.md – Konventionen für Leitstelle 112

Diese Datei gilt für jede Arbeit an diesem Repository. Bei Widerspruch zu einem ADR
gilt das neuere, angenommene ADR; diese Datei wird dann angepasst.

## Projekt in einem Satz

Realistischer, offline lauffähiger Leitstellensimulator (Rettungsdienst, Feuerwehr,
Katastrophenschutz) für Windows und Android: Electron bzw. Capacitor + React + MapLibre,
deterministischer TypeScript-Simulationskern. Plan: `docs/PLAN.md`, Entscheidungen: `docs/adr/`.

## Harte Regeln

1. **Nichts von LstSim.de übernehmen** – kein Code, keine Grafiken, Texte, Daten, Namen,
   Stichwortlisten oder Layouts. Gleiches gilt für andere Spiele und kommerzielle
   Leitstellensoftware (Produktnamen nicht verwenden).
2. **Nur eigene oder frei lizenzierte Assets.** Jede neue Fremdquelle (Bibliothek mit
   abweichender Lizenz, Schrift, Icon, Datensatz) wird in `docs/LICENSES.md` eingetragen,
   bevor sie committet wird.
3. **Der Sim-Kern (`packages/sim`, `packages/routing`) ist deterministisch:**
   kein `Math.random`, `Date`, `performance.now`, Timer, `for…in`, kein DOM, keine Node-APIs.
   Zufall nur über die PRNG-Streams des Kerns, Zeit nur über die Spielzeit (ganzzahlige ms).
4. **Keine Spiellogik im UI.** Das UI sendet Befehle und zeigt Deltas an.
5. **Keine fertigen Texte im Sim-Kern** – nur i18n-Schlüssel + Parameter.
6. **Keine Netzwerkzugriffe zur Laufzeit.** Keine Telemetrie, keine Remote-Inhalte.
7. **Große oder schwer umkehrbare Entscheidungen** (neue Abhängigkeit mit Tragweite,
   Datenformat, Architektur) erst mit dem Product Owner klären und als ADR festhalten.

## Struktur

```
apps/desktop        Electron Main, Preload, Sim-Host (utilityProcess), SQLite, Logging
apps/android        Capacitor-App: Brücke, Lebenszyklus, Android-Projekt (ADR-0021)
apps/mac3d          3D-Mac-App: Swift/RealityKit-Hülle + Web-Teil mit Szenen-Feed (ADR-0022)
apps/ui             React-Renderer (Vite), auch Telefon-Layout
packages/host       Plattformneutraler Sim-Host (Takt, Spielstände, Verteilung)
packages/web-host   Sim-Host im Web Worker, IndexedDB-Ablage (Android, Mac)
packages/sim        Simulationskern
packages/routing    Straßengraph, Routing, Fahrzeitmodell
packages/protocol   Nachrichtentypen Sim-Host <-> UI
packages/content-schema  Zod-Schemas, generierte JSON-Schemas
packages/content-loader  YAML laden, validieren, Mods zusammenführen
tools/region-builder     Regionen erzeugen (fiktiv, später OSM)
content/base        Basisinhalte (YAML)
docs/               Plan, ADRs, Fachdoku (docs/domain/), Lizenzen
```

## Code-Konventionen

- TypeScript strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), nur ESM.
- Kein `any`; `unknown` + Validierung an Systemgrenzen (IPC, Dateien, Inhalte).
- Benannte Exporte, keine Default-Exporte (außer wo ein Tool es verlangt).
- Dateinamen `kebab-case.ts`, React-Komponenten `PascalCase.tsx`.
- **Code-Bezeichner auf Englisch**, Fachbegriffe ohne gängige Übersetzung bleiben deutsch
  und werden nicht verballhornt: `Einsatz` → `incident`, aber `aao`, `fms`, `hilfsfrist`,
  `nef`, `rtw` bleiben. Glossar: `docs/domain/glossar.md` (ab M1).
- Kommentare und Dokumentation auf Deutsch; Kommentare erklären das _Warum_.
- IDs in Inhalten mit Namensraum: `base:rtw`.
- Formatierung: Prettier (keine Diskussionen), Linting: ESLint mit Typinformationen.
- Fehler im Sim-Kern: Befehle werden validiert und mit Ergebnis-Ereignis abgelehnt, nicht
  per Exception.

## Tests

- Jede Änderung im Sim-Kern bringt Tests mit; Invarianten als fast-check-Properties.
- Golden-Replay-Hashes nur bewusst und in eigenem Commit aktualisieren
  (`test(sim): update golden replays – <Grund>`).
- Tests neben dem Code: `foo.ts` → `foo.test.ts`.
- Vor jedem Commit: `pnpm lint && pnpm typecheck && pnpm test` grün.

## Git

- Branch `main` ist immer lauffähig. Arbeit in kurzen Feature-Branches
  (`feat/m3-dispatch`), Merge nach grüner CI.
- **Conventional Commits**: `feat(sim): …`, `fix(ui): …`, `docs(adr): …`, `test(routing): …`,
  `chore(ci): …`, `refactor(…)`, `perf(…)`. Scope = Paket oder Bereich. Beschreibung auf
  Deutsch, Imperativ, klein und fokussiert.
- Keine generierten Artefakte committen (Ausnahme: erzeugte Regionspakete für den Slice,
  falls in einem ADR so beschlossen).

## Definition of Done (pro Feature)

Implementiert · Tests grün · dokumentiert (Code + ggf. `docs/`) · CI erfolgreich ·
auf Windows manuell geprüft · im `CHANGELOG.md` unter „Unreleased" eingetragen.

## Meilenstein-Abschluss

1. Alle DoD-Punkte erfüllt, CI grün.
2. `CHANGELOG.md`: Abschnitt „Unreleased" in Version überführen (Keep a Changelog, SemVer).
3. ADR-Status aktualisieren.
4. Kurze Zusammenfassung an den Product Owner: Was ist neu, was ist offen, Risiken.

## Fachlicher Realismus

- Fachliche Annahmen (Hilfsfristen, AAO-Logik, Übergabezeiten, Fahrzeitfaktoren,
  Patientenmodell) werden in `docs/domain/` mit Quelle oder Begründung dokumentiert und als
  Daten abgelegt, nie als magische Zahl im Code.
- Bei Unsicherheit: als Annahme kennzeichnen, nicht als Fakt.

## Umgebung

- Windows 10/11 x64, Node.js LTS (Version in `.nvmrc`), pnpm (Version in `packageManager`).
- Android: JDK 21, Android SDK (Platform/Build-Tools 36), `ANDROID_HOME` gesetzt – siehe
  `docs/android.md`. Oberfläche immer auch im Telefon-Layout (< 900 px) prüfen.
- 3D-Mac-App: Xcode 26 (Swift 6.2), macOS 26; Bauen mit `pnpm --filter @ls112/mac3d build`,
  Prüfbilder über `LS112_SNAPSHOT_DIR` (siehe `docs/mac3d.md`). Swift-Code folgt Swift 6 mit
  MainActor als Standard-Isolation; 3D-Objekte nur aus eigenem Code (Regel 2).
- Shell-Befehle in Doku und Skripten für PowerShell bzw. plattformneutral über Node-Skripte.
