import AppKit
import WebKit

@MainActor
private final class PreviewNavigation: NSObject, WKNavigationDelegate {
    var loaded = false
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { loaded = true }
}

@MainActor
func nativeJournalPreviewSelections(fixtures: URL) throws -> [String: String] {
    struct Passage: Decodable { let name: String; let start: String; let end: String }
    let folder = fixtures.appendingPathComponent("tabbed")
    let samples = try JSONDecoder().decode([Passage].self, from: Data(contentsOf: folder.appendingPathComponent("selection-cases.json")))
    let markdown = try String(contentsOf: folder.appendingPathComponent("article.md"), encoding: .utf8)
    _ = NSApplication.shared
    let receiver = MarkdownPreviewView.Coordinator()
    receiver.selectionScope = .paper
    var selected: String?
    receiver.onSelection = { selected = $0.text }
    let config = WKWebViewConfiguration()
    config.userContentController.add(receiver, name: MarkdownPreviewView.Coordinator.selectionMessageName)
    config.userContentController.addUserScript(WKUserScript(source: MarkdownPreviewView.Coordinator.selectionBridgeScript,
                                                           injectionTime: .atDocumentEnd, forMainFrameOnly: true))
    let web = WKWebView(frame: NSRect(x: 0, y: 0, width: 860, height: 640), configuration: config)
    let navigation = PreviewNavigation()
    web.navigationDelegate = navigation
    let window = NSWindow(contentRect: web.frame, styleMask: [.borderless], backing: .buffered, defer: false)
    window.contentView = web
    web.loadHTMLString(MarkdownPreviewHTMLRenderer.render(markdown: markdown, title: "Tabbed"), baseURL: nil)
    func wait(_ condition: () -> Bool, _ message: String) throws {
        let deadline = Date().addingTimeInterval(12)
        while !condition() && Date() < deadline { RunLoop.main.run(until: Date().addingTimeInterval(0.04)) }
        if !condition() { throw NSError(domain: "JournalPreview", code: 1, userInfo: [NSLocalizedDescriptionKey: message]) }
    }
    try wait({ navigation.loaded }, "Native journal preview did not load")
    let select = """
        const root = document.querySelector('article');
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        const nodes = [];
        for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n);
        const a = nodes.findIndex(n => n.data.includes(start));
        const b = nodes.findIndex((n,i) => i >= a && n.data.includes(end));
        if (a < 0 || b < 0) throw Error('Missing passage: ' + start + ' / ' + end);
        const range = document.createRange();
        range.setStart(nodes[a], nodes[a].data.indexOf(start));
        range.setEnd(nodes[b], nodes[b].data.indexOf(end) + end.length);
        getSelection().removeAllRanges(); getSelection().addRange(range);
        root.dispatchEvent(new MouseEvent('mouseup', {bubbles:true}));
        return true;
        """
    var result: [String: String] = [:]
    for sample in samples {
        selected = nil
        var scriptError: Error?
        web.callAsyncJavaScript(select, arguments: ["start": sample.start, "end": sample.end], in: nil, in: .page) {
            if case .failure(let error) = $0 { scriptError = error }
        }
        try wait({ selected != nil || scriptError != nil }, "No native selection for " + sample.name)
        if let scriptError { throw scriptError }
        result[sample.name] = selected
    }
    return result
}
