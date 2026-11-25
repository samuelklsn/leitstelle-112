// Leitstelle 112 3D (ADR-0022): ein Fenster mit drei Ansichten – Leitstellenraum, Arbeitsplatz
// und der Landkreis in 3D. Die Simulation läuft im Web-Teil weiter, egal welche Ansicht offen ist.

import AppKit
import SwiftUI

@main
struct Leitstelle3DApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @State private var model = AppModel()

    init() {
        VehicleStateComponent.registerComponent()
    }

    var body: some Scene {
        Window("Leitstelle 112 3D", id: "main") {
            ContentView(model: model)
                .frame(minWidth: 1100, minHeight: 700)
                .onAppear { delegate.model = model }
        }
        .defaultSize(width: 1600, height: 950)
        .commands {
            CommandMenu("Ansicht wechseln") {
                ForEach(Array(ViewMode.allCases.enumerated()), id: \.element) { index, mode in
                    Button(mode.title) { model.mode = mode }
                        .keyboardShortcut(KeyEquivalent(Character(String(index + 1))), modifiers: .command)
                }
                Divider()
                Button("Notruf annehmen") { model.answerPhone() }
                    .keyboardShortcut("n", modifiers: [.command, .shift])
                Button("Pause / Weiter") { model.web.togglePause() }
                    .keyboardShortcut("p", modifiers: .command)
            }
        }
    }
}

/// Beim Beenden den Spielstand sichern (wie unter Windows und Android).
final class AppDelegate: NSObject, NSApplicationDelegate {
    var model: AppModel?

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard let model else { return .terminateNow }
        Task { @MainActor in
            await model.web.suspend()
            sender.reply(toApplicationShouldTerminate: true)
        }
        return .terminateLater
    }
}
