import AppKit
import WebKit

@MainActor
private final class AttachmentPolicyObserver: NSObject, WKNavigationDelegate {
    let reader = MarkdownPreviewView.Coordinator()
    var followLinks = false
    var decision: (url: URL, policy: WKNavigationActionPolicy)?

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard action.navigationType == .linkActivated, let url = action.request.url else {
            decisionHandler(.allow)
            return
        }
        reader.webView(webView, decidePolicyFor: action) { policy in
            self.decision = (url, policy)
            decisionHandler(self.followLinks ? policy : .cancel)
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
            let script = """
            if (name === 'Measurements CSV') {
              const image = document.querySelector('img[alt="Local calibration panel"]');
              const caption = image?.closest('figure')?.querySelector('figcaption');
              if (!caption || caption.textContent !== image.alt || !caption.getClientRects().length) {
                throw Error('Missing same-directory figure caption: ' + document.body.innerText.slice(0, 300));
              }
              if (document.querySelector('img[alt="Reference response"]')) throw Error('Unexpected parent-relative image');
            }
            const link = [...document.links].find(a => a.textContent === name);
            if (!link) throw Error(name);
            link.click();
            return true;
            """
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

@MainActor
func nativeSupplementText(fixtures: URL) throws -> [[String: Any]] {
    struct Sample: Decodable { let file: String; let encoding: String; let text: String }
    let samples = try JSONDecoder().decode([Sample].self, from: Data(contentsOf: fixtures.appendingPathComponent("supplement-text.json")))
    let files = FileManager.default
    let root = files.temporaryDirectory.resolvingSymlinksInPath().appendingPathComponent(UUID().uuidString, isDirectory: true)
    try files.createDirectory(at: root, withIntermediateDirectories: true)
    defer { try? files.removeItem(at: root) }
    let observer = AttachmentPolicyObserver()
    observer.followLinks = true
    observer.reader.allowedRoot = root.standardizedFileURL
    let view = WKWebView(frame: NSRect(x: 0, y: 0, width: 640, height: 440))
    let window = NSWindow(contentRect: view.frame, styleMask: [.borderless], backing: .buffered, defer: false)
    window.contentView = view
    view.navigationDelegate = observer
    let index = root.appendingPathComponent("index.html")
    var observed = [[String: Any]]()
    for sample in samples {
        let encoded: Data
        switch sample.encoding {
        case "utf16le": encoded = Data([0xff, 0xfe]) + sample.text.data(using: .utf16LittleEndian)!
        case "utf16be": encoded = Data([0xfe, 0xff]) + sample.text.data(using: .utf16BigEndian)!
        case "utf8bom": encoded = Data([0xef, 0xbb, 0xbf]) + Data(sample.text.utf8)
        default: encoded = Data(sample.text.utf8)
        }
        try encoded.write(to: root.appendingPathComponent(sample.file))
        let link = "[Read data](\(sample.file.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed)!))"
        try MarkdownPreviewHTMLRenderer.render(markdown: link, title: sample.file).write(to: index, atomically: true, encoding: .utf8)
        observer.decision = nil
        view.loadFileURL(index, allowingReadAccessTo: root)
        var deadline = Date().addingTimeInterval(10)
        while (view.isLoading || view.url?.lastPathComponent != index.lastPathComponent) && Date() < deadline {
            RunLoop.main.run(until: Date().addingTimeInterval(0.04))
        }
        view.evaluateJavaScript("document.querySelector('a').click()")
        deadline = Date().addingTimeInterval(6)
        while (observer.decision == nil || view.isLoading || view.url?.lastPathComponent != sample.file) && Date() < deadline {
            RunLoop.main.run(until: Date().addingTimeInterval(0.04))
        }
        guard let decision = observer.decision, decision.url.lastPathComponent == sample.file, decision.policy == .allow else {
            throw NSError(domain: "AttachmentNavigationReference", code: 2,
                          userInfo: [NSLocalizedDescriptionKey: "The Mac did not follow the \(sample.file) attachment link."])
        }
        let loaded = view.url?.lastPathComponent == sample.file && !view.isLoading
        var display: [String: String]?
        if loaded {
            view.evaluateJavaScript("({ text: document.querySelector('pre')?.textContent ?? document.body?.innerText ?? '', charset: document.characterSet, mime: document.contentType })") { response, _ in
                display = response as? [String: String]
            }
            deadline = Date().addingTimeInterval(5)
            while display == nil && Date() < deadline { RunLoop.main.run(until: Date().addingTimeInterval(0.04)) }
        }
        observed.append(["file": sample.file, "loaded": loaded, "text": display?["text"] ?? "",
                         "charset": display?["charset"] ?? "", "mime": display?["mime"] ?? ""])
    }
    return observed
}
