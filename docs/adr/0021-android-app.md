# ADR-0021: Android-App mit Capacitor und Sim-Worker

- Status: Angenommen
- Datum: 2026-11-25

## Kontext

Leitstelle 112 soll zusätzlich als Android-App erscheinen, inhaltlich gleich wie die Windows-Version,
aber für Telefone und Tablets bedienbar. Vorgaben, die weiter gelten:

- offline, keine Netzwerkzugriffe zur Laufzeit (Regel 6),
- deterministischer Kern ohne Plattformcode (ADR-0004),
- keine Spiellogik im UI (Regel 4), ein Protokoll zwischen Host und Oberfläche (ADR-0005),
- Spielstände und Mods wie unter Windows (ADR-0008, ADR-0019).

Die Windows-App besteht aus Electron-Main (Fenster, Dateien), einem Sim-Host im `utilityProcess`
(Node, SQLite) und der React-Oberfläche. Nur Main und das Speichern hängen an Node bzw. Electron;
Kern, Protokoll, Inhalte und die Host-Logik (`SimHost`, `SimClock`) sind plattformneutral.

## Entscheidung

1. **Hülle: Capacitor 8** (`apps/android`). Die React-Oberfläche aus `apps/ui` läuft unverändert im
   Android System WebView; Capacitor liefert sie aus den App-Assets (`https://localhost`, kein
   Netzwerk). Native Funktionen nur über offizielle Plugins: App (Lebenszyklus, Zurück-Taste),
   Haptics (Vibration bei Notruf), Filesystem und Share (Diagnosepaket).
2. **Sim-Host im Web Worker.** `SimHost` und `SimClock` ziehen aus `apps/desktop` in das neue Paket
   `packages/host`; Windows (utilityProcess) und Android (Worker) nutzen denselben Code. Der Worker
   bekommt wie unter Windows einen `MessagePort` je Fenster; die Oberfläche merkt keinen
   Unterschied.
3. **Inhalte:** Die Basis-YAML-Dateien bündelt Vite beim Bauen in den Worker. Das Zusammenführen mit
   Mods (`loadWithModLayers`) liegt jetzt dateisystemfrei in `packages/content`; Windows liest die
   Schichten aus Ordnern, Android aus IndexedDB.
4. **Spielstände in IndexedDB** mit synchronem Speicher-Cache (`CachedSaveStore`): Der Host bleibt
   synchron (ADR-0008), jede Änderung wird im Hintergrund durchgeschrieben. Format wie unter
   Windows: Snapshot und Befehlsprotokoll zlib-komprimiert (fflate), drei rollierende Autosaves.
5. **Lebenszyklus:** Geht die App in den Hintergrund, sichert der Host automatisch und hält die Zeit
   an (`SimHost.suspend`). Android darf Hintergrund-Apps jederzeit beenden; so geht höchstens der
   Moment des Wechsels verloren. Stürzt der Worker ab, startet die App ihn neu und lädt den letzten
   Autosave – wie der Sim-Host-Neustart unter Windows.
6. **Bedienung:** Unter 900 CSS-Pixel Breite zeigt die Oberfläche ein Telefon-Layout: ein Bereich
   zur Zeit (Karte, Notrufe, Fahrzeuge, Einsätze) mit Leiste unten, Zähler für Wartendes und
   Schnellknöpfe für Annehmen, Alarmieren und Zielklinik (dieselben Regeln wie F2/F3/F4). Dialoge
   füllen den Bildschirm. Tablets im Querformat behalten die Desktop-Arbeitsfläche mit größeren
   Tippflächen. Mehrfenster und Layouts (#50) gibt es auf Android nicht.
7. **Mindestversion Android 8.0 (API 26),** Ziel-API 36. Das WebView aktualisiert sich über den
   Play Store, deshalb zielt der Build auf ein aktuelles Chromium.

## Alternativen

- **Native App (Kotlin) mit eigenem Kern:** doppelte Spiellogik, Determinismus zwischen zwei
  Implementierungen nicht zu halten. Verworfen.
- **React Native:** Oberfläche müsste neu geschrieben werden, MapLibre GL JS nicht direkt nutzbar.
- **Kern auf dem Hauptthread:** einfacher, aber Ruckeln der Karte beim Rechnen und Speichern
  (gleiches Argument wie ADR-0005).
- **SQLite per Capacitor-Plugin:** Community-Plugin mit nativem Code; IndexedDB reicht für wenige,
  komprimierte Spielstände und kommt ohne zusätzliche Abhängigkeit aus.
- **Progressive Web App:** bräuchte einen Webserver und wäre nicht als APK installierbar.

## Konsequenzen

- Eine Codebasis für beide Plattformen; Änderungen an Oberfläche und Kern gelten sofort für beide.
- Mods kommen auf Android nur aus den Editoren (Szenario, Wache); einen Mod-Ordner zum
  Hineinkopieren gibt es nicht. Import von Mod-Dateien ist eine mögliche Folgearbeit.
- Spielstände wandern nicht automatisch zwischen Windows und Android.
- Das Android-Projekt (`apps/android/android`) ist Quellcode und wird eingecheckt; erzeugte Dateien
  (Web-Kopie, Build-Ausgaben) nicht.
- Die CI baut zusätzlich eine Debug-APK. Für Veröffentlichungen im Play Store fehlen noch ein
  Signaturschlüssel und ein App-Bundle (AAB) – siehe `docs/android.md`.
