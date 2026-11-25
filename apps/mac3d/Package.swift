// swift-tools-version: 6.2
import PackageDescription

// Leitstelle 112 3D (ADR-0022): Leitstellenraum und Landkreis in RealityKit, Simulation und
// Leitstellen-Oberfläche aus dem gemeinsamen TypeScript-Code im WKWebView.
let package = Package(
    name: "Leitstelle3D",
    platforms: [.macOS(.v26)],
    targets: [
        // Daten und Rechenwege ohne SwiftUI/RealityKit – testbar ohne App.
        .target(name: "Leitstelle3DKit"),
        .executableTarget(
            name: "Leitstelle3D",
            dependencies: ["Leitstelle3DKit"],
            swiftSettings: [.defaultIsolation(MainActor.self)]
        ),
        .testTarget(name: "Leitstelle3DKitTests", dependencies: ["Leitstelle3DKit"]),
    ]
)
