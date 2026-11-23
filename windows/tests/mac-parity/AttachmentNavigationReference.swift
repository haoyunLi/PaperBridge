import AppKit
import WebKit

@MainActor
private final class AttachmentPolicyObserver: NSObject, WKNavigationDelegate {
    let reader = MarkdownPreviewView.Coordinator()
    var decision: (url: URL, policy: WKNavigationActionPolicy)?

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard action.navigationType == .linkActivated, let url = action.request.url else {
            decisionHandler(.allow)
            return
        }
        reader.webView(webView, decidePolicyFor: action) { policy in
            self.decision = (url, policy)
            // Leave the fixture open for its next link after observing the production policy.
            decisionHandler(.cancel)
        }
    }
}

@MainActor
func nativeAttachmentLinks(fixtures: URL) throws -> [[String: String]] {
    let files = FileManager.default
    let root = files.temporaryDirectory.resolvingSymlinksInPath().appendingPathComponent(UUID().uuidString, isDirectory: true)
    let supplement = root.appendingPathComponent("supplement", isDirectory: true)
    let images = root.appendingPathComponent("images", isDirectory: true)
    try files.createDirectory(at: supplement, withIntermediateDirectories: true)
    defer { try? files.removeItem(at: root) }
    try files.createDirectory(at: images, withIntermediateDirectories: true)
    try files.copyItem(at: fixtures.appendingPathComponent("landscape-swatches.pdf"), to: supplement.appendingPathComponent("Reference pages.pdf"))
    try files.copyItem(at: fixtures.appendingPathComponent("tabbed/images/page_2_chart_5.jpg"), to: images.appendingPathComponent("panel.jpg"))
    try files.copyItem(at: images.appendingPathComponent("panel.jpg"), to: supplement.appendingPathComponent("panel.jpg"))
    try "sample,temperature\ncontrol,18.5\n".write(to: supplement.appendingPathComponent("温度.csv"), atomically: true, encoding: .utf8)
    try files.copyItem(at: fixtures.appendingPathComponent("supplement-protocol.md"), to: supplement.appendingPathComponent("protocol.md"))

    let observer = AttachmentPolicyObserver()
    observer.reader.allowedRoot = root.standardizedFileURL
    let view = WKWebView(frame: NSRect(x: 0, y: 0, width: 650, height: 450))
    let window = NSWindow(contentRect: view.frame, styleMask: [.borderless], backing: .buffered, defer: false)
    window.contentView = view
    view.navigationDelegate = observer
    var observed = [[String: String]]()
    let cases = [
        ("supplement-links.md", root, ["Calibration protocol", "Reference PDF"]),
        ("supplement-protocol.md", supplement, ["Measurements CSV", "Full-size panel", "Reference PDF"])
    ]
    for (name, folder, labels) in cases {
        let text = try String(contentsOf: fixtures.appendingPathComponent(name), encoding: .utf8)
        let rendered = folder.appendingPathComponent("preview.html")
        try MarkdownPreviewHTMLRenderer.render(markdown: text, title: name).write(to: rendered, atomically: true, encoding: .utf8)
        view.loadFileURL(rendered, allowingReadAccessTo: root)
        let loadDeadline = Date().addingTimeInterval(15)
        while view.isLoading && Date() < loadDeadline { RunLoop.main.run(until: Date().addingTimeInterval(0.05)) }
        for label in labels {
            observer.decision = nil
            let script = "const link = [...document.links].find(a => a.textContent === name); if (!link) throw Error(name); link.click(); return true;"
            var outcome: Result<Any, Error>?
            view.callAsyncJavaScript(script, arguments: ["name": label], in: nil, in: .page) { outcome = $0 }
            let deadline = Date().addingTimeInterval(8)
            while Date() < deadline && (outcome == nil || observer.decision == nil) {
                if case .failure(let error) = outcome { throw error }
                RunLoop.main.run(until: Date().addingTimeInterval(0.05))
            }
            guard let clicked = observer.decision, clicked.url.isFileURL,
                  clicked.url.path.hasPrefix(root.path + "/"), files.fileExists(atPath: clicked.url.path),
                  clicked.policy == (clicked.url.pathExtension.lowercased() == "pdf" ? .cancel : .allow) else {
                throw NSError(domain: "AttachmentNavigationReference", code: 1,
                              userInfo: [NSLocalizedDescriptionKey: "Unexpected native destination or policy for \(name) / \(label)."])
            }
            observed.append(["source": name, "label": label, "path": String(clicked.url.path.dropFirst(root.path.count + 1)),
                             "policy": clicked.policy == .allow ? "preview" : "systemPDF", "fragment": clicked.url.fragment ?? ""])
        }
    }
    return observed
}
