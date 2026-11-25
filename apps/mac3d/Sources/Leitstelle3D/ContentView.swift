// Hauptfenster: Die Leitstellen-Software liegt immer im Fenster (damit sie weiterläuft und Bilder
// für die Monitore liefert); Leitstellenraum und Lage 3D liegen darüber.

import AppKit
import Leitstelle3DKit
import SwiftUI
import WebKit

struct ContentView: View {
    @Bindable var model: AppModel

    var body: some View {
        ZStack {
            WebViewHost(webView: model.web.webView)
            switch model.mode {
            case .room:
                ControlRoomView(model: model).transition(.opacity)
            case .world:
                WorldView(model: model).transition(.opacity)
            case .workstation:
                EmptyView()
            }
        }
        .animation(.easeInOut(duration: 0.25), value: model.mode)
        .toolbar {
            ToolbarItem(placement: .principal) {
                Picker("Ansicht", selection: $model.mode) {
                    ForEach(ViewMode.allCases) { mode in
                        Label(mode.title, systemImage: mode.symbol).tag(mode)
                    }
                }
                .pickerStyle(.segmented)
                .labelStyle(.titleAndIcon)
                .help("Ansicht wechseln (⌘1 bis ⌘3)")
            }
            ToolbarItemGroup(placement: .primaryAction) {
                StatusBar(model: model)
            }
        }
        .navigationTitle("Leitstelle 112 3D")
        .task { await SnapshotRunner.run(model: model) }
    }
}

/// Uhr, wartende Notrufe und verfolgtes Fahrzeug in der Werkzeugleiste.
private struct StatusBar: View {
    let model: AppModel

    var body: some View {
        if let state = model.state {
            if model.mode == .world, let id = model.followVehicleId,
               let vehicle = state.vehicles.first(where: { $0.id == id }) {
                Button {
                    model.followVehicleId = nil
                } label: {
                    Label("Folgt: \(vehicle.label)", systemImage: "scope")
                }
                .help("Kamera vom Fahrzeug lösen")
            }
            if state.waitingCalls > 0 {
                Button {
                    model.answerPhone()
                } label: {
                    Label("\(state.waitingCalls) Notruf\(state.waitingCalls == 1 ? "" : "e")", systemImage: "phone.arrow.down.left.fill")
                }
                .tint(.red)
                .help("Notruf annehmen (⇧⌘N)")
            }
            Button {
                model.web.togglePause()
            } label: {
                Label(state.paused ? "Weiter" : "Pause", systemImage: state.paused ? "play.fill" : "pause.fill")
            }
            .help("Pause / Weiter (⌘P)")
            Text("\(state.clock)  \(state.speed.formatted())×")
                .font(.system(.title3, design: .monospaced, weight: .semibold))
                .monospacedDigit()
                .padding(.horizontal, 4)
        }
    }
}

/// WKWebView in SwiftUI. Dieselbe Instanz bleibt die ganze Zeit bestehen.
private struct WebViewHost: NSViewRepresentable {
    let webView: WKWebView

    func makeNSView(context: Context) -> WKWebView { webView }
    func updateNSView(_ view: WKWebView, context: Context) {}
}
