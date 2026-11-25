# Leitstelle 112 3D (Mac)

Die 3D-Ausgabe: dieselbe Leitstelle, aber du sitzt im **Leitstellenraum** und siehst **draußen den
Landkreis** mit fahrenden Einsatzfahrzeugen. Architektur: [ADR-0022](adr/0022-3d-mac-app.md).

Voraussetzung: macOS 26 (Tahoe) oder neuer, Mac mit Apple-Chip.

## Ansichten

| Ansicht               | Was du siehst                                                                      |
| --------------------- | ---------------------------------------------------------------------------------- |
| **Leitstelle** (⌘1)   | Leitstellenraum in 3D: dein Platz mit drei Monitoren, Videowand, Kollegen, Telefon |
| **Arbeitsplatz** (⌘2) | Die Leitstellen-Software bildschirmfüllend – wie unter Windows                     |
| **Lage 3D** (⌘3)      | Der Landkreis: Orte, Straßen, Fluss, Wälder, Wachen, Kliniken, Fahrzeuge, Einsätze |

Die Simulation läuft in allen Ansichten weiter.

### Leitstelle

- **Ziehen:** umsehen.
- **Klick auf deinen Monitor:** an den Arbeitsplatz.
- **Klick aufs Telefon:** Notruf annehmen. Das Telefon blinkt rot, solange jemand in der Leitung
  wartet.
- Die Monitore zeigen live die Leitstellen-Software.

### Lage 3D

- **Ziehen:** Kamera drehen · **⌥-Ziehen** oder Rechtsziehen: verschieben · **Scrollen** oder
  Zusammenziehen auf dem Trackpad: zoomen.
- **Klick auf ein Fahrzeug:** Die Kamera folgt ihm (oben „Folgt: …", Klick darauf löst sie).
- **Klick auf einen Einsatz:** öffnet ihn am Arbeitsplatz, bei fehlenden Kräften gleich die
  Disposition.
- Blaulicht blinkt bei Einsatzfahrten, der Rettungshubschrauber fliegt, über Bränden steht Rauch.
- Tageszeit und Wetter folgen dem Spiel: Sonnenstand, nachts beleuchtete Fenster, Regen und Schnee.

### Tastatur

| Taste        | Funktion                            |
| ------------ | ----------------------------------- |
| ⌘1 / ⌘2 / ⌘3 | Leitstelle / Arbeitsplatz / Lage 3D |
| ⇧⌘N          | Notruf annehmen                     |
| ⌘P           | Pause / Weiter                      |

Am Arbeitsplatz gelten alle Tasten der Leitstellen-Software (F2, F3, F4, Leertaste …).

## Bauen

Voraussetzungen: Xcode 26 oder neuer (Swift 6.2), Node.js und pnpm wie im Hauptprojekt.

```bash
pnpm install
pnpm --filter @ls112/mac3d build
```

Das baut den Web-Teil nach `apps/mac3d/Resources/web`, kompiliert die Swift-App, signiert sie
(mit deinem Apple-Development-Zertifikat, sonst ad hoc) und installiert sie nach
`~/Applications/Leitstelle3D.app`.

Tests der Rechenwege (Koordinaten, Kamera, Gebäude, Feed):

```bash
cd apps/mac3d && swift test --scratch-path ~/Library/Developer/Leitstelle3D/test-build
```

### Prüfbilder

```bash
LS112_SNAPSHOT_DIR=/tmp/ls112-3d ~/Applications/Leitstelle3D.app/Contents/MacOS/Leitstelle3D
```

Die App startet ein Spiel mit Zeitraffer, rendert nach etwa 25 Sekunden Lage 3D (Übersicht nachts
und mittags, Wache, Fahrzeug, Einsatz) und den Leitstellenraum als PNG und beendet sich.
`LS112_SNAPSHOT_SECONDS` ändert die Wartezeit.

## Später: Android

Die 3D-Darstellung nutzt RealityKit und läuft nur auf Apple-Geräten. Für Android wird eine eigene
3D-Schicht gebraucht; Szenen-Feed und Rechenwege sind dafür vorbereitet (siehe ADR-0022,
„Konsequenzen").
