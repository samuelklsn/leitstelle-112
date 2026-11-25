// Sammelt Dreiecke vieler Objekte zu einem Netz (ein Netz je Material). So bleiben es wenige
// Draw-Calls, auch bei tausenden Häusern und Bäumen. Reine Geometrie, kein RealityKit.

import simd

public struct MeshBuilder: Sendable {
    public private(set) var positions: [SIMD3<Float>] = []
    public private(set) var normals: [SIMD3<Float>] = []
    public private(set) var indices: [UInt32] = []

    public init() {}

    public var isEmpty: Bool { indices.isEmpty }
    public var triangleCount: Int { indices.count / 3 }

    /// Ein Viereck (a, b, c, d gegen den Uhrzeigersinn von außen gesehen).
    public mutating func quad(_ a: SIMD3<Float>, _ b: SIMD3<Float>, _ c: SIMD3<Float>, _ d: SIMD3<Float>) {
        let n = simd_normalize(simd_cross(b - a, d - a))
        let base = UInt32(positions.count)
        positions += [a, b, c, d]
        normals += [n, n, n, n]
        indices += [base, base + 1, base + 2, base, base + 2, base + 3]
    }

    public mutating func triangle(_ a: SIMD3<Float>, _ b: SIMD3<Float>, _ c: SIMD3<Float>) {
        let n = simd_normalize(simd_cross(b - a, c - a))
        let base = UInt32(positions.count)
        positions += [a, b, c]
        normals += [n, n, n]
        indices += [base, base + 1, base + 2]
    }

    /// Quader um einen Bodenmittelpunkt, gedreht um die Hochachse. Ohne Boden (unsichtbar).
    public mutating func box(base center: SIMD3<Float>, width: Float, depth: Float, height: Float, rotation: Float = 0) {
        let c = corners(center, width, depth, rotation)
        let up = SIMD3<Float>(0, height, 0)
        for k in 0..<4 {
            let a = c[k], b = c[(k + 1) % 4]
            quad(a, b, b + up, a + up)
        }
        quad(c[0] + up, c[1] + up, c[2] + up, c[3] + up)
    }

    /// Satteldach auf einem Quader der Höhe `wallHeight`; First entlang der Breite.
    public mutating func gableRoof(base center: SIMD3<Float>, width: Float, depth: Float, wallHeight: Float, roofHeight: Float, rotation: Float = 0) {
        let overhang: Float = 0.4
        let c = corners(center, width + overhang * 2, depth + overhang * 2, rotation)
        let up = SIMD3<Float>(0, wallHeight, 0)
        let ridgeUp = SIMD3<Float>(0, wallHeight + roofHeight, 0)
        let r0 = (c[0] + c[3]) / 2 + ridgeUp
        let r1 = (c[1] + c[2]) / 2 + ridgeUp
        let a = c[0] + up, b = c[1] + up, cc = c[2] + up, d = c[3] + up
        quad(a, b, r1, r0)
        quad(cc, d, r0, r1)
        triangle(b, cc, r1)
        triangle(d, a, r0)
    }

    /// Band entlang einer Linie (Straße, Fluss) in fester Höhe über dem Boden.
    public mutating func strip(from p: SIMD3<Float>, to q: SIMD3<Float>, width: Float) {
        let dir = q - p
        let len = simd_length(SIMD2(dir.x, dir.z))
        guard len > 0.01 else { return }
        // Nach links (in Fahrtrichtung) gesehen, damit die Fläche nach oben zeigt.
        let side = SIMD3<Float>(dir.z / len, 0, -dir.x / len) * (width / 2)
        // Etwas über die Enden hinaus, damit Kreuzungen keine Lücken haben.
        let ext = SIMD3<Float>(dir.x / len, 0, dir.z / len) * (width * 0.35)
        quad(p - ext - side, q + ext - side, q + ext + side, p - ext + side)
    }

    /// Senkrechter Zylinder (Baumstamm, Rad, Mast) mit `segments` Seiten und Deckel.
    public mutating func cylinder(base: SIMD3<Float>, radius: Float, height: Float, segments: Int = 8) {
        let up = SIMD3<Float>(0, height, 0)
        let ring = (0..<segments).map { k -> SIMD3<Float> in
            let a = Float(k) / Float(segments) * 2 * .pi
            return base + SIMD3(cos(a) * radius, 0, -sin(a) * radius)
        }
        for k in 0..<segments {
            let a = ring[k], b = ring[(k + 1) % segments]
            quad(a, b, b + up, a + up)
            triangle(base + up, a + up, b + up)
        }
    }

    /// Kegel (Nadelbaumkrone).
    public mutating func cone(base: SIMD3<Float>, radius: Float, height: Float, segments: Int = 7) {
        let tip = base + SIMD3(0, height, 0)
        let ring = (0..<segments).map { k -> SIMD3<Float> in
            let a = Float(k) / Float(segments) * 2 * .pi
            return base + SIMD3(cos(a) * radius, 0, -sin(a) * radius)
        }
        for k in 0..<segments { triangle(ring[k], ring[(k + 1) % segments], tip) }
    }

    /// Flaches Polygon (Wald, Platz) aus einer Triangulierung.
    public mutating func polygon(_ points: [SIMD3<Float>], triangles: [Int]) {
        var k = 0
        while k + 2 < triangles.count {
            let a = points[triangles[k]], b = points[triangles[k + 1]], c = points[triangles[k + 2]]
            // Nach oben zeigend, egal in welcher Richtung das Polygon umläuft.
            if simd_cross(b - a, c - a).y >= 0 { triangle(a, b, c) } else { triangle(a, c, b) }
            k += 3
        }
    }

    /// Fenster auf den beiden Längsseiten eines Hauses: je Geschoss eine Reihe, leicht vor der Wand.
    public mutating func windows(base center: SIMD3<Float>, width: Float, depth: Float, wallHeight: Float, rotation: Float) {
        let floors = max(1, Int((wallHeight / 2.9).rounded()))
        let perRow = max(1, Int(width / 3.2))
        let cs = cos(rotation), sn = sin(rotation)
        func world(_ x: Float, _ y: Float, _ z: Float) -> SIMD3<Float> {
            center + SIMD3(x * cs - z * sn, y, x * sn + z * cs)
        }
        let w: Float = 1.1, h: Float = 1.3
        for side: Float in [1, -1] {
            let z = side * (depth / 2 + 0.06)
            for floor in 0..<floors {
                let y0 = Float(floor) * 2.9 + 0.9
                for k in 0..<perRow {
                    let x = -width / 2 + width * (Float(k) + 0.5) / Float(perRow)
                    // Von außen gesehen gegen den Uhrzeigersinn, damit die Fläche nach außen zeigt.
                    let a = world(x - w / 2 * side, y0, z), b = world(x + w / 2 * side, y0, z)
                    quad(a, b, b + SIMD3(0, h, 0), a + SIMD3(0, h, 0))
                }
            }
        }
    }

    private func corners(_ c: SIMD3<Float>, _ w: Float, _ d: Float, _ rot: Float) -> [SIMD3<Float>] {
        let cs = cos(rot), sn = sin(rot)
        return [(-w, d), (w, d), (w, -d), (-w, -d)].map { (x: Float, z: Float) in
            c + SIMD3(x / 2 * cs - z / 2 * sn, 0, x / 2 * sn + z / 2 * cs)
        }
    }
}
