// Rechenwege der 3D-Ansicht ohne RealityKit: Koordinaten, Kamera, Bewegung, Sonnenstand,
// Gebäude, Polygone. Getrennt, damit sie ohne App getestet werden können.

import Foundation
import simd

/// Lokale Meter der Simulation (x Ost, y Nord) ↔ Szene (x rechts, y oben, z zum Betrachter).
/// Eine Szeneneinheit ist ein Meter; der Ursprung liegt in der Mitte der Region.
public struct WorldFrame: Sendable, Equatable {
    public let width: Double
    public let height: Double

    public init(width: Double, height: Double) {
        self.width = width
        self.height = height
    }

    public func point(_ x: Double, _ y: Double, height h: Float = 0) -> SIMD3<Float> {
        SIMD3(Float(x - width / 2), h, Float(-(y - height / 2)))
    }

    /// Größte Ausdehnung – für Kamera-Grenzen und Sichtweite.
    public var extent: Float { Float(max(width, height)) }
}

/// Fahrbahnbreite je Straßenklasse (Meter, gerundete Regelquerschnitte).
public func roadWidth(forClass cls: Int) -> Float {
    switch cls {
    case 0: 24 // Autobahn, beide Richtungen
    case 1: 9
    case 2: 7.5
    case 3: 6.5
    case 4: 7
    case 6: 5
    default: 5.5
    }
}

// MARK: - Kamera

/// Kreisende Kamera um einen Zielpunkt (Lage 3D). Winkel in Radiant.
public struct OrbitCamera: Sendable, Equatable {
    public var target: SIMD3<Float>
    public var distance: Float
    /// Drehung um die Hochachse; 0 = Blick nach Norden.
    public var yaw: Float
    /// Neigung über dem Horizont; π/2 = senkrecht von oben.
    public var pitch: Float
    public var minDistance: Float = 25
    public var maxDistance: Float = 40_000

    public init(target: SIMD3<Float>, distance: Float, yaw: Float, pitch: Float) {
        self.target = target
        self.distance = distance
        self.yaw = yaw
        self.pitch = pitch
    }

    public var position: SIMD3<Float> {
        let horizontal = distance * cos(pitch)
        return target + SIMD3(horizontal * sin(yaw), distance * sin(pitch), horizontal * cos(yaw))
    }

    public mutating func rotate(byYaw dYaw: Float, pitch dPitch: Float) {
        yaw += dYaw
        pitch = min(max(pitch + dPitch, 0.08), 1.52)
    }

    /// Zoom um einen Faktor (> 1 heißt näher heran).
    public mutating func zoom(by factor: Float) {
        guard factor > 0 else { return }
        distance = min(max(distance / factor, minDistance), maxDistance)
    }

    /// Verschieben in Bildschirmrichtung; schneller, je weiter die Kamera weg ist.
    public mutating func pan(dx: Float, dy: Float) {
        let scale = distance * 0.0015
        let right = SIMD3<Float>(cos(yaw), 0, -sin(yaw))
        let forward = SIMD3<Float>(-sin(yaw), 0, -cos(yaw))
        target += right * (-dx * scale) + forward * (dy * scale)
    }

    /// Weich zum neuen Ziel gleiten (Fahrzeug verfolgen).
    public mutating func follow(_ point: SIMD3<Float>, smoothing: Float) {
        target = simd_mix(target, point, SIMD3(repeating: min(max(smoothing, 0), 1)))
    }
}

// MARK: - Fahrzeugbewegung

/// Glättet die Positionen, die zehnmal je Sekunde kommen, zu einer flüssigen Fahrt mit Fahrtrichtung.
public struct VehicleTrack: Sendable, Equatable {
    public private(set) var shown: SIMD2<Double>
    public private(set) var target: SIMD2<Double>
    /// Fahrtrichtung in Radiant (0 = Nord, im Uhrzeigersinn).
    public private(set) var heading: Double

    public init(x: Double, y: Double) {
        shown = SIMD2(x, y)
        target = shown
        heading = 0
    }

    /// Neue Sollposition aus der Simulation. Große Sprünge (Spielstand geladen) springen mit.
    public mutating func update(x: Double, y: Double) {
        let next = SIMD2(x, y)
        let delta = next - shown
        if simd_length(delta) > 3_000 { shown = next }
        if simd_length(next - target) > 0.5 { heading = atan2(next.x - target.x, next.y - target.y) }
        target = next
    }

    /// Vorrücken um `dt` Sekunden; erreicht das Ziel in etwa einem Feed-Takt.
    public mutating func advance(dt: Double) {
        let k = min(1, dt * 9)
        shown += (target - shown) * k
    }
}

// MARK: - Licht

/// Sonnenrichtung (zeigt von der Sonne zur Erde) für eine Tageszeit; vereinfacht, Süd-Mittag um 13 Uhr.
public func sunDirection(hour: Double) -> SIMD3<Float> {
    let dayAngle = (hour - 13) / 24 * 2 * Double.pi
    let elevation = Float(cos(dayAngle) * 1.05 - 0.15)
    let azimuth = Float(dayAngle)
    let horizontal = cos(max(elevation, -0.3))
    let toSun = SIMD3<Float>(sin(azimuth) * horizontal, sin(elevation), cos(azimuth) * horizontal)
    return -simd_normalize(toSun)
}

/// Helligkeit des Tageslichts 0…1 (Nacht 0, Mittag 1) mit weicher Dämmerung.
public func daylight(hour: Double) -> Float {
    let up = -sunDirection(hour: hour).y
    return min(max((up + 0.12) / 0.5, 0), 1)
}

// MARK: - Gebäude

/// Ein Gebäude als Quader mit Satteldach (Meter, Szenenkoordinaten).
public struct Building: Sendable, Equatable {
    public let center: SIMD3<Float>
    public let width: Float
    public let depth: Float
    public let wallHeight: Float
    public let roofHeight: Float
    /// Drehung um die Hochachse (Radiant).
    public let rotation: Float
    /// Farbvariante 0…3 für Fassade und Dach.
    public let variant: Int
}

/// Deterministische Zahl 0…1 aus einer Position – gleiche Welt, gleiche Häuser.
public func positionHash(_ x: Double, _ y: Double, salt: UInt64 = 0) -> Double {
    var h = UInt64(bitPattern: Int64(x.rounded())) &* 0x9E37_79B9_7F4A_7C15
    h ^= UInt64(bitPattern: Int64(y.rounded())) &* 0xC2B2_AE3D_27D4_EB4F
    h ^= salt &* 0x1656_67B1_9E37_79F9
    h ^= h >> 31
    h = h &* 0xBF58_476D_1CE4_E5B9
    h ^= h >> 29
    return Double(h % 1_000_000) / 1_000_000
}

/// Wohnhäuser aus den Adressen der Simulation. In Städten höher und dichter (Mehrfamilienhäuser).
public func makeHouses(_ coords: [Double], frame: WorldFrame, towns: [SceneWorld.Town]) -> [Building] {
    var result: [Building] = []
    result.reserveCapacity(coords.count / 2)
    var i = 0
    while i + 1 < coords.count {
        let x = coords[i], y = coords[i + 1]
        i += 2
        let city = towns.min { hypot($0.x - x, $0.y - y) < hypot($1.x - x, $1.y - y) }
            .map { $0.city && hypot($0.x - x, $0.y - y) < 700 } ?? false
        let r1 = positionHash(x, y, salt: 1), r2 = positionHash(x, y, salt: 2), r3 = positionHash(x, y, salt: 3)
        // Vom Straßenpunkt ein Stück zurück auf das Grundstück.
        let setback = 9 + r1 * 4
        let angle = r2 * 2 * Double.pi
        let px = x + cos(angle) * setback, py = y + sin(angle) * setback
        let floors = city ? 3 + Int(r3 * 3) : 1 + Int(r3 * 1.6)
        result.append(Building(
            center: frame.point(px, py),
            width: Float(city ? 14 + r1 * 8 : 9 + r1 * 4),
            depth: Float(city ? 11 + r2 * 6 : 8 + r2 * 3),
            wallHeight: Float(floors) * 2.9,
            roofHeight: city ? Float(1.5 + r3) : Float(3.2 + r3 * 1.5),
            rotation: Float(angle),
            variant: Int(r3 * 4) % 4
        ))
    }
    return result
}

// MARK: - Polygone

/// Zerlegt ein einfaches Polygon (x, y abwechselnd) in Dreiecke (Ohrenschneiden). Liefert Indizes.
public func triangulate(_ flat: [Double]) -> [Int] {
    var pts: [SIMD2<Double>] = stride(from: 0, to: flat.count - 1, by: 2).map { SIMD2(flat[$0], flat[$0 + 1]) }
    // Geschlossene Ringe wiederholen den ersten Punkt.
    if pts.count > 3, let first = pts.first, let last = pts.last, simd_distance(first, last) < 0.01 { pts.removeLast() }
    guard pts.count >= 3 else { return [] }
    var area = 0.0
    for k in pts.indices {
        let a = pts[k], b = pts[(k + 1) % pts.count]
        area += a.x * b.y - b.x * a.y
    }
    var order = Array(pts.indices)
    if area < 0 { order.reverse() }
    var out: [Int] = []
    var guardCount = 0
    while order.count > 3, guardCount < 10_000 {
        guardCount += 1
        var clipped = false
        for k in order.indices {
            let ia = order[(k + order.count - 1) % order.count], ib = order[k], ic = order[(k + 1) % order.count]
            let a = pts[ia], b = pts[ib], c = pts[ic]
            let cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
            if cross <= 0 { continue }
            let inside = order.contains { j in
                j != ia && j != ib && j != ic && pointInTriangle(pts[j], a, b, c)
            }
            if inside { continue }
            out += [ia, ib, ic]
            order.remove(at: k)
            clipped = true
            break
        }
        if !clipped { break }
    }
    if order.count == 3 { out += order }
    return out
}

private func pointInTriangle(_ p: SIMD2<Double>, _ a: SIMD2<Double>, _ b: SIMD2<Double>, _ c: SIMD2<Double>) -> Bool {
    func sign(_ p1: SIMD2<Double>, _ p2: SIMD2<Double>, _ p3: SIMD2<Double>) -> Double {
        (p1.x - p3.x) * (p2.y - p3.y) - (p2.x - p3.x) * (p1.y - p3.y)
    }
    let d1 = sign(p, a, b), d2 = sign(p, b, c), d3 = sign(p, c, a)
    let neg = d1 < 0 || d2 < 0 || d3 < 0
    let pos = d1 > 0 || d2 > 0 || d3 > 0
    return !(neg && pos)
}

/// Punkte im Polygon verteilen (Bäume im Wald) – deterministisch, etwa `density` je Hektar.
public func scatter(in flat: [Double], density: Double, limit: Int) -> [SIMD2<Double>] {
    let pts: [SIMD2<Double>] = stride(from: 0, to: flat.count - 1, by: 2).map { SIMD2(flat[$0], flat[$0 + 1]) }
    guard pts.count >= 3 else { return [] }
    let minP = pts.reduce(pts[0]) { simd_min($0, $1) }, maxP = pts.reduce(pts[0]) { simd_max($0, $1) }
    let step = max(8, 100 / sqrt(max(density, 0.01)))
    var out: [SIMD2<Double>] = []
    var y = minP.y
    while y < maxP.y, out.count < limit {
        var x = minP.x
        while x < maxP.x, out.count < limit {
            let jx = x + (positionHash(x, y, salt: 7) - 0.5) * step
            let jy = y + (positionHash(x, y, salt: 8) - 0.5) * step
            if contains(pts, SIMD2(jx, jy)) { out.append(SIMD2(jx, jy)) }
            x += step
        }
        y += step
    }
    return out
}

private func contains(_ poly: [SIMD2<Double>], _ p: SIMD2<Double>) -> Bool {
    var inside = false
    var j = poly.count - 1
    for i in poly.indices {
        let a = poly[i], b = poly[j]
        if (a.y > p.y) != (b.y > p.y), p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x { inside.toggle() }
        j = i
    }
    return inside
}
