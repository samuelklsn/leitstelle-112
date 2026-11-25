// Lage 3D: der Landkreis mit fahrenden Fahrzeugen. Ziehen dreht, ⌥-Ziehen oder Rechtsziehen
// verschiebt, Scrollen und Zusammenziehen zoomt. Klick auf ein Fahrzeug verfolgt es, Klick auf
// einen Einsatz öffnet ihn am Arbeitsplatz.

import AppKit
import Leitstelle3DKit
import RealityKit
import SwiftUI

struct WorldView: View {
    let model: AppModel
    @State private var scene = WorldScene()
    @State private var lastDrag: CGSize = .zero
    @State private var lastMagnify: CGFloat = 1
    @State private var scrollMonitor: Any?

    var body: some View {
        RealityView { content in
            content.camera = .virtual
            content.add(scene.root)
            if let world = model.world { scene.build(world) }
            if let state = model.state { scene.apply(state) }
            scene.updateCamera()
            _ = content.subscribe(to: SceneEvents.Update.self) { event in
                MainActor.assumeIsolated {
                    scene.tick(dt: event.deltaTime, followId: model.followVehicleId)
                }
            }
        } update: { content in
            // Himmel als Hintergrund – wechselt mit der Tageszeit (Abhängigkeit über die Lage).
            _ = model.state?.hour
            if let sky = scene.sky { content.environment = .skybox(sky) }
        }
        .background(Color.black)
        .gesture(
            DragGesture(minimumDistance: 2)
                .onChanged { value in
                    let dx = Float(value.translation.width - lastDrag.width)
                    let dy = Float(value.translation.height - lastDrag.height)
                    lastDrag = value.translation
                    if NSEvent.modifierFlags.contains(.option) || NSEvent.pressedMouseButtons & 2 != 0 {
                        model.followVehicleId = nil
                        scene.orbit.pan(dx: dx, dy: dy)
                    } else {
                        scene.orbit.rotate(byYaw: -dx * 0.006, pitch: dy * 0.004)
                    }
                }
                .onEnded { _ in lastDrag = .zero }
        )
        .simultaneousGesture(
            MagnifyGesture()
                .onChanged { value in
                    scene.orbit.zoom(by: Float(value.magnification / lastMagnify))
                    lastMagnify = value.magnification
                }
                .onEnded { _ in lastMagnify = 1 }
        )
        .simultaneousGesture(
            SpatialTapGesture()
                .targetedToAnyEntity()
                .onEnded { value in select(value.entity) }
        )
        .onChange(of: model.world) { _, world in if let world { scene.build(world) } }
        .onChange(of: model.state) { _, state in if let state { scene.apply(state) } }
        .onAppear { installScrollZoom() }
        .onDisappear {
            if let scrollMonitor { NSEvent.removeMonitor(scrollMonitor) }
            scrollMonitor = nil
        }
        .overlay(alignment: .bottomLeading) { help }
        .overlay {
            if model.world == nil {
                ProgressView("Landkreis wird aufgebaut …").controlSize(.large).padding().background(.regularMaterial, in: .rect(cornerRadius: 12))
            }
        }
    }

    private var help: some View {
        Text("Ziehen: drehen · ⌥-Ziehen: verschieben · Scrollen: zoomen · Klick auf Fahrzeug: verfolgen · Klick auf Einsatz: öffnen")
            .font(.callout)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(.regularMaterial, in: .capsule)
            .padding(16)
    }

    /// Mausrad und Trackpad-Scrollen zoomen (SwiftUI kennt dafür keine Geste).
    private func installScrollZoom() {
        guard scrollMonitor == nil else { return }
        let orbit = scene
        scrollMonitor = NSEvent.addLocalMonitorForEvents(matching: .scrollWheel) { event in
            let delta = Float(event.hasPreciseScrollingDeltas ? event.scrollingDeltaY * 0.01 : event.scrollingDeltaY * 0.1)
            MainActor.assumeIsolated { orbit.orbit.zoom(by: 1 + delta) }
            return event
        }
    }

    private func select(_ entity: Entity) {
        var current: Entity? = entity
        while let e = current {
            if e.name.hasPrefix("vehicle:") { model.selectVehicle(String(e.name.dropFirst(8))); return }
            if e.name.hasPrefix("incident:") { model.selectIncident(String(e.name.dropFirst(9))); return }
            current = e.parent
        }
    }
}
