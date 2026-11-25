# Leitstelle 112 auf dem Android-Telefon installieren

Die App gibt es (noch) nicht im Play Store. Sie wird als **APK-Datei** direkt von GitHub geladen
und installiert. Das dauert etwa zwei Minuten.

## Voraussetzungen

| Was                    | Mindestens                                                    |
| ---------------------- | ------------------------------------------------------------- |
| Android-Version        | 8.0 (Oreo) oder neuer                                         |
| Freier Speicher        | ca. 30 MB                                                     |
| Android System WebView | aktuell halten (wird über den Play Store aktualisiert)        |
| Internet               | nur einmal zum Herunterladen – das Spiel selbst läuft offline |

Die Android-Version steht unter **Einstellungen → Über das Telefon → Android-Version**.

## Schritt 1: APK herunterladen

1. Auf dem Telefon die Release-Seite öffnen:
   **<https://github.com/samuelklsn/leitstelle-112/releases>**
2. Beim neuesten Eintrag mit Android-APK (z. B. „Android-Vorschau 1") den Abschnitt **Assets**
   aufklappen.
3. Auf **`Leitstelle112-…-android.apk`** tippen. Der Browser lädt die Datei herunter.
4. Fragt der Browser „Datei trotzdem herunterladen?" oder „Diese Art von Datei kann schädlich
   sein", mit **Herunterladen** bestätigen. Diese Warnung zeigt Android bei jeder APK außerhalb
   des Play Stores.

> **Vom Computer aus:** APK am PC herunterladen und per USB-Kabel in den Ordner `Download` des
> Telefons kopieren – oder per Mail, Cloud-Speicher oder Nearby Share/Quick Share schicken.

## Schritt 2: Installation aus „unbekannten Quellen" erlauben

Android installiert Apps außerhalb des Play Stores nur, wenn man es der App erlaubt, mit der die
APK geöffnet wird (Browser oder Dateimanager). Das fragt Android beim ersten Mal selbst:

1. Den Download antippen (Benachrichtigung „Download abgeschlossen" oder App **Dateien** →
   **Downloads**).
2. Es erscheint „Aus Sicherheitsgründen kannst du auf deinem Smartphone keine unbekannten Apps aus
   dieser Quelle installieren". Auf **Einstellungen** tippen.
3. Den Schalter **Dieser Quelle vertrauen** / **Aus dieser Quelle zulassen** einschalten.
4. Mit der Zurück-Taste zurückgehen.

Wo der Schalter je nach Hersteller liegt, falls die Abfrage nicht erscheint:

| Hersteller                | Pfad                                                                                     |
| ------------------------- | ---------------------------------------------------------------------------------------- |
| Google Pixel, Android One | Einstellungen → Apps → Spezieller App-Zugriff → Unbekannte Apps installieren → _Browser_ |
| Samsung                   | Einstellungen → Apps → ⋮ → Spezieller Zugriff → Unbekannte Apps installieren → _Browser_ |
| Xiaomi / Redmi / POCO     | Einstellungen → Datenschutz → Spezielle Berechtigungen → Unbekannte Apps installieren    |
| Huawei / Honor            | Einstellungen → Sicherheit → Weitere Einstellungen → Externe Quellen                     |

_Browser_ steht für die App, mit der die APK geöffnet wird – meist Chrome, Samsung Internet oder
„Dateien". Nach der Installation kann der Schalter wieder aus.

## Schritt 3: Installieren

1. Im Dialog „Möchtest du diese App installieren?" auf **Installieren** tippen.
2. Google Play Protect meldet eventuell „App wurde nicht überprüft" oder „Unbekannter Entwickler".
   Das liegt daran, dass die App nicht aus dem Play Store kommt. Auf **Details** →
   **Trotzdem installieren** tippen. Eine Bitte, die App „zur Überprüfung zu senden", kann
   abgelehnt werden.
3. Nach „App wurde installiert" auf **Öffnen** tippen – oder später **Leitstelle 112** (rotes
   Symbol mit „112") im App-Menü starten.

## Erster Start

- Zum Einstieg **Tutorial** wählen: Es führt durch den ersten Einsatz vom Notruf bis ins
  Krankenhaus.
- Das Telefon kann hoch oder quer gehalten werden. Auf Tablets im Querformat erscheint die volle
  Arbeitsfläche wie am PC.
- Töne an/aus über das Lautsprecher-Symbol oben. Mit Tönen vibriert das Telefon zusätzlich bei
  Notruf und Großlage.

Bedienung im Detail: [docs/android.md](android.md#bedienung).

## Aktualisieren

Neue Version wie oben herunterladen und installieren – Android fragt „Möchtest du ein Update für
diese App installieren?". **Spielstände und eigene Mods bleiben erhalten.**

Klappt das Update nicht („App nicht installiert" / „Paket steht in Konflikt"), wurde die alte
Version mit einem anderen Schlüssel signiert (bei Vorschau-Versionen möglich). Dann die alte App
deinstallieren und neu installieren – dabei gehen die Spielstände auf dem Gerät verloren.

## Deinstallieren

App-Symbol lange drücken → **Deinstallieren** (oder Einstellungen → Apps → Leitstelle 112 →
Deinstallieren). Dabei werden auch Spielstände und eigene Mods gelöscht.

## Probleme

| Problem                                         | Lösung                                                                                                                                                                           |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| „App nicht installiert"                         | Android 8.0 oder neuer? Genug Speicher frei? Ältere Version vorher deinstallieren (siehe _Aktualisieren_).                                                                       |
| „Parsing-Fehler" / „Problem beim Parsen"        | Download war unvollständig – APK löschen und erneut herunterladen.                                                                                                               |
| Weißer oder schwarzer Bildschirm nach dem Start | „Android System WebView" und „Chrome" im Play Store aktualisieren, App neu starten.                                                                                              |
| Karte ruckelt                                   | Andere Apps schließen; Zeitraffer niedriger stellen. Ältere Geräte schaffen 10× nicht immer flüssig.                                                                             |
| Spiel stand nach Rückkehr still                 | Gewollt: Beim Wechsel in eine andere App wird gespeichert und angehalten. Mit ▶ geht es weiter.                                                                                  |
| Fehler melden                                   | Menü ≡ → Hilfe → **Diagnosepaket erstellen**, über das Teilen-Menü speichern und einem [Fehlerbericht](https://github.com/samuelklsn/leitstelle-112/issues/new/choose) anhängen. |

## Sicherheit und Datenschutz

- Die App fragt nach **keinen Berechtigungen** (kein Standort, keine Kontakte, kein Mikrofon).
- Sie lädt **nichts aus dem Internet** und sendet nichts – keine Werbung, keine Telemetrie.
- Spielstände liegen nur auf dem Gerät.
- Der Quellcode ist offen (GPL-3.0) – jede APK kann aus diesem Repository selbst gebaut werden,
  siehe [docs/android.md](android.md#selbst-bauen).
