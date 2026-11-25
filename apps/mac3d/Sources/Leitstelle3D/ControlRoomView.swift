// Leitstellenraum in 3D: Du sitzt am Disponentenplatz. Die Monitore und die Videowand zeigen live
// die Leitstellen-Software; Klick auf einen Monitor setzt dich an den Arbeitsplatz, Klick auf das
// Telefon nimmt den Notruf an. Ziehen dreht den Kopf.

import AppKit
import Leitstelle3DKit
import RealityKit
import SwiftUI

@MainActor
final class RoomScene {
    let root = Entity()
    let camera = PerspectiveCamera()
    /// Blickrichtung des Kopfes (Radiant).
    var yaw: Float = 0
    var pitch: Float = -0.12

    private var screenTexture: TextureResource?
    private var screens: [ModelEntity] = []
    private var phoneLamp: ModelEntity?
    private let phoneOn = Materials.glow(Materials.rgb(1, 0.1, 0.08), intensity: 10)
    private let phoneOff = Materials.pbr(Materials.rgb(0.3, 0.05, 0.05), roughness: 0.4)
    private var ringing = false
    private var clock: Double = 0
    private let eye = SIMD3<Float>(0, 1.22, 2.2)

    init() {
        root.addChild(camera)
        camera.camera.fieldOfViewInDegrees = 62
        camera.camera.near = 0.05
        camera.camera.far = 60
        build()
        updateCamera()
    }

    // MARK: Raum

    private func build() {
        let floorMat = Materials.pbr(Materials.rgb(0.2, 0.22, 0.25), roughness: 0.85)
        let wallMat = Materials.pbr(Materials.rgb(0.62, 0.64, 0.66), roughness: 0.9)
        let ceilingMat = Materials.pbr(Materials.rgb(0.8, 0.8, 0.8), roughness: 0.95)
        let deskMat = Materials.pbr(Materials.rgb(0.75, 0.73, 0.7), roughness: 0.5)
        let metal = Materials.pbr(Materials.rgb(0.18, 0.19, 0.2), roughness: 0.35, metallic: 0.8)

        // Raum 16 × 12 m, 3,6 m hoch. Blick nach -z auf die Videowand.
        var shell = MeshBuilder()
        shell.quad(SIMD3(-8, 0, 6), SIMD3(8, 0, 6), SIMD3(8, 0, -6), SIMD3(-8, 0, -6))
        add(shell, floorMat)
        var walls = MeshBuilder()
        walls.quad(SIMD3(-8, 0, -6), SIMD3(8, 0, -6), SIMD3(8, 3.6, -6), SIMD3(-8, 3.6, -6))
        walls.quad(SIMD3(-8, 0, 6), SIMD3(-8, 0, -6), SIMD3(-8, 3.6, -6), SIMD3(-8, 3.6, 6))
        walls.quad(SIMD3(8, 0, -6), SIMD3(8, 0, 6), SIMD3(8, 3.6, 6), SIMD3(8, 3.6, -6))
        walls.quad(SIMD3(8, 0, 6), SIMD3(-8, 0, 6), SIMD3(-8, 3.6, 6), SIMD3(8, 3.6, 6))
        add(walls, wallMat)
        var ceiling = MeshBuilder()
        ceiling.quad(SIMD3(-8, 3.6, -6), SIMD3(8, 3.6, -6), SIMD3(8, 3.6, 6), SIMD3(-8, 3.6, 6))
        add(ceiling, ceilingMat)

        // Deckenleuchten (Lichtbänder) und Raumlicht.
        var panels = MeshBuilder()
        for x: Float in [-5, 0, 5] {
            for z: Float in [-3, 1, 4.5] {
                panels.box(base: SIMD3(x, 3.56, z), width: 2.4, depth: 0.5, height: 0.03)
                let light = PointLight()
                light.light.intensity = 26_000
                light.light.attenuationRadius = 12
                light.light.color = Materials.rgb(1, 0.96, 0.9)
                light.position = SIMD3(x, 3.3, z)
                root.addChild(light)
            }
        }
        add(panels, Materials.glow(Materials.rgb(1, 0.98, 0.94), intensity: 3))

        // Videowand mit Rahmen.
        var frame = MeshBuilder()
        frame.box(base: SIMD3(0, 0.95, -5.9), width: 9.4, depth: 0.15, height: 2.5)
        add(frame, metal)
        _ = screen(width: 9, height: 2.3, at: SIMD3(0, 2.2, -5.8))

        // Schild „Integrierte Leitstelle".
        let sign = Labels.make("Integrierte Leitstelle Brakenfeld", size: 0.22, color: Materials.rgb(0.85, 0.88, 0.92))
        sign.components.remove(BillboardComponent.self)
        sign.position = SIMD3(0, 3.3, -5.85)
        root.addChild(sign)

        // Eigener Platz vorn in der Mitte, Kollegen links und rechts in zwei Reihen.
        desk(at: SIMD3(0, 0, 1.2), own: true, deskMat: deskMat, metal: metal)
        for x: Float in [-3.2, 3.2] { desk(at: SIMD3(x, 0, 1.2), own: false, deskMat: deskMat, metal: metal) }
        for x: Float in [-4.8, -1.6, 1.6, 4.8] { desk(at: SIMD3(x, 0, -1.8), own: false, deskMat: deskMat, metal: metal) }

        // Fenster an der rechten Wand: Tageslicht von außen.
        var window = MeshBuilder()
        window.quad(SIMD3(7.98, 1.0, -4), SIMD3(7.98, 1.0, 3), SIMD3(7.98, 2.9, 3), SIMD3(7.98, 2.9, -4))
        add(window, Materials.glow(Materials.rgb(0.6, 0.75, 0.95), intensity: 1.4))
    }

    /// Arbeitsplatz: Tisch, drei Monitore, Stuhl; beim eigenen Platz Telefon und Tastatur.
    private func desk(at p: SIMD3<Float>, own: Bool, deskMat: PhysicallyBasedMaterial, metal: PhysicallyBasedMaterial) {
        var top = MeshBuilder()
        top.box(base: p + SIMD3(0, 0.72, 0), width: 2.6, depth: 0.95, height: 0.04)
        add(top, deskMat)
        var legs = MeshBuilder()
        for x: Float in [-1.2, 1.2] { legs.box(base: p + SIMD3(x, 0, 0), width: 0.06, depth: 0.8, height: 0.72) }
        // Monitorfüße
        for k in -1...1 {
            legs.box(base: p + SIMD3(Float(k) * 0.72, 0.74, -0.32), width: 0.24, depth: 0.18, height: 0.02)
            legs.box(base: p + SIMD3(Float(k) * 0.72, 0.76, -0.36), width: 0.05, depth: 0.04, height: 0.36)
        }
        add(legs, metal)
        for k in -1...1 {
            let x = Float(k) * 0.72
            let angle = Float(-k) * 0.28
            var bezel = MeshBuilder()
            bezel.box(base: SIMD3(0, -0.22, -0.02), width: 0.7, depth: 0.04, height: 0.44)
            let monitor = Entity()
            monitor.position = p + SIMD3(x, 1.32, -0.3 + abs(Float(k)) * 0.1)
            monitor.orientation = simd_quatf(angle: angle, axis: SIMD3(0, 1, 0))
            if let e = bezel.entity(metal) { monitor.addChild(e) }
            let s = screen(width: 0.66, height: 0.4, at: SIMD3(0, 0, 0.005))
            s.removeFromParent()
            monitor.addChild(s)
            if own { s.makeTappable(size: SIMD3(0.7, 0.45, 0.05)) }
            root.addChild(monitor)
        }
        // Stuhl
        var chair = MeshBuilder()
        chair.box(base: p + SIMD3(0, 0.45, 0.95), width: 0.55, depth: 0.55, height: 0.08)
        chair.box(base: p + SIMD3(0, 0.53, 1.2), width: 0.55, depth: 0.06, height: 0.65)
        chair.cylinder(base: p + SIMD3(0, 0, 0.95), radius: 0.04, height: 0.45)
        add(chair, Materials.pbr(Materials.rgb(0.1, 0.11, 0.13), roughness: 0.7))

        if own {
            // Telefon mit Rufanzeige.
            var phone = MeshBuilder()
            phone.box(base: p + SIMD3(1.0, 0.74, 0.12), width: 0.22, depth: 0.2, height: 0.06)
            let phoneEntity = phone.entity(Materials.pbr(Materials.rgb(0.12, 0.12, 0.13), roughness: 0.4)) ?? ModelEntity()
            phoneEntity.name = "phone"
            phoneEntity.makeTappable(size: SIMD3(0.4, 0.3, 0.4), offset: p + SIMD3(1.0, 0.78, 0.12))
            root.addChild(phoneEntity)
            let lamp = ModelEntity(mesh: .generateSphere(radius: 0.025), materials: [phoneOff])
            lamp.position = p + SIMD3(1.07, 0.82, 0.06)
            root.addChild(lamp)
            phoneLamp = lamp
            var keyboard = MeshBuilder()
            keyboard.box(base: p + SIMD3(0, 0.74, 0.15), width: 0.46, depth: 0.15, height: 0.02)
            keyboard.box(base: p + SIMD3(0.36, 0.74, 0.15), width: 0.07, depth: 0.1, height: 0.025)
            add(keyboard, Materials.pbr(Materials.rgb(0.08, 0.08, 0.09), roughness: 0.6))
            // Headset
            var headset = MeshBuilder()
            headset.box(base: p + SIMD3(-0.95, 0.74, 0.1), width: 0.16, depth: 0.08, height: 0.14)
            add(headset, metal)
        } else {
            colleague(at: p + SIMD3(0, 0, 0.95))
        }
    }

    /// Kollegin/Kollege am Platz – vereinfachte Figur.
    private func colleague(at p: SIMD3<Float>) {
        let shirt = Materials.pbr(positionHash(Double(p.x), Double(p.z)) < 0.5 ? Materials.rgb(0.2, 0.3, 0.5) : Materials.rgb(0.75, 0.15, 0.12), roughness: 0.9)
        let skin = Materials.pbr(Materials.rgb(0.86, 0.68, 0.55), roughness: 0.7)
        var torso = MeshBuilder()
        torso.box(base: p + SIMD3(0, 0.53, -0.05), width: 0.42, depth: 0.24, height: 0.55)
        add(torso, shirt)
        let head = ModelEntity(mesh: .generateSphere(radius: 0.11), materials: [skin])
        head.position = p + SIMD3(0, 1.22, -0.08)
        root.addChild(head)
        // Haare oben und hinten – die Figur blickt nach -z auf ihre Monitore.
        let hair = ModelEntity(mesh: .generateSphere(radius: 0.115), materials: [Materials.pbr(Materials.rgb(0.15, 0.1, 0.07), roughness: 0.9)])
        hair.position = p + SIMD3(0, 1.25, -0.05)
        hair.scale = SIMD3(1, 0.75, 1)
        root.addChild(hair)
    }

    /// Bildschirmfläche mit der Leitstellen-Software als Textur.
    private func screen(width: Float, height: Float, at p: SIMD3<Float>) -> ModelEntity {
        let e = ModelEntity(mesh: .generatePlane(width: width, height: height),
                            materials: [Materials.glow(Materials.rgb(0.05, 0.08, 0.12), intensity: 0.5)])
        e.position = p
        e.name = "screen"
        root.addChild(e)
        screens.append(e)
        return e
    }

    // MARK: Aktualisieren

    func setScreen(_ image: CGImage) {
        do {
            if let texture = screenTexture {
                try texture.replace(withImage: image, options: .init(semantic: .color))
            } else {
                let texture = try TextureResource(image: image, options: .init(semantic: .color))
                screenTexture = texture
                var m = UnlitMaterial()
                m.color = .init(tint: .white, texture: .init(texture))
                for s in screens { s.model?.materials = [m] }
            }
        } catch {
            NSLog("Leitstelle3D: Monitorbild nicht übernommen: %@", String(describing: error))
        }
    }

    func setRinging(_ on: Bool) { ringing = on }

    func tick(dt: Double) {
        clock += dt
        let lit = ringing && Int(clock * 3) % 2 == 0
        phoneLamp?.model?.materials = [lit ? phoneOn : phoneOff]
    }

    func look(dx: Float, dy: Float) {
        yaw = min(max(yaw - dx * 0.004, -1.3), 1.3)
        pitch = min(max(pitch - dy * 0.003, -0.7), 0.45)
        updateCamera()
    }

    func updateCamera() {
        let dir = SIMD3<Float>(-sin(yaw) * cos(pitch), sin(pitch), -cos(yaw) * cos(pitch))
        camera.look(at: eye + dir, from: eye, relativeTo: nil)
    }

    private func add(_ mesh: MeshBuilder, _ material: PhysicallyBasedMaterial) {
        if let e = mesh.entity(material) { root.addChild(e) }
    }
}

struct ControlRoomView: View {
    let model: AppModel
    @State private var scene = RoomScene()
    @State private var lastDrag: CGSize = .zero

    var body: some View {
        RealityView { content in
            content.camera = .virtual
            content.add(scene.root)
            if let env = Sky.environment(daylight: 0.6) {
                let ibl = Entity()
                ibl.components.set(ImageBasedLightComponent(source: .single(env), intensityExponent: 1))
                scene.root.addChild(ibl)
                applyReceivers(scene.root, ibl)
            }
            if let image = model.monitorImage { scene.setScreen(image) }
            _ = content.subscribe(to: SceneEvents.Update.self) { event in
                MainActor.assumeIsolated { scene.tick(dt: event.deltaTime) }
            }
        }
        .background(Color.black)
        .gesture(
            DragGesture(minimumDistance: 2)
                .onChanged { value in
                    scene.look(dx: Float(value.translation.width - lastDrag.width), dy: Float(value.translation.height - lastDrag.height))
                    lastDrag = value.translation
                }
                .onEnded { _ in lastDrag = .zero }
        )
        .simultaneousGesture(
            SpatialTapGesture()
                .targetedToAnyEntity()
                .onEnded { value in
                    if value.entity.name == "phone" { model.answerPhone() } else { model.mode = .workstation }
                }
        )
        .onChange(of: model.monitorImage) { _, image in if let image { scene.setScreen(image) } }
        .onChange(of: model.state?.waitingCalls ?? 0, initial: true) { _, calls in scene.setRinging(calls > 0) }
        .overlay(alignment: .bottomLeading) {
            Text("Ziehen: umsehen · Klick auf deinen Monitor: an den Arbeitsplatz · Klick aufs Telefon: Notruf annehmen")
                .font(.callout)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(.regularMaterial, in: .capsule)
                .padding(16)
        }
    }

    private func applyReceivers(_ entity: Entity, _ ibl: Entity) {
        if entity is ModelEntity { entity.components.set(ImageBasedLightReceiverComponent(imageBasedLight: ibl)) }
        for child in entity.children { applyReceivers(child, ibl) }
    }
}
