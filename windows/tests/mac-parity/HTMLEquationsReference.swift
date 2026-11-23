import AppKit
import WebKit

@MainActor
func nativeHTMLEquations(fixtures: URL) throws -> [[String: Any]] {
    let source = try String(contentsOf: fixtures.appendingPathComponent("html-equations.md"), encoding: .utf8)
    let repo = fixtures.deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    let mathJax = try String(contentsOf: repo.appendingPathComponent("PaperBridge/Resources/tex-svg-full.js"), encoding: .utf8)
    let configuration = WKWebViewConfiguration()
    configuration.websiteDataStore = .nonPersistent()
    let delimiters = #"""
        window.MathJax = {tex: {inlineMath: [['$', '$'], ['\\(', '\\)']], displayMath: [['$$', '$$'], ['\\[', '\\]']],
          processEscapes: true}, svg: {fontCache: 'local'}, options: {skipHtmlTags: ['script','noscript','style','textarea','pre','code']}};
        """#
    configuration.userContentController.addUserScript(WKUserScript(source: delimiters, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    configuration.userContentController.addUserScript(WKUserScript(source: mathJax, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
    let view = WKWebView(frame: NSRect(x: 0, y: 0, width: 720, height: 480), configuration: configuration)
    view.loadHTMLString(MarkdownPreviewHTMLRenderer.render(markdown: source, title: "Calibration"), baseURL: nil)
    let deadline = Date().addingTimeInterval(25)
    while view.isLoading && Date() < deadline { RunLoop.main.run(until: Date().addingTimeInterval(0.04)) }
    let script = """
        await MathJax.startup.promise;
        return Array.from(MathJax.startup.document.math, item => ({
          tex: item.math, display: item.display, in: item.typesetRoot.closest('td,th,caption,figcaption')?.localName || ''
        }));
        """
    var result: Result<Any, Error>?
    view.callAsyncJavaScript(script, arguments: [:], in: nil, in: .page) { result = $0 }
    while result == nil && Date() < deadline { RunLoop.main.run(until: Date().addingTimeInterval(0.04)) }
    guard let result, let formulas = try result.get() as? [[String: Any]], formulas.count == 5 else { throw CocoaError(.fileReadCorruptFile) }
    return formulas
}
