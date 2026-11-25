# Leitstelle 112 auf Android

Die Android-App ist dasselbe Spiel wie unter Windows, für Telefone und Tablets eingerichtet.
Architektur und Begründung: [ADR-0021](adr/0021-android-app.md).

## Installieren

1. Die Datei `Leitstelle112-<Version>.apk` aus den
   [Releases](https://github.com/samuelklsn/leitstelle-112/releases) oder dem CI-Lauf
   („Artifacts") aufs Telefon laden.
2. Öffnen und „Aus dieser Quelle installieren" erlauben (Android fragt einmalig nach).
3. Voraussetzung: Android 8.0 oder neuer, aktuelles „Android System WebView" (Play Store).

Die App fragt nach keinen Berechtigungen und lädt nichts aus dem Internet; sie läuft vollständig
offline.

## Bedienung

| Gerät                  | Layout                                                                    |
| ---------------------- | ------------------------------------------------------------------------- |
| Telefon (hoch / quer)  | Ein Bereich zur Zeit – Karte, Notrufe, Fahrzeuge, Einsätze – Leiste unten |
| Tablet ab ~900 px quer | Arbeitsfläche wie unter Windows, mit größeren Tippflächen                 |

- **Schnellknöpfe** unten rechts erscheinen, sobald etwas wartet: _Notruf annehmen_, _Alarmieren_,
  _Zielklinik_. Sie tun dasselbe wie F2, F3 und F4 am Desktop.
- **Zähler in der Leiste** zeigen wartende Notrufe (rot, solange jemand in der Leitung wartet),
  Sprechwünsche der Fahrzeuge und Einsätze ohne ausreichende Kräfte.
- **Zeitraffer:** Der Knopf neben Pause schaltet reihum durch 1×, 2×, 5×, 10×.
- **Zurück-Taste:** schließt zuerst den offenen Dialog, dann geht es zur Karte, dann in den
  Hintergrund.
- **Hintergrund:** Beim Wechsel in eine andere App wird automatisch gespeichert und die Zeit
  angehalten. Weiter geht es mit ▶.
- **Vibration** bei Notruf und Großlage, solange die Töne eingeschaltet sind.
- Mit Bluetooth-Tastatur gelten die Tastenkürzel wie am Desktop.

## Was es nur unter Windows gibt

- Mehrere Fenster und Bildschirm-Layouts.
- Mod-Ordner zum Hineinkopieren. Auf Android entstehen eigene Inhalte über die Editoren
  (Szenario, Wache) und werden in der App gespeichert.
- Spielstände sind pro Gerät; sie wandern nicht zwischen Windows und Android.

## Diagnosepaket

Hilfe → _Diagnosepaket erstellen_ packt das App-Log und Geräteangaben in eine ZIP-Datei und öffnet
das Android-Teilen-Menü. Nichts wird von selbst versendet.

## Selbst bauen

Voraussetzungen: Node.js und pnpm wie im Hauptprojekt, **JDK 21**, Android SDK mit
„Platform 36" und „Build-Tools 36". `ANDROID_HOME` muss auf das SDK zeigen.

```bash
pnpm install
pnpm --filter @ls112/android apk
```

Das Skript baut die Web-App, überträgt sie mit `cap sync` ins Android-Projekt und ruft Gradle auf.
Die APK liegt danach in `apps/android/android/app/build/outputs/apk/debug/`.

Zum Entwickeln läuft die Android-Oberfläche samt Sim-Worker auch im Browser:

```bash
pnpm --filter @ls112/android dev
```

Dann `http://localhost:5174` öffnen und in den Entwicklerwerkzeugen eine Telefongröße einstellen.

### Veröffentlichen (Play Store)

Für eine signierte Release-Version (`pnpm --filter @ls112/android apk -- --release`) braucht
Gradle einen Signaturschlüssel. Der Schlüssel gehört nicht ins Repository; er wird als Secret
hinterlegt und in `apps/android/android/app/build.gradle` unter `signingConfigs` eingebunden.
Der Play Store verlangt außerdem ein App-Bundle (`bundleRelease`). Beides ist vorbereitet, aber
noch nicht eingerichtet.
