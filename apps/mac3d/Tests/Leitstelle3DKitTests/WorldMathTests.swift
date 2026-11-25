import Foundation
import Testing
import simd
@testable import Leitstelle3DKit

@Suite("3D-Rechenwege")
struct WorldMathTests {
    @Test("Weltmitte liegt im Ursprung, Norden zeigt nach -z")
    func frame() {
        let f = WorldFrame(width: 1000, height: 800)
        #expect(f.point(500, 400) == SIMD3<Float>(0, 0, 0))
        #expect(f.point(500, 800).z < 0)
        #expect(f.point(1000, 400).x > 0)
    }

    @Test("Ohrenschneiden zerlegt ein Viereck und ein L in Dreiecke")
    func triangulation() {
        #expect(triangulate([0, 0, 10, 0, 10, 10, 0, 10]).count == 6)
        // L-Form (nicht konvex), im Uhrzeigersinn und geschlossen.
        let l: [Double] = [0, 0, 0, 20, 10, 20, 10, 10, 20, 10, 20, 0, 0, 0]
        #expect(triangulate(l).count == 4 * 3)
    }

    @Test("Häuser sind deterministisch und stehen nahe ihrer Adresse")
    func houses() {
        let f = WorldFrame(width: 2000, height: 2000)
        let town = SceneWorld.Town(name: "A", x: 1000, y: 1000, population: 5000, city: false)
        let a = makeHouses([1000, 1000, 1200, 900], frame: f, towns: [town])
        let b = makeHouses([1000, 1000, 1200, 900], frame: f, towns: [town])
        #expect(a == b)
        #expect(a.count == 2)
        #expect(simd_length(a[0].center - f.point(1000, 1000)) < 15)
        #expect(a.allSatisfy { $0.wallHeight >= 2.9 })
    }

    @Test("Kamera bleibt in ihren Grenzen")
    func camera() {
        var c = OrbitCamera(target: .zero, distance: 1000, yaw: 0, pitch: 0.8)
        c.zoom(by: 1_000_000)
        #expect(c.distance == c.minDistance)
        c.rotate(byYaw: 0, pitch: 10)
        #expect(c.pitch <= 1.52)
        #expect(c.position.y > 0)
    }

    @Test("Fahrzeuge gleiten zum Ziel und zeigen in Fahrtrichtung")
    func track() {
        var t = VehicleTrack(x: 0, y: 0)
        t.update(x: 0, y: 100)
        #expect(abs(t.heading) < 0.001) // nach Norden
        for _ in 0..<60 { t.advance(dt: 1.0 / 60) }
        #expect(simd_distance(t.shown, SIMD2(0, 100)) < 1)
        t.update(x: 9_000, y: 9_000) // Spielstand geladen: springt
        #expect(simd_distance(t.shown, SIMD2(9_000, 9_000)) < 0.001)
    }

    @Test("Mittags hell, nachts dunkel")
    func light() {
        #expect(daylight(hour: 13) > 0.9)
        #expect(daylight(hour: 1) == 0)
        #expect(sunDirection(hour: 13).y < 0)
    }

    @Test("Bänder und Kästen zeigen nach außen bzw. oben")
    func meshes() {
        var m = MeshBuilder()
        m.strip(from: SIMD3(0, 0, 0), to: SIMD3(10, 0, 0), width: 4)
        #expect(m.normals.allSatisfy { $0.y > 0.99 })
        var b = MeshBuilder()
        b.box(base: .zero, width: 2, depth: 2, height: 2)
        b.gableRoof(base: .zero, width: 2, depth: 2, wallHeight: 2, roofHeight: 1)
        for (k, n) in b.normals.enumerated() {
            let p = b.positions[k]
            // Von der Hausmitte (1 m hoch) nach außen.
            #expect(simd_dot(n, p - SIMD3(0, 1, 0)) > -0.01)
        }
    }

    @Test("Feed dekodiert Welt und Zustand")
    func feed() throws {
        let json = #"{"type":"state","gameId":2,"paused":false,"speed":5,"hour":7.5,"weatherId":"base:klar","clock":"07:30","vehicles":[{"id":"v1","label":"RTW 1/83-1","cls":"rtw","x":10,"y":20,"status":3,"moving":true,"emergency":true}],"incidents":[],"waitingCalls":1}"#
        guard case let .state(s) = try FeedMessage.decode(Data(json.utf8)) else {
            Issue.record("kein Zustand")
            return
        }
        #expect(s.vehicles.first?.cls == .rtw)
        #expect(s.waitingCalls == 1)
    }
}
