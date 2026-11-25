# ADR-0022: 3D-Ausgabe als native Mac-App (Swift, RealityKit)

- Status: Angenommen
- Datum: 2026-11-25

## Kontext

Neben der 2D-Leitstelle (Windows, Android) soll es eine **3D-Ausgabe** geben, die das Geschehen so
zeigt, wie es in echt aussähe: der **Leitstellenraum** mit Arbeitsplätzen, Monitoren und Kollegen,
und **draußen der Landkreis** mit fahrenden Einsatzfahrzeugen. Zuerst als Mac-App, später für
Android. Der Product Owner hat entschieden:

- 3D: Leitstellenraum **und** Landkreis (beides kombiniert),
- Technik: **nativ in Swift mit RealityKit**.

Weiter gelten: deterministischer Kern ohne Plattformcode (ADR-0004), keine Spiellogik im UI
(Regel 4), offline (Regel 6), nur eigene Assets (Regel 2).

## Entscheidung

1. **Hybrid aus nativ und gemeinsamem Code** (`apps/mac3d`):
   - **Simulation und Leitstellen-Software** laufen unverändert aus dem TypeScript-Code in einem
     `WKWebView` – Sim-Host im Web Worker wie auf Android (`packages/web-host`, ADR-0021).
     Notrufabfrage, Disposition und alle Dialoge sind damit dieselben wie auf Windows.
   - **3D in RealityKit (Swift):** Leitstellenraum und Landkreis. Die Monitore im Raum zeigen ein
     Live-Bild der Leitstellen-Software (Schnappschuss je Sekunde als Textur).
2. **Szenen-Feed:** Der Web-Teil schickt der Swift-Hülle über `WKScriptMessageHandler` die Welt
   einmal (Straßen, Fluss, Wälder, Häuser, Wachen, Kliniken in lokalen Metern) und die Lage bis zu
   10-mal je Sekunde (Fahrzeuge, Einsätze, Tageszeit, Wetter, wartende Notrufe). Swift gleitet die
   Fahrzeuge flüssig nach (`VehicleTrack`). Klicks in 3D gehen als Befehle zurück
   (`window.ls112Shell`: Fahrzeug fokussieren, Einsatz öffnen, Notruf annehmen).
3. **Drei Ansichten** in einem Fenster: _Leitstelle_ (3D-Raum), _Arbeitsplatz_ (die Software
   bildschirmfüllend), _Lage 3D_ (Landkreis). Der WKWebView bleibt immer im Fenster, damit die
   Simulation ungebremst weiterläuft (`inactiveSchedulingPolicy = .none`).
4. **Alles prozedural:** Gelände, Felder, Straßen, Häuser mit Satteldach und Fenstern, Bäume,
   Wachen, Kliniken, Fahrzeuge (RTW, KTW, NEF, Löschfahrzeug, Drehleiter, ELW, RTH) und der Raum
   entstehen zur Laufzeit aus Geometrie (`MeshBuilder`). Keine fremden Modelle oder Texturen.
   Licht: Sonne nach Tageszeit, Mond, Himmel als Umgebungslicht, nachts beleuchtete Fenster,
   Regen und Schnee als Partikel, Blaulicht blinkt bei Sonderrechten.
5. **Swift-Paket ohne Xcode-Projekt**, macOS 26: `Leitstelle3DKit` (reine Rechenwege, getestet mit
   Swift Testing) und die App. `build.sh` baut, bündelt den Web-Teil und signiert.
6. **Prüfmodus:** `LS112_SNAPSHOT_DIR` startet ein Spiel und rendert die Ansichten offscreen
   (`RealityRenderer`) als PNG – Grundlage für Bild-Prüfungen ohne Bildschirmaufnahme.

## Alternativen

- **Alles in Swift neu schreiben (auch Simulation):** zwei Kerne, Determinismus nicht zu halten
  (ADR-0004). Verworfen.
- **Sim-Kern in JavaScriptCore direkt aus Swift:** möglich, aber dann müsste die komplette
  Leitstellen-Oberfläche (Notrufmaske, Disposition, …) in SwiftUI nachgebaut werden. Der WKWebView
  liefert sie ohne Doppelarbeit.
- **Three.js im gemeinsamen Web-Code:** wäre auf Android sofort nutzbar, vom Product Owner zugunsten
  der nativen Grafik verworfen.
- **Spiel-Engine (Godot):** sehr realistische Grafik möglich, aber neue Werkzeugkette und Anbindung
  des Kerns. Verworfen.

## Konsequenzen

- Simulation, Inhalte, Mods, Spielstände und Bedienung sind dieselben wie auf Windows und Android.
- Die 3D-Darstellung ist **Mac-only**. Für Android braucht es eine eigene 3D-Schicht (z. B.
  SceneView/Filament über Capacitor-Plugin oder eine native Android-Hülle). Wiederverwendbar sind
  der Szenen-Feed (`apps/mac3d/web/src/scene-feed.ts`) und die Rechenwege in `Leitstelle3DKit`
  (als Vorlage). Das ist eine eigene Folgeentscheidung.
- Grafik ist stilisiert-realistisch aus Grundformen; detailliertere Modelle (eigene oder frei
  lizenzierte USDZ) lassen sich später je Fahrzeugklasse austauschen.
- Die CI baut und testet die Mac-App auf einem macOS-Runner.
