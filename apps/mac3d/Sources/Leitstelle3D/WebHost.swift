// Die Leitstellen-Software als WKWebView (ADR-0022): Simulation (Web Worker) und Oberfläche aus
// dem gemeinsamen TypeScript-Code. Seiten kommen aus dem App-Bundle über das Schema „ls112://",
// nichts aus dem Netz (Regel 6).

import AppKit
import Leitstelle3DKit
import UniformTypeIdentifiers
import WebKit

@MainActor
final class WebHost: NSObject {
    let webView: WKWebView
    /// Nachrichten aus dem Web-Teil (Welt, Lage, Log, Diagnose).
    var onMessage: ((FeedMessage) -> Void)?

    override init() {
        let config = WKWebViewConfiguration()
        let root = Bundle.main.resourceURL?.appending(path: "web") ?? URL(filePath: "/")
        config.setURLSchemeHandler(BundleSchemeHandler(root: root), forURLScheme: "ls112")
        // Die Simulation darf nicht gedrosselt werden, wenn die 3D-Ansicht davor liegt.
        config.preferences.inactiveSchedulingPolicy = .none
        config.websiteDataStore = .default()
        let controller = WKUserContentController()
        config.userContentController = controller
        webView = WKWebView(frame: NSRect(x: 0, y: 0, width: 1600, height: 900), configuration: config)
        webView.isInspectable = ProcessInfo.processInfo.environment["LS112_INSPECT"] == "1"
        super.init()
        controller.add(WeakHandler(self), name: "ls112")
        webView.load(URLRequest(url: URL(string: "ls112://app/index.html")!))
    }

    fileprivate func receive(_ body: Any) {
        guard JSONSerialization.isValidJSONObject(body),
              let data = try? JSONSerialization.data(withJSONObject: body)
        else { return }
        do {
            if let message = try FeedMessage.decode(data) { onMessage?(message) }
        } catch {
            NSLog("Leitstelle3D: Feed nicht lesbar: %@", String(describing: error))
        }
    }

    /// Befehl an die Oberfläche (`window.ls112Shell`, siehe web/src/boot.ts).
    func shell(_ call: String) {
        webView.evaluateJavaScript("window.ls112Shell && window.ls112Shell.\(call)", completionHandler: nil)
    }

    func focusVehicle(_ id: String) { shell("focusVehicle(\(Self.quoted(id)))") }
    func openIncident(_ id: String) { shell("openIncident(\(Self.quoted(id)))") }
    func acceptCall() { shell("acceptCall()") }
    func togglePause() { shell("togglePause()") }

    /// Beim Beenden sichern – wartet, bis der Sim-Worker gespeichert hat.
    func suspend() async {
        _ = try? await webView.callAsyncJavaScript(
            "await (window.ls112Shell ? window.ls112Shell.suspend() : null)",
            contentWorld: .page
        )
    }

    /// Bild der Oberfläche für die Monitore im Leitstellenraum.
    func snapshot() async -> CGImage? {
        let config = WKSnapshotConfiguration()
        config.snapshotWidth = 1280
        guard let image = try? await webView.takeSnapshot(configuration: config) else { return nil }
        return image.cgImage(forProposedRect: nil, context: nil, hints: nil)
    }

    private static func quoted(_ s: String) -> String {
        let data = (try? JSONSerialization.data(withJSONObject: [s])) ?? Data("[\"\"]".utf8)
        let array = String(decoding: data, as: UTF8.self)
        return String(array.dropFirst().dropLast())
    }
}

/// WKUserContentController hält seinen Handler fest – darum nur schwach auf den Host zeigen.
private final class WeakHandler: NSObject, WKScriptMessageHandler {
    weak var host: WebHost?
    init(_ host: WebHost) { self.host = host }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        host?.receive(message.body)
    }
}

/// Liefert Dateien aus `Resources/web` des App-Bundles. Nur Pfade unterhalb davon.
private final class BundleSchemeHandler: NSObject, WKURLSchemeHandler {
    let root: URL
    init(root: URL) { self.root = root.standardizedFileURL }

    func webView(_ webView: WKWebView, start task: any WKURLSchemeTask) {
        guard let url = task.request.url else { return }
        let path = url.path.isEmpty || url.path == "/" ? "/index.html" : url.path
        let file = root.appending(path: String(path.dropFirst())).standardizedFileURL
        guard file.path.hasPrefix(root.path), let data = try? Data(contentsOf: file) else {
            let response = HTTPURLResponse(url: url, statusCode: 404, httpVersion: "HTTP/1.1", headerFields: nil)!
            task.didReceive(response)
            task.didFinish()
            return
        }
        let mime = UTType(filenameExtension: file.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        let type = file.pathExtension == "js" || file.pathExtension == "mjs" ? "text/javascript" : mime
        let response = HTTPURLResponse(
            url: url,
            statusCode: 200,
            httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": type, "Content-Length": String(data.count), "Cache-Control": "no-store"]
        )!
        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: any WKURLSchemeTask) {}
}
