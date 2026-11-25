// Bausteine für beide 3D-Ansichten: Materialien, Himmel und Umgebungslicht, Netze, Schrift.
// Alles wird zur Laufzeit erzeugt – keine fremden Modelle, Texturen oder Bilder (Regel 2).

import AppKit
import Leitstelle3DKit
import RealityKit

enum Materials {
    /// Physikalisch basiertes Material: Farbe, Rauheit, Metall.
    static func pbr(_ color: NSColor, roughness: Float = 0.8, metallic: Float = 0) -> PhysicallyBasedMaterial {
        var m = PhysicallyBasedMaterial()
        m.baseColor = .init(tint: color)
        m.roughness = .init(floatLiteral: roughness)
        m.metallic = .init(floatLiteral: metallic)
        return m
    }

    /// Leuchtendes Material (Blaulicht, Bildschirm, Deckenleuchte).
    static func glow(_ color: NSColor, intensity: Float = 1) -> PhysicallyBasedMaterial {
        var m = PhysicallyBasedMaterial()
        m.baseColor = .init(tint: color)
        m.emissiveColor = .init(color: color)
        m.emissiveIntensity = intensity
        return m
    }

    static func unlit(_ color: NSColor) -> UnlitMaterial { UnlitMaterial(color: color) }

    static func rgb(_ r: Double, _ g: Double, _ b: Double, _ a: Double = 1) -> NSColor {
        NSColor(srgbRed: r, green: g, blue: b, alpha: a)
    }
}

extension MeshBuilder {
    /// Netz für RealityKit; leere Netze ergeben nil.
    func resource() -> MeshResource? {
        guard !isEmpty else { return nil }
        var d = MeshDescriptor(name: "netz")
        d.positions = MeshBuffers.Positions(positions)
        d.normals = MeshBuffers.Normals(normals)
        d.primitives = .triangles(indices)
        return try? MeshResource.generate(from: [d])
    }

    func entity(_ material: any RealityKit.Material, name: String = "") -> ModelEntity? {
        guard let mesh = resource() else { return nil }
        let e = ModelEntity(mesh: mesh, materials: [material])
        e.name = name
        return e
    }
}

enum Sky {
    /// Himmel als Rundumbild (equirektangular): oben Blau, Horizont hell, unten Erdton.
    /// Die Farben folgen der Tageszeit; nachts dunkelblau.
    static func image(daylight: Float) -> CGImage? {
        let w = 256, h = 128
        let space = CGColorSpace(name: CGColorSpace.sRGB)!
        guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
                                  space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
        else { return nil }
        let d = CGFloat(daylight)
        func mix(_ night: (CGFloat, CGFloat, CGFloat), _ day: (CGFloat, CGFloat, CGFloat)) -> CGColor {
            CGColor(srgbRed: night.0 + (day.0 - night.0) * d, green: night.1 + (day.1 - night.1) * d,
                    blue: night.2 + (day.2 - night.2) * d, alpha: 1)
        }
        let colors = [
            mix((0.01, 0.02, 0.06), (0.22, 0.45, 0.85)), // Zenit
            mix((0.04, 0.06, 0.12), (0.62, 0.76, 0.92)), // über dem Horizont
            mix((0.10, 0.09, 0.10), (0.92, 0.90, 0.84)), // Horizont (Dunst)
            mix((0.02, 0.02, 0.02), (0.30, 0.31, 0.27)), // Boden
        ] as CFArray
        let gradient = CGGradient(colorsSpace: space, colors: colors, locations: [0, 0.38, 0.5, 0.56])!
        // CGContext zählt y von unten: oben im Bild ist der Zenit.
        ctx.drawLinearGradient(gradient, start: CGPoint(x: 0, y: h), end: CGPoint(x: 0, y: 0), options: [])
        return ctx.makeImage()
    }

    static func environment(daylight: Float) -> EnvironmentResource? {
        guard let image = image(daylight: daylight) else { return nil }
        return try? EnvironmentResource(equirectangular: image, withName: "himmel")
    }
}

enum Labels {
    /// Schild mit Text, das sich immer zur Kamera dreht.
    static func make(_ text: String, size: CGFloat, color: NSColor = .white, background: NSColor? = nil) -> Entity {
        let root = Entity()
        root.components.set(BillboardComponent())
        let mesh = MeshResource.generateText(text, extrusionDepth: 0.01, font: .systemFont(ofSize: size, weight: .semibold),
                                             containerFrame: .zero, alignment: .center, lineBreakMode: .byClipping)
        let label = ModelEntity(mesh: mesh, materials: [UnlitMaterial(color: color)])
        let bounds = mesh.bounds
        label.position = SIMD3(-bounds.center.x, -bounds.center.y, 0.02)
        root.addChild(label)
        if let background {
            let plate = ModelEntity(mesh: .generatePlane(width: bounds.extents.x + Float(size) * 0.6,
                                                         height: bounds.extents.y + Float(size) * 0.4,
                                                         cornerRadius: Float(size) * 0.2),
                                    materials: [UnlitMaterial(color: background)])
            root.addChild(plate)
        }
        return root
    }
}

extension Entity {
    /// Anklickbar machen (Fahrzeug, Einsatz, Monitor, Telefon).
    func makeTappable(size: SIMD3<Float>, offset: SIMD3<Float> = .zero) {
        components.set(CollisionComponent(shapes: [ShapeResource.generateBox(size: size).offsetBy(translation: offset)]))
        components.set(InputTargetComponent())
    }
}
