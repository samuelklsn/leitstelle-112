// Prüfmodus ohne Bildschirmaufnahme: `LS112_SNAPSHOT_DIR=<ordner>` startet ein Spiel, lässt es
// kurz laufen und rendert Lage 3D und Leitstellenraum offscreen (RealityRenderer) als PNG, dazu
// ein Bild des Arbeitsplatzes. Danach beendet sich die App. Für Entwicklung und CI-Bilder.

import AppKit
import Leitstelle3DKit
import Metal
import RealityKit
import UniformTypeIdentifiers

@MainActor
enum SnapshotRunner {
    static var directory: URL? {
        ProcessInfo.processInfo.environment["LS112_SNAPSHOT_DIR"].map { URL(filePath: $0) }
    }

    static func run(model: AppModel) async {
        guard let dir = directory else { return }
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        model.mode = .workstation
        // Warten, bis der Web-Teil läuft, dann ein Spiel mit Zeitraffer starten.
        for _ in 0..<60 where !model.ready { try? await Task.sleep(for: .milliseconds(500)) }
        model.web.shell("startDemo()")
        let seconds = Double(ProcessInfo.processInfo.environment["LS112_SNAPSHOT_SECONDS"] ?? "") ?? 25
        try? await Task.sleep(for: .seconds(seconds))
        log("Lage: \(model.state?.vehicles.count ?? 0) Fahrzeuge, \(model.state?.incidents.count ?? 0) Einsätze, \(model.state?.clock ?? "-")")

        if let image = await model.web.snapshot() { write(image, to: dir.appending(path: "arbeitsplatz.png")) }

        if let world = model.world, let state = model.state {
            let scene = WorldScene()
            scene.build(world)
            scene.apply(state)
            for _ in 0..<30 { scene.tick(dt: 1.0 / 30, followId: nil) }
            render(scene.root, camera: scene.camera, sky: scene.sky, to: dir.appending(path: "lage-uebersicht.png"))
            // Dieselbe Lage am Mittag – Spielbeginn ist oft vor Sonnenaufgang.
            scene.forcedHour = 13
            scene.applyLighting(hour: 13)
            render(scene.root, camera: scene.camera, sky: scene.sky, to: dir.appending(path: "lage-mittag.png"))

            if let station = world.stations.first {
                scene.orbit = OrbitCamera(target: scene.frame.point(station.x, station.y), distance: 520, yaw: 0.6, pitch: 0.42)
                scene.tick(dt: 1.0 / 30, followId: nil)
                render(scene.root, camera: scene.camera, sky: scene.sky, to: dir.appending(path: "lage-wache.png"))
            }
            if let vehicle = state.vehicles.first(where: { $0.moving }) ?? state.vehicles.first,
               let p = scene.vehiclePosition(vehicle.id) {
                scene.orbit = OrbitCamera(target: p, distance: 70, yaw: 2.2, pitch: 0.3)
                scene.tick(dt: 1.0 / 30, followId: nil)
                render(scene.root, camera: scene.camera, sky: scene.sky, to: dir.appending(path: "lage-fahrzeug.png"))
            }
            if let incident = state.incidents.first {
                scene.orbit = OrbitCamera(target: scene.frame.point(incident.x, incident.y), distance: 260, yaw: 1.1, pitch: 0.5)
                scene.tick(dt: 1.0 / 30, followId: nil)
                render(scene.root, camera: scene.camera, sky: scene.sky, to: dir.appending(path: "lage-einsatz.png"))
            }
        } else {
            log("Keine Weltdaten erhalten – Lage 3D nicht gerendert")
        }

        let room = RoomScene()
        if let image = await model.web.snapshot() { room.setScreen(image) }
        room.setRinging(true)
        room.tick(dt: 0)
        render(room.root, camera: room.camera, sky: Sky.environment(daylight: 0.6), to: dir.appending(path: "leitstelle.png"))
        room.yaw = 0.9
        room.updateCamera()
        render(room.root, camera: room.camera, sky: Sky.environment(daylight: 0.6), to: dir.appending(path: "leitstelle-seite.png"))

        log("Bilder gespeichert in \(dir.path)")
        await model.web.suspend()
        NSApp.terminate(nil)
    }

    /// Rendert eine Szene offscreen in eine PNG-Datei.
    static func render(_ root: Entity, camera: Entity, sky: EnvironmentResource?, to url: URL, width: Int = 1600, height: Int = 900) {
        guard let device = MTLCreateSystemDefaultDevice() else { return log("Kein Metal-Gerät") }
        let desc = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .bgra8Unorm_srgb, width: width, height: height, mipmapped: false)
        desc.usage = [.renderTarget, .shaderRead, .shaderWrite]
        desc.storageMode = .shared
        guard let texture = device.makeTexture(descriptor: desc) else { return log("Keine Textur") }
        do {
            let renderer = try RealityRenderer()
            let parent = root.parent
            root.removeFromParent()
            renderer.entities.append(root)
            renderer.activeCamera = camera
            renderer.lighting.resource = sky
            renderer.lighting.intensityExponent = 0
            renderer.cameraSettings.colorBackground = .color(CGColor(srgbRed: 0.55, green: 0.68, blue: 0.85, alpha: 1))
            let output = try RealityRenderer.CameraOutput(.singleProjection(colorTexture: texture))
            let done = DispatchSemaphore(value: 0)
            // Mehrere Durchgänge, damit Schatten und Partikel stehen.
            for pass in 0..<4 {
                try renderer.updateAndRender(deltaTime: 1.0 / 30, cameraOutput: output, onComplete: { _ in
                    if pass == 3 { done.signal() }
                })
            }
            _ = done.wait(timeout: .now() + 20)
            renderer.entities.removeAll()
            parent?.addChild(root)
            let bytesPerRow = width * 4
            var bytes = [UInt8](repeating: 0, count: bytesPerRow * height)
            texture.getBytes(&bytes, bytesPerRow: bytesPerRow, from: MTLRegionMake2D(0, 0, width, height), mipmapLevel: 0)
            let space = CGColorSpace(name: CGColorSpace.sRGB)!
            let info = CGBitmapInfo.byteOrder32Little.rawValue | CGImageAlphaInfo.premultipliedFirst.rawValue
            guard let ctx = CGContext(data: &bytes, width: width, height: height, bitsPerComponent: 8,
                                      bytesPerRow: bytesPerRow, space: space, bitmapInfo: info),
                  let image = ctx.makeImage() else { return log("Bild nicht erzeugt") }
            write(image, to: url)
        } catch {
            log("Rendern fehlgeschlagen: \(error)")
        }
    }

    static func write(_ image: CGImage, to url: URL) {
        guard let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) else { return }
        CGImageDestinationAddImage(dest, image, nil)
        CGImageDestinationFinalize(dest)
        log("geschrieben: \(url.lastPathComponent)")
    }

    static func log(_ text: String) {
        FileHandle.standardError.write(Data("[snapshot] \(text)\n".utf8))
    }
}
