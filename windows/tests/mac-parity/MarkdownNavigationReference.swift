import AppKit
import WebKit

@MainActor
func nativeMarkdownNavigation(fixtures: URL) throws -> [[String: String]] {
    _ = NSApplication.shared
    let input = try String(contentsOf: fixtures.appendingPathComponent("markdown-navigation.md"), encoding: .utf8)
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: root) }
    let document = root.appendingPathComponent("preview.html")
    try MarkdownPreviewHTMLRenderer.render(markdown: input, title: "Workshop notes").write(to: document, atomically: true, encoding: .utf8)
    let view = WKWebView(frame: NSRect(x: 0, y: 0, width: 600, height: 250))
    let window = NSWindow(contentRect: view.frame, styleMask: [.borderless], backing: .buffered, defer: false)
    window.contentView = view
    let coordinator = MarkdownPreviewView.Coordinator()
    coordinator.allowedRoot = root.standardizedFileURL
    view.navigationDelegate = coordinator
    view.loadFileURL(document, allowingReadAccessTo: root)
    let deadline = Date().addingTimeInterval(20)
    while view.isLoading && Date() < deadline { RunLoop.main.run(until: Date().addingTimeInterval(0.05)) }
    let script = """
        const jumps = [];
        for (const link of document.querySelectorAll('article a[href^="#"]')) {
            link.click();
            let target;
            const end = performance.now() + 3000;
            do {
                await new Promise(resolve => setTimeout(resolve, 30));
                target = document.querySelector(':target');
            } while ((!target || target.id !== decodeURIComponent(link.hash.slice(1))) && performance.now() < end);
            if (!target || target.id !== decodeURIComponent(link.hash.slice(1)) || window.scrollY <= 0) throw Error('Heading jump failed');
            jumps.push({ label: link.textContent, id: target.id, heading: target.textContent });
        }
        return jumps;
        """
    var result: Result<Any, Error>?
    view.callAsyncJavaScript(script, arguments: [:], in: nil, in: .page) { result = $0 }
    while result == nil && Date() < deadline { RunLoop.main.run(until: Date().addingTimeInterval(0.05)) }
    guard let result, let jumps = try result.get() as? [[String: String]], jumps.count == 3 else {
        throw NSError(domain: "MarkdownNavigationReference", code: 1,
                      userInfo: [NSLocalizedDescriptionKey: "The Mac preview did not complete the three document links."])
    }
    return jumps
}
