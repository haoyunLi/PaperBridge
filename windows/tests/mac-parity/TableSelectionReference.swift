import AppKit
import WebKit

@MainActor
func nativeTableSelectionQuote() throws -> String {
    _ = NSApplication.shared
    let receiver = MarkdownPreviewView.Coordinator()
    receiver.selectionScope = .paper
    var quote: String?
    receiver.onSelection = { quote = $0.text }

    let controller = WKUserContentController()
    controller.add(receiver, name: MarkdownPreviewView.Coordinator.selectionMessageName)
    controller.addUserScript(WKUserScript(source: MarkdownPreviewView.Coordinator.selectionBridgeScript,
                                          injectionTime: .atDocumentEnd, forMainFrameOnly: true))
    let selectCells = """
        const table = document.querySelector('article table');
        const first = table.querySelectorAll('th')[1].firstChild;
        const last = table.querySelectorAll('td')[1].firstChild;
        const range = document.createRange();
        range.setStart(first, 0);
        range.setEnd(last, last.length);
        getSelection().removeAllRanges();
        getSelection().addRange(range);
        table.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        """
    controller.addUserScript(WKUserScript(source: selectCells, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
    let config = WKWebViewConfiguration()
    config.userContentController = controller
    let view = WKWebView(frame: NSRect(x: 0, y: 0, width: 800, height: 600), configuration: config)
    let window = NSWindow(contentRect: view.frame, styleMask: [.borderless], backing: .buffered, defer: false)
    window.contentView = view
    let table = "<table><thead><tr><th>Method</th><th>Score</th></tr></thead><tbody><tr><td>Attention</td><td>42</td></tr></tbody></table>"
    view.loadHTMLString(MarkdownPreviewHTMLRenderer.render(markdown: table, title: "Cell selection"), baseURL: nil)
    let deadline = Date().addingTimeInterval(20)
    while quote == nil && Date() < deadline {
        RunLoop.main.run(until: Date().addingTimeInterval(0.05))
    }
    guard let quote else {
        throw NSError(domain: "TableSelectionReference", code: 1, userInfo: [
            NSLocalizedDescriptionKey: "The native Markdown preview did not report the selection across table rows."
        ])
    }
    return quote
}
