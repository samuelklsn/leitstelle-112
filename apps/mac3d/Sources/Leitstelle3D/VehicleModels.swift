// Fahrzeug- und Einsatzmodelle aus einfacher Geometrie (Eigenwerk). Maße in Metern, angelehnt an
// typische Fahrzeuge in Deutschland; Lackierung nach Art (Rettungsdienst weiß mit Leuchtrot,
// Feuerwehr Rot mit weißem Streifen). Front zeigt nach -z (Norden).

import AppKit
import Leitstelle3DKit
import RealityKit

/// Ein Fahrzeug in der Szene mit den Teilen, die sich bewegen oder leuchten.
@MainActor
final class VehicleNode {
    let root = Entity()
    let body = Entity()
    /// Blaulichter: wechseln im Takt zwischen hell und dunkel.
    private(set) var beacons: [ModelEntity] = []
    /// Rotor des Hubschraubers.
    private(set) var rotor: Entity?
    let cls: VehicleClass
    var track: VehicleTrack

    static let beaconOn = Materials.glow(Materials.rgb(0.25, 0.45, 1), intensity: 6)
    static let beaconOff = Materials.pbr(Materials.rgb(0.1, 0.14, 0.35), roughness: 0.3)

    init(id: String, label: String, cls: VehicleClass, x: Double, y: Double) {
        self.cls = cls
        track = VehicleTrack(x: x, y: y)
        root.name = "vehicle:\(id)"
        root.addChild(body)
        build(label: label)
        let tag = Labels.make(label, size: 1.1, color: .white, background: Materials.rgb(0.05, 0.08, 0.12, 0.85))
        tag.position = SIMD3(0, cls == .rth ? 5 : 5.2, 0)
        root.addChild(tag)
        root.makeTappable(size: SIMD3(4, 5, 9), offset: SIMD3(0, 2, 0))
    }

    func setBeacons(on: Bool) {
        for b in beacons { b.model?.materials = [on ? Self.beaconOn : Self.beaconOff] }
    }

    func spinRotor(by angle: Float) {
        rotor?.orientation *= simd_quatf(angle: angle, axis: SIMD3(0, 1, 0))
    }

    // MARK: Modelle

    private func build(label: String) {
        let white = Materials.pbr(Materials.rgb(0.93, 0.93, 0.9), roughness: 0.35, metallic: 0.1)
        let red = Materials.pbr(Materials.rgb(0.75, 0.05, 0.05), roughness: 0.35, metallic: 0.1)
        let signal = Materials.pbr(Materials.rgb(0.95, 0.2, 0.1), roughness: 0.4)
        let glass = Materials.pbr(Materials.rgb(0.08, 0.1, 0.13), roughness: 0.05, metallic: 0.6)
        let tyre = Materials.pbr(Materials.rgb(0.05, 0.05, 0.05), roughness: 0.9)
        let yellow = Materials.pbr(Materials.rgb(0.95, 0.75, 0.1), roughness: 0.4)

        switch cls {
        case .rth:
            helicopter(white: white, red: signal, glass: glass)
            return
        case .fire:
            // Löschfahrzeug: Fahrerhaus und Aufbau, weißer Streifen, Drehleiter bei „DL".
            truck(length: 8.2, width: 2.5, height: 3.2, cab: 2.2, paint: red, stripe: white, glass: glass, tyre: tyre)
            if label.uppercased().contains("DL") {
                var ladder = MeshBuilder()
                ladder.box(base: SIMD3(0, 3.2, 0.8), width: 0.9, depth: 7.5, height: 0.5)
                if let e = ladder.entity(Materials.pbr(Materials.rgb(0.75, 0.75, 0.72), roughness: 0.3, metallic: 0.8)) { body.addChild(e) }
            }
        case .rtw:
            truck(length: 6.9, width: 2.3, height: 2.9, cab: 1.9, paint: white, stripe: signal, glass: glass, tyre: tyre)
        case .ktw:
            van(length: 5.6, width: 2.0, height: 2.5, paint: white, stripe: signal, glass: glass, tyre: tyre)
        case .nef:
            car(paint: white, stripe: signal, glass: glass, tyre: tyre)
        case .command:
            van(length: 5.3, width: 2.0, height: 2.2, paint: red, stripe: white, glass: glass, tyre: tyre)
        case .other:
            van(length: 5.3, width: 2.0, height: 2.3, paint: white, stripe: yellow, glass: glass, tyre: tyre)
        }
    }

    /// Kastenwagen mit Fahrerhaus vorn (RTW, Feuerwehr).
    private func truck(length: Float, width: Float, height: Float, cab: Float, paint: PhysicallyBasedMaterial,
                       stripe: PhysicallyBasedMaterial, glass: PhysicallyBasedMaterial, tyre: PhysicallyBasedMaterial) {
        let front = -length / 2
        var shell = MeshBuilder()
        shell.box(base: SIMD3(0, 0.5, front + cab / 2), width: width - 0.1, depth: cab, height: height * 0.78 - 0.5)
        shell.box(base: SIMD3(0, 0.5, front + cab + (length - cab) / 2), width: width, depth: length - cab, height: height - 0.5)
        add(shell, paint)
        var band = MeshBuilder()
        band.box(base: SIMD3(0, 1.1, 0), width: width + 0.04, depth: length - 0.2, height: 0.45)
        add(band, stripe)
        var window = MeshBuilder()
        window.box(base: SIMD3(0, height * 0.45, front - 0.02), width: width - 0.3, depth: 0.1, height: height * 0.28)
        add(window, glass)
        wheels(length: length, width: width, tyre: tyre)
        lightBar(z: front + cab / 2, y: height * 0.78, width: width - 0.4)
    }

    private func van(length: Float, width: Float, height: Float, paint: PhysicallyBasedMaterial,
                     stripe: PhysicallyBasedMaterial, glass: PhysicallyBasedMaterial, tyre: PhysicallyBasedMaterial) {
        var shell = MeshBuilder()
        shell.box(base: SIMD3(0, 0.4, 0.3), width: width, depth: length - 0.6, height: height - 0.4)
        shell.box(base: SIMD3(0, 0.4, -length / 2 + 0.3), width: width - 0.1, depth: 0.6, height: (height - 0.4) * 0.6)
        add(shell, paint)
        var band = MeshBuilder()
        band.box(base: SIMD3(0, 0.95, 0.3), width: width + 0.04, depth: length - 0.8, height: 0.35)
        add(band, stripe)
        var window = MeshBuilder()
        window.box(base: SIMD3(0, height * 0.5, -length / 2 + 0.58), width: width - 0.2, depth: 0.08, height: height * 0.3)
        add(window, glass)
        wheels(length: length, width: width, tyre: tyre)
        lightBar(z: -length / 2 + 1.1, y: height, width: width - 0.4)
    }

    private func car(paint: PhysicallyBasedMaterial, stripe: PhysicallyBasedMaterial,
                     glass: PhysicallyBasedMaterial, tyre: PhysicallyBasedMaterial) {
        var shell = MeshBuilder()
        shell.box(base: SIMD3(0, 0.35, 0), width: 1.9, depth: 4.8, height: 0.8)
        shell.box(base: SIMD3(0, 1.15, 0.3), width: 1.75, depth: 2.6, height: 0.6)
        add(shell, paint)
        var band = MeshBuilder()
        band.box(base: SIMD3(0, 0.7, 0), width: 1.94, depth: 4.6, height: 0.22)
        add(band, stripe)
        var window = MeshBuilder()
        window.box(base: SIMD3(0, 1.2, -1.02), width: 1.6, depth: 0.06, height: 0.5)
        add(window, glass)
        wheels(length: 4.8, width: 1.9, tyre: tyre)
        lightBar(z: 0.2, y: 1.75, width: 1.2)
    }

    private func helicopter(white: PhysicallyBasedMaterial, red: PhysicallyBasedMaterial, glass: PhysicallyBasedMaterial) {
        var hull = MeshBuilder()
        hull.box(base: SIMD3(0, 0.6, 0), width: 1.8, depth: 4.2, height: 1.8)
        hull.box(base: SIMD3(0, 1.4, 4.2), width: 0.45, depth: 5, height: 0.5)
        hull.box(base: SIMD3(0, 1.4, 6.5), width: 0.15, depth: 0.8, height: 1.8)
        add(hull, red)
        var stripe = MeshBuilder()
        stripe.box(base: SIMD3(0, 1.3, 0.3), width: 1.84, depth: 3.4, height: 0.35)
        add(stripe, white)
        var window = MeshBuilder()
        window.box(base: SIMD3(0, 1.3, -2.12), width: 1.5, depth: 0.1, height: 0.9)
        add(window, glass)
        var skids = MeshBuilder()
        for side: Float in [-0.9, 0.9] { skids.box(base: SIMD3(side, 0, 0), width: 0.12, depth: 3.6, height: 0.12) }
        add(skids, Materials.pbr(Materials.rgb(0.2, 0.2, 0.22), roughness: 0.5, metallic: 0.7))
        let mast = Entity()
        mast.position = SIMD3(0, 2.55, 0)
        var blades = MeshBuilder()
        blades.box(base: .zero, width: 0.3, depth: 10.6, height: 0.06)
        blades.box(base: .zero, width: 10.6, depth: 0.3, height: 0.06)
        if let e = blades.entity(Materials.pbr(Materials.rgb(0.15, 0.15, 0.16), roughness: 0.6)) { mast.addChild(e) }
        body.addChild(mast)
        rotor = mast
    }

    private func wheels(length: Float, width: Float, tyre: PhysicallyBasedMaterial) {
        var m = MeshBuilder()
        for z in [-length / 2 + 1.1, length / 2 - 1.2] {
            for x in [-width / 2 + 0.05, width / 2 - 0.05] {
                m.box(base: SIMD3(x, 0, z), width: 0.3, depth: 0.9, height: 0.9)
            }
        }
        add(m, tyre)
    }

    /// Blaulichtbalken mit zwei Leuchten, die abwechselnd blitzen (siehe `setBeacons`).
    private func lightBar(z: Float, y: Float, width: Float) {
        for x in [-width / 2 + 0.2, width / 2 - 0.2] {
            var m = MeshBuilder()
            m.box(base: SIMD3(x, y, z), width: 0.42, depth: 0.32, height: 0.2)
            if let e = m.entity(Self.beaconOff) {
                body.addChild(e)
                beacons.append(e)
            }
        }
    }

    private func add(_ mesh: MeshBuilder, _ material: PhysicallyBasedMaterial) {
        if let e = mesh.entity(material) { body.addChild(e) }
    }
}

/// Einsatzstelle: Bodenmarkierung, Warnlicht und je nach Art Rauch oder Absperrung.
@MainActor
final class IncidentNode {
    let root = Entity()
    let ring: ModelEntity
    let cls: IncidentClass

    init(id: String, label: String, cls: IncidentClass) {
        self.cls = cls
        root.name = "incident:\(id)"
        let color: NSColor = switch cls {
        case .fire: Materials.rgb(1, 0.42, 0.05)
        case .th: Materials.rgb(1, 0.8, 0.1)
        case .mci: Materials.rgb(1, 0.55, 0.0)
        case .rd: Materials.rgb(1, 0.15, 0.12)
        }
        let radius: Float = cls == .mci ? 40 : 16
        var disc = MeshBuilder()
        disc.cylinder(base: SIMD3(0, 0.15, 0), radius: radius, height: 0.1, segments: 32)
        ring = disc.entity(Materials.glow(color.withAlphaComponent(1), intensity: 1.5)) ?? ModelEntity()
        root.addChild(ring)
        var pole = MeshBuilder()
        pole.cylinder(base: .zero, radius: 0.35, height: 12, segments: 8)
        if let e = pole.entity(Materials.pbr(Materials.rgb(0.8, 0.8, 0.8), roughness: 0.4, metallic: 0.6)) { root.addChild(e) }
        let beacon = ModelEntity(mesh: .generateSphere(radius: 1.6), materials: [Materials.glow(color, intensity: 8)])
        beacon.position = SIMD3(0, 13, 0)
        root.addChild(beacon)
        let tag = Labels.make("\(label)  \(id)", size: 1.6, color: .white, background: color.withAlphaComponent(0.9))
        tag.position = SIMD3(0, 17, 0)
        root.addChild(tag)
        if cls == .fire { root.addChild(Self.smoke()) }
        root.makeTappable(size: SIMD3(radius * 1.6, 20, radius * 1.6), offset: SIMD3(0, 8, 0))
    }

    /// Pulsieren der Markierung (Phase 0…1).
    func pulse(_ phase: Float) {
        let s = 0.85 + 0.25 * sin(phase * 2 * .pi)
        ring.scale = SIMD3(s, 1, s)
    }

    /// Dunkle Rauchsäule über einem Brand.
    private static func smoke() -> Entity {
        let e = Entity()
        var p = ParticleEmitterComponent()
        p.emitterShape = .sphere
        p.emitterShapeSize = SIMD3(6, 2, 6)
        p.birthDirection = .normal
        p.emissionDirection = SIMD3(0, 1, 0)
        p.speed = 4
        p.mainEmitter.birthRate = 60
        p.mainEmitter.lifeSpan = 9
        p.mainEmitter.size = 5
        p.mainEmitter.sizeVariation = 2
        p.mainEmitter.acceleration = SIMD3(1.2, 2.5, 0)
        p.mainEmitter.color = .constant(.single(Materials.rgb(0.18, 0.17, 0.16, 0.7)))
        e.components.set(p)
        e.position = SIMD3(0, 3, 0)
        return e
    }
}
