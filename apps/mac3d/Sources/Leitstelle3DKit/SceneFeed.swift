// Szenen-Feed aus dem Web-Teil (apps/mac3d/web/src/scene-feed.ts, ADR-0022).
// Reine Daten: Was die Simulation zeigt, nicht was sie entscheidet.

import Foundation

/// Statische 3D-Welt, einmal je Spiel.
public struct SceneWorld: Decodable, Sendable, Equatable {
    public struct Town: Decodable, Sendable, Equatable {
        public let name: String
        public let x: Double
        public let y: Double
        public let population: Double
        public let city: Bool
    }

    public struct Station: Decodable, Sendable, Equatable {
        public let id: String
        public let name: String
        public let kind: Kind
        public let x: Double
        public let y: Double

        public enum Kind: String, Decodable, Sendable {
            case rettungswache, notarztstandort, feuerwache, luftrettung
        }
    }

    public struct Hospital: Decodable, Sendable, Equatable {
        public let id: String
        public let name: String
        public let x: Double
        public let y: Double
    }

    public struct River: Decodable, Sendable, Equatable {
        public let width: Double
        /// x, y abwechselnd (Meter).
        public let points: [Double]
    }

    /// Breite und Höhe der Region in Metern.
    public let size: [Double]
    /// Je Abschnitt: Klasse, x1, y1, x2, y2.
    public let roads: [[Double]]
    public let rivers: [River]
    public let forests: [[Double]]
    public let towns: [Town]
    /// x, y je Wohnhaus.
    public let houses: [Double]
    public let stations: [Station]
    public let hospitals: [Hospital]

    public var width: Double { size.first ?? 0 }
    public var height: Double { size.count > 1 ? size[1] : 0 }
}

/// Bewegliche Lage, bis zu zehnmal je Sekunde.
public struct SceneState: Decodable, Sendable, Equatable {
    public struct Vehicle: Decodable, Sendable, Equatable, Identifiable {
        public let id: String
        public let label: String
        public let cls: VehicleClass
        public let x: Double
        public let y: Double
        public let status: Int
        public let moving: Bool
        public let emergency: Bool
    }

    public struct Incident: Decodable, Sendable, Equatable, Identifiable {
        public let id: String
        public let label: String
        public let cls: IncidentClass
        public let x: Double
        public let y: Double
        public let open: Bool
    }

    public let gameId: Int
    public let paused: Bool
    public let speed: Double
    /// Tageszeit in Stunden (0–24).
    public let hour: Double
    public let weatherId: String
    public let clock: String
    public let vehicles: [Vehicle]
    public let incidents: [Incident]
    public let waitingCalls: Int
}

public enum VehicleClass: String, Decodable, Sendable {
    case rtw, ktw, nef, rth, fire, command, other
}

public enum IncidentClass: String, Decodable, Sendable {
    case rd, fire, th, mci
}

/// Eine Nachricht aus dem Web-Teil.
public enum FeedMessage: Sendable {
    case world(SceneWorld)
    case state(SceneState)
    case log(level: String, message: String)
    case diagnostics(fileName: String, data: Data)
    case ready

    /// Dekodiert den Rumpf einer WKScriptMessage (bereits als JSON-Daten).
    public static func decode(_ json: Data) throws -> FeedMessage? {
        struct Head: Decodable { let type: String }
        struct Log: Decodable { let level: String; let message: String }
        struct Diagnostics: Decodable { let fileName: String; let base64: String }
        let decoder = JSONDecoder()
        switch try decoder.decode(Head.self, from: json).type {
        case "world": return .world(try decoder.decode(SceneWorld.self, from: json))
        case "state": return .state(try decoder.decode(SceneState.self, from: json))
        case "log":
            let l = try decoder.decode(Log.self, from: json)
            return .log(level: l.level, message: l.message)
        case "diagnostics":
            let d = try decoder.decode(Diagnostics.self, from: json)
            guard let data = Data(base64Encoded: d.base64) else { return nil }
            return .diagnostics(fileName: d.fileName, data: data)
        case "ready": return .ready
        default: return nil
        }
    }
}
