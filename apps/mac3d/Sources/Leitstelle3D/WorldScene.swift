// Der Landkreis in 3D (ADR-0022): aus den Weltdaten der Simulation erzeugt – Gelände, Straßen,
// Fluss, Wälder, Häuser, Wachen, Kliniken – plus Fahrzeuge und Einsatzstellen aus der Lage.

import AppKit
import Leitstelle3DKit
import RealityKit

@MainActor
final class WorldScene {
    let root = Entity()
    let camera = PerspectiveCamera()
    var orbit = OrbitCamera(target: .zero, distance: 9_000, yaw: 0.35, pitch: 0.75)

    private(set) var frame = WorldFrame(width: 1, height: 1)
    private let staticLayer = Entity()
    private let dynamicLayer = Entity()
    private let sun = DirectionalLight()
    private let skyLight = Entity()
    private var weather: Entity?
    private var vehicles: [String: VehicleNode] = [:]
    private var incidents: [String: IncidentNode] = [:]
    private var builtWorld: SceneWorld?
    private var lastLightHour: Double = -10
    /// Für Prüfbilder: feste Tageszeit statt der Spielzeit.
    var forcedHour: Double?
    /// Fenster leuchten nachts warm, tagsüber spiegeln sie dunkel.
    private var windowEntity: ModelEntity?
    private let windowDay = Materials.pbr(Materials.rgb(0.1, 0.12, 0.15), roughness: 0.35)
    private let windowNight = Materials.glow(Materials.rgb(1, 0.8, 0.5), intensity: 2.5)
    private var lastWeather = ""
    private var clock: Double = 0
    /// Aktueller Himmel – die Ansicht setzt ihn als Hintergrund.
    private(set) var sky: EnvironmentResource?

    init() {
        root.addChild(staticLayer)
        root.addChild(dynamicLayer)
        root.addChild(camera)
        root.addChild(sun)
        root.addChild(skyLight)
        sun.light.intensity = 9_000
        sun.shadow = DirectionalLightComponent.Shadow(maximumDistance: 3_000, depthBias: 4)
        camera.camera.fieldOfViewInDegrees = 50
    }

    // MARK: Welt aufbauen

    func build(_ world: SceneWorld) {
        guard world != builtWorld else { return }
        builtWorld = world
        staticLayer.children.removeAll()
        vehicles.values.forEach { $0.root.removeFromParent() }
        vehicles.removeAll()
        incidents.values.forEach { $0.root.removeFromParent() }
        incidents.removeAll()
        frame = WorldFrame(width: world.width, height: world.height)
        orbit = OrbitCamera(target: .zero, distance: frame.extent * 0.75, yaw: 0.35, pitch: 0.78)
        orbit.maxDistance = frame.extent * 1.6

        ground(world)
        roads(world)
        rivers(world)
        forests(world)
        houses(world)
        stations(world)
        hospitals(world)
        townLabels(world)
        applyLighting(hour: 12)
    }

    private func ground(_ world: SceneWorld) {
        let margin: Float = 6_000
        let plane = ModelEntity(
            mesh: .generatePlane(width: Float(world.width) + margin, depth: Float(world.height) + margin),
            materials: [Materials.pbr(Materials.rgb(0.33, 0.43, 0.22), roughness: 1)]
        )
        staticLayer.addChild(plane)
        // Feldstruktur: Äcker und Wiesen als gedrehte Rechtecke in mehreren Tönen – nicht in Orten
        // und Wäldern, damit nichts durchscheint.
        let tones = [Materials.rgb(0.47, 0.5, 0.28), Materials.rgb(0.29, 0.38, 0.19), Materials.rgb(0.52, 0.46, 0.3),
                     Materials.rgb(0.38, 0.45, 0.24), Materials.rgb(0.42, 0.36, 0.25)]
        var fields = Array(repeating: MeshBuilder(), count: tones.count)
        let forestBoxes = world.forests.map { f -> (SIMD2<Double>, SIMD2<Double>) in
            let pts = stride(from: 0, to: f.count - 1, by: 2).map { SIMD2(f[$0], f[$0 + 1]) }
            return (pts.reduce(pts.first ?? .zero) { simd_min($0, $1) } - 80, pts.reduce(pts.first ?? .zero) { simd_max($0, $1) } + 80)
        }
        let step = 420.0
        var y = step / 2
        while y < world.height {
            var x = step / 2
            while x < world.width {
                let c = SIMD2(x, y)
                let inTown = world.towns.contains { hypot($0.x - x, $0.y - y) < ($0.city ? 1_300 : 750) }
                let inForest = forestBoxes.contains { c.x > $0.0.x && c.y > $0.0.y && c.x < $0.1.x && c.y < $0.1.y }
                if !inTown, !inForest {
                    let r = positionHash(x, y, salt: 11)
                    let w = Float(step * (0.55 + positionHash(x, y, salt: 12) * 0.4))
                    let d = Float(step * (0.4 + positionHash(x, y, salt: 13) * 0.5))
                    let rot = Float(positionHash(x, y, salt: 14) * 0.6 - 0.3)
                    let p = frame.point(x, y, height: 0.03)
                    let cs = cos(rot), sn = sin(rot)
                    let corner = { (u: Float, v: Float) in p + SIMD3(u * cs - v * sn, 0, u * sn + v * cs) }
                    fields[Int(r * Double(tones.count)) % tones.count].quad(
                        corner(-w / 2, d / 2), corner(w / 2, d / 2), corner(w / 2, -d / 2), corner(-w / 2, -d / 2))
                }
                x += step
            }
            y += step
        }
        for k in tones.indices { add(fields[k], Materials.pbr(tones[k], roughness: 1)) }
    }

    private func roads(_ world: SceneWorld) {
        var asphalt = MeshBuilder(), motorway = MeshBuilder(), lines = MeshBuilder()
        for r in world.roads where r.count >= 5 {
            let cls = Int(r[0])
            let p = frame.point(r[1], r[2], height: 0.12), q = frame.point(r[3], r[4], height: 0.12)
            let w = roadWidth(forClass: cls)
            if cls == 0 { motorway.strip(from: p, to: q, width: w) } else { asphalt.strip(from: p, to: q, width: w) }
            if cls <= 2 {
                lines.strip(from: p + SIMD3(0, 0.03, 0), to: q + SIMD3(0, 0.03, 0), width: 0.18)
            }
        }
        add(asphalt, Materials.pbr(Materials.rgb(0.2, 0.2, 0.21), roughness: 0.92))
        add(motorway, Materials.pbr(Materials.rgb(0.27, 0.27, 0.28), roughness: 0.9))
        add(lines, Materials.pbr(Materials.rgb(0.9, 0.9, 0.86), roughness: 0.6))
    }

    private func rivers(_ world: SceneWorld) {
        var water = MeshBuilder(), bank = MeshBuilder()
        for river in world.rivers {
            let pts = stride(from: 0, to: river.points.count - 1, by: 2).map {
                frame.point(river.points[$0], river.points[$0 + 1], height: 0.06)
            }
            for k in pts.indices.dropLast() {
                bank.strip(from: pts[k] - SIMD3(0, 0.02, 0), to: pts[k + 1] - SIMD3(0, 0.02, 0), width: Float(river.width) + 10)
                water.strip(from: pts[k], to: pts[k + 1], width: Float(river.width))
            }
        }
        add(bank, Materials.pbr(Materials.rgb(0.42, 0.4, 0.3), roughness: 1))
        add(water, Materials.pbr(Materials.rgb(0.12, 0.25, 0.36), roughness: 0.08, metallic: 0.3))
    }

    private func forests(_ world: SceneWorld) {
        var floor = MeshBuilder(), crowns = MeshBuilder(), crownsLight = MeshBuilder(), trunks = MeshBuilder()
        var trees = 0
        for f in world.forests {
            let pts = stride(from: 0, to: f.count - 1, by: 2).map { frame.point(f[$0], f[$0 + 1], height: 0.08) }
            floor.polygon(pts, triangles: triangulate(f))
            for t in scatter(in: f, density: 140, limit: max(0, 9_000 - trees)) {
                let r = positionHash(t.x, t.y, salt: 21)
                let h = Float(14 + r * 12)
                let base = frame.point(t.x, t.y)
                trunks.cylinder(base: base, radius: 0.35, height: h * 0.35, segments: 5)
                if r < 0.55 { crowns.cone(base: base + SIMD3(0, h * 0.25, 0), radius: Float(2.6 + r * 1.5), height: h * 0.8) }
                else { crownsLight.cone(base: base + SIMD3(0, h * 0.3, 0), radius: Float(3.4 + r), height: h * 0.65, segments: 6) }
                trees += 1
            }
        }
        add(floor, Materials.pbr(Materials.rgb(0.16, 0.25, 0.12), roughness: 1))
        add(trunks, Materials.pbr(Materials.rgb(0.28, 0.2, 0.13), roughness: 1))
        add(crowns, Materials.pbr(Materials.rgb(0.1, 0.24, 0.1), roughness: 0.95))
        add(crownsLight, Materials.pbr(Materials.rgb(0.2, 0.33, 0.13), roughness: 0.95))
    }

    private func houses(_ world: SceneWorld) {
        let buildings = makeHouses(world.houses, frame: frame, towns: world.towns)
        var walls = Array(repeating: MeshBuilder(), count: 4)
        var roofs = Array(repeating: MeshBuilder(), count: 2)
        var windows = MeshBuilder()
        for b in buildings {
            windows.windows(base: b.center, width: b.width, depth: b.depth, wallHeight: b.wallHeight, rotation: b.rotation)
            walls[b.variant].box(base: b.center, width: b.width, depth: b.depth, height: b.wallHeight, rotation: b.rotation)
            roofs[b.variant % 2].gableRoof(base: b.center, width: b.width, depth: b.depth, wallHeight: b.wallHeight,
                                           roofHeight: b.roofHeight, rotation: b.rotation)
        }
        let wallColors = [Materials.rgb(0.92, 0.9, 0.84), Materials.rgb(0.86, 0.8, 0.68),
                          Materials.rgb(0.78, 0.78, 0.76), Materials.rgb(0.66, 0.36, 0.28)]
        for k in 0..<4 { add(walls[k], Materials.pbr(wallColors[k], roughness: 0.9)) }
        add(roofs[0], Materials.pbr(Materials.rgb(0.6, 0.2, 0.14), roughness: 0.75))
        add(roofs[1], Materials.pbr(Materials.rgb(0.22, 0.22, 0.24), roughness: 0.7))
        if let e = windows.entity(windowDay) {
            staticLayer.addChild(e)
            windowEntity = e
        }
    }

    private func stations(_ world: SceneWorld) {
        for s in world.stations {
            let base = frame.point(s.x, s.y)
            let node = Entity()
            node.position = base
            var hall = MeshBuilder(), doors = MeshBuilder(), accent = MeshBuilder()
            let wall: NSColor, accentColor: NSColor
            switch s.kind {
            case .feuerwache:
                hall.box(base: .zero, width: 32, depth: 18, height: 8)
                accent.box(base: SIMD3(-19, 0, -4), width: 5, depth: 5, height: 18) // Schlauchturm
                for k in 0..<3 { doors.box(base: SIMD3(-10 + Float(k) * 10, 0, -9.05), width: 7, depth: 0.2, height: 5.2) }
                wall = Materials.rgb(0.62, 0.3, 0.24); accentColor = Materials.rgb(0.55, 0.26, 0.2)
            case .luftrettung:
                hall.box(base: .zero, width: 22, depth: 22, height: 8)
                doors.box(base: SIMD3(0, 0, -11.05), width: 16, depth: 0.2, height: 6.5)
                accent.cylinder(base: SIMD3(0, 0.1, -32), radius: 12, height: 0.15, segments: 24) // Landeplatz
                wall = Materials.rgb(0.7, 0.72, 0.74); accentColor = Materials.rgb(0.35, 0.36, 0.38)
            case .rettungswache, .notarztstandort:
                let small = s.kind == .notarztstandort
                hall.box(base: .zero, width: small ? 14 : 26, depth: small ? 11 : 15, height: small ? 4.5 : 6)
                accent.box(base: SIMD3(0, small ? 3.2 : 4.2, 0), width: small ? 14.1 : 26.1, depth: small ? 11.1 : 15.1, height: 0.7)
                for k in 0..<(small ? 1 : 3) { doors.box(base: SIMD3(-8 + Float(k) * 8, 0, small ? -5.55 : -7.55), width: 5, depth: 0.2, height: 3.6) }
                wall = Materials.rgb(0.94, 0.94, 0.92); accentColor = Materials.rgb(0.95, 0.25, 0.12)
            }
            if let e = hall.entity(Materials.pbr(wall, roughness: 0.85)) { node.addChild(e) }
            if let e = accent.entity(Materials.pbr(accentColor, roughness: 0.7)) { node.addChild(e) }
            if let e = doors.entity(Materials.pbr(Materials.rgb(0.55, 0.08, 0.06), roughness: 0.5, metallic: 0.3)) { node.addChild(e) }
            let label = Labels.make(s.name, size: 4, color: .white, background: Materials.rgb(0.07, 0.1, 0.14, 0.85))
            label.position = SIMD3(0, 26, 0)
            node.addChild(label)
            staticLayer.addChild(node)
        }
    }

    private func hospitals(_ world: SceneWorld) {
        for h in world.hospitals {
            let node = Entity()
            node.position = frame.point(h.x, h.y)
            var block = MeshBuilder(), cross = MeshBuilder(), pad = MeshBuilder()
            block.box(base: .zero, width: 70, depth: 38, height: 22)
            block.box(base: SIMD3(-22, 0, 30), width: 26, depth: 24, height: 14)
            block.box(base: SIMD3(30, 0, 28), width: 18, depth: 20, height: 6) // Liegendanfahrt
            cross.box(base: SIMD3(20, 22, 0), width: 14, depth: 4, height: 0.4)
            cross.box(base: SIMD3(20, 22, 0), width: 4, depth: 14, height: 0.4)
            pad.cylinder(base: SIMD3(-18, 22, 0), radius: 9, height: 0.3, segments: 24)
            if let e = block.entity(Materials.pbr(Materials.rgb(0.9, 0.91, 0.92), roughness: 0.6)) { node.addChild(e) }
            if let e = cross.entity(Materials.pbr(Materials.rgb(0.85, 0.08, 0.08), roughness: 0.5)) { node.addChild(e) }
            if let e = pad.entity(Materials.pbr(Materials.rgb(0.25, 0.4, 0.3), roughness: 0.8)) { node.addChild(e) }
            let label = Labels.make("🏥 \(h.name)", size: 5, color: .white, background: Materials.rgb(0.12, 0.3, 0.6, 0.9))
            label.position = SIMD3(0, 40, 0)
            node.addChild(label)
            staticLayer.addChild(node)
        }
    }

    private func townLabels(_ world: SceneWorld) {
        for t in world.towns {
            let label = Labels.make(t.name, size: t.city ? 40 : 26, color: Materials.rgb(1, 1, 1, 0.95))
            label.position = frame.point(t.x, t.y, height: t.city ? 260 : 170)
            staticLayer.addChild(label)
        }
    }

    // MARK: Lage

    func apply(_ state: SceneState) {
        var seen = Set<String>()
        for v in state.vehicles {
            seen.insert(v.id)
            let node: VehicleNode
            if let existing = vehicles[v.id] { node = existing } else {
                node = VehicleNode(id: v.id, label: v.label, cls: v.cls, x: v.x, y: v.y)
                vehicles[v.id] = node
                dynamicLayer.addChild(node.root)
            }
            node.track.update(x: v.x, y: v.y)
            node.root.components.set(VehicleStateComponent(emergency: v.emergency, moving: v.moving))
        }
        for (id, node) in vehicles where !seen.contains(id) {
            node.root.removeFromParent()
            vehicles[id] = nil
        }

        var open = Set<String>()
        for i in state.incidents {
            open.insert(i.id)
            if incidents[i.id] == nil {
                let node = IncidentNode(id: i.id, label: i.label, cls: i.cls)
                node.root.position = frame.point(i.x, i.y)
                incidents[i.id] = node
                dynamicLayer.addChild(node.root)
            }
        }
        for (id, node) in incidents where !open.contains(id) {
            node.root.removeFromParent()
            incidents[id] = nil
        }

        let hour = forcedHour ?? state.hour
        if abs(hour - lastLightHour) > 0.2 { applyLighting(hour: hour) }
        if state.weatherId != lastWeather { applyWeather(state.weatherId) }
    }

    func vehiclePosition(_ id: String) -> SIMD3<Float>? {
        vehicles[id].map { frame.point($0.track.shown.x, $0.track.shown.y) }
    }

    // MARK: Je Bild

    func tick(dt: Double, followId: String?) {
        clock += dt
        let blink = Int(clock * 6) % 2 == 0
        // Fahrzeuge bleiben auch aus großer Höhe erkennbar (wie Kartensymbole, nur in 3D).
        let enlarge = min(max(orbit.distance / 450, 1), 22)
        for (_, node) in vehicles {
            node.track.advance(dt: dt)
            let state = node.root.components[VehicleStateComponent.self]
            let flying = node.cls == .rth && (state?.moving ?? false)
            node.root.position = frame.point(node.track.shown.x, node.track.shown.y, height: flying ? 140 : 0)
            node.root.orientation = simd_quatf(angle: Float(-node.track.heading), axis: SIMD3(0, 1, 0))
            node.root.scale = SIMD3(repeating: enlarge)
            node.setBeacons(on: (state?.emergency ?? false) && blink)
            if node.cls == .rth, flying { node.spinRotor(by: Float(dt) * 40) }
        }
        let phase = Float(clock.truncatingRemainder(dividingBy: 1.2) / 1.2)
        for (_, node) in incidents {
            node.pulse(phase)
            node.root.scale = SIMD3(repeating: min(max(enlarge * 0.6, 1), 12))
        }
        if let id = followId, let p = vehiclePosition(id) {
            orbit.follow(p, smoothing: Float(min(1, dt * 3)))
        }
        updateCamera()
    }

    func updateCamera() {
        camera.camera.near = max(0.5, orbit.distance * 0.002)
        camera.camera.far = frame.extent * 4
        camera.look(at: orbit.target, from: orbit.position, relativeTo: nil)
    }

    // MARK: Licht und Wetter

    func applyLighting(hour: Double) {
        lastLightHour = hour
        let day = daylight(hour: hour)
        if day > 0.02 {
            sun.look(at: sunDirection(hour: hour), from: .zero, relativeTo: nil)
            sun.light.intensity = 1_500 + 9_000 * day
            // Morgens und abends wärmer.
            sun.light.color = day < 0.55 ? Materials.rgb(1, 0.8, 0.6) : .white
        } else {
            // Nachts Mondlicht von oben: schwach und kühl, damit die Welt nicht schwarz ist.
            sun.look(at: simd_normalize(SIMD3<Float>(0.35, -1, 0.25)), from: .zero, relativeTo: nil)
            sun.light.intensity = 900
            sun.light.color = Materials.rgb(0.6, 0.7, 1)
        }
        windowEntity?.model?.materials = [day < 0.35 ? windowNight : windowDay]
        if let env = Sky.environment(daylight: day) {
            skyLight.components.set(ImageBasedLightComponent(source: .single(env), intensityExponent: day > 0.02 ? 0.8 : -0.2))
            sky = env
            applyReceivers(root)
        }
    }

    private func applyReceivers(_ entity: Entity) {
        if entity is ModelEntity { entity.components.set(ImageBasedLightReceiverComponent(imageBasedLight: skyLight)) }
        for child in entity.children { applyReceivers(child) }
    }

    /// Regen oder Schnee als Partikel um die Kamera.
    private func applyWeather(_ id: String) {
        lastWeather = id
        weather?.removeFromParent()
        weather = nil
        let lower = id.lowercased()
        let snowing = lower.contains("schnee")
        guard snowing || lower.contains("regen") || lower.contains("gewitter") else { return }
        var p = ParticleEmitterComponent()
        p.emitterShape = .box
        p.emitterShapeSize = SIMD3(400, 1, 400)
        p.emissionDirection = SIMD3(0, -1, 0)
        p.speed = snowing ? 3 : 25
        p.mainEmitter.birthRate = snowing ? 1_500 : 4_000
        p.mainEmitter.lifeSpan = snowing ? 12 : 3
        p.mainEmitter.size = snowing ? 0.25 : 0.06
        p.mainEmitter.color = .constant(.single(snowing ? .white : Materials.rgb(0.7, 0.75, 0.85, 0.6)))
        let e = Entity()
        e.components.set(p)
        e.position = SIMD3(0, 60, 0)
        camera.addChild(e)
        weather = e
    }

    private func add(_ mesh: MeshBuilder, _ material: PhysicallyBasedMaterial) {
        if let e = mesh.entity(material) { staticLayer.addChild(e) }
    }
}

/// Merkt sich je Fahrzeug, ob es mit Sonderrechten fährt (für Blaulicht und Flughöhe).
struct VehicleStateComponent: Component {
    var emergency: Bool
    var moving: Bool
}
