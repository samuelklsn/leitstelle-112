// Zustand der 3D-App: welche Ansicht, was der Web-Teil zuletzt gemeldet hat, wem die Kamera folgt.

import AppKit
import Leitstelle3DKit
import Observation
import UniformTypeIdentifiers

enum ViewMode: String, CaseIterable, Identifiable {
    /// Der Leitstellenraum in 3D – die Monitore zeigen die Leitstellen-Software.
    case room
    /// Die Leitstellen-Software bildschirmfüllend: Notrufe annehmen, disponieren.
    case workstation
    /// Der Landkreis in 3D mit fahrenden Fahrzeugen.
    case world

    var id: String { rawValue }

    var title: String {
        switch self {
        case .room: "Leitstelle"
        case .workstation: "Arbeitsplatz"
        case .world: "Lage 3D"
        }
    }

    var symbol: String {
        switch self {
        case .room: "building.2"
        case .workstation: "desktopcomputer"
        case .world: "map"
        }
    }
}

@MainActor
@Observable
final class AppModel {
    var mode: ViewMode = .room
    private(set) var world: SceneWorld?
    private(set) var state: SceneState?
    /// Fahrzeug, dem die Kamera in der Lage 3D folgt.
    var followVehicleId: String?
    /// Letztes Bild der Leitstellen-Software für die Monitore im Raum.
    private(set) var monitorImage: CGImage?
    private(set) var ready = false

    @ObservationIgnored let web = WebHost()
    @ObservationIgnored private var snapshotTask: Task<Void, Never>?

    init() {
        web.onMessage = { [weak self] message in self?.handle(message) }
        startSnapshots()
    }

    private func handle(_ message: FeedMessage) {
        switch message {
        case let .world(w): world = w
        case let .state(s):
            state = s
            if let id = followVehicleId, !s.vehicles.contains(where: { $0.id == id }) { followVehicleId = nil }
        case let .log(level, text): NSLog("Leitstelle3D [%@] %@", level, text)
        case let .diagnostics(fileName, data): saveDiagnostics(fileName: fileName, data: data)
        case .ready: ready = true
        }
    }

    /// Fahrzeug in der 3D-Welt angeklickt: verfolgen und in der Software auswählen.
    func selectVehicle(_ id: String) {
        followVehicleId = id
        web.focusVehicle(id)
    }

    /// Einsatz angeklickt: am Arbeitsplatz öffnen (Disposition, falls noch Kräfte fehlen).
    func selectIncident(_ id: String) {
        web.openIncident(id)
        mode = .workstation
    }

    func answerPhone() {
        web.acceptCall()
        mode = .workstation
    }

    /// Bilder für die Monitore: einmal je Sekunde, nur solange der Raum zu sehen ist.
    private func startSnapshots() {
        snapshotTask = Task { [weak self] in
            while !Task.isCancelled {
                if let self, self.mode == .room, let image = await self.web.snapshot() {
                    self.monitorImage = image
                }
                try? await Task.sleep(for: .seconds(1))
            }
        }
    }

    private func saveDiagnostics(fileName: String, data: Data) {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = fileName
        panel.allowedContentTypes = [.zip]
        guard panel.runModal() == .OK, let url = panel.url else { return }
        try? data.write(to: url)
        NSWorkspace.shared.activateFileViewerSelecting([url])
    }
}
