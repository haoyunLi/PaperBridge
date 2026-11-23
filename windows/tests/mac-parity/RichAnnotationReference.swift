import AppKit
import WebKit

@MainActor
func nativeRichAnnotationRanges(fixtures: URL) throws -> [Bool] {
    _ = NSApplication.shared
    let article = try String(contentsOf: fixtures.appendingPathComponent("tabbed/article.md"), encoding: .utf8)
        .replacingOccurrences(of: "\r\n", with: "\n")
    guard let table = article.components(separatedBy: "\n\n").first(where: { $0.hasPrefix("| Software |") }) else {
        throw CocoaError(.fileReadCorruptFile)
    }
    let changed = table.replacingOccurrences(of: "Software |", with: "Software package name |")
        .replacingOccurrences(of: "Columns Only", with: "[Selected columns](data.md \"Columns Only\")")
    let markup = table + "\n\n## Revised table\n\n" + changed + "\n\n**新的译文**"
    let view = WKWebView(frame: NSRect(x: 0, y: 0, width: 800, height: 600))
    let window = NSWindow(contentRect: view.frame, styleMask: [.borderless], backing: .buffered, defer: false)
    window.contentView = view
    view.loadHTMLString(MarkdownPreviewHTMLRenderer.render(markdown: markup, title: "Table revision"), baseURL: nil)
    let deadline = Date().addingTimeInterval(20)
    while view.isLoading && Date() < deadline { RunLoop.main.run(until: Date().addingTimeInterval(0.05)) }
    var result: Result<Any, Error>?
    view.callAsyncJavaScript("""
        const tables = Array.from(document.querySelectorAll('article table'), table =>
            Array.from(table.rows, row => Array.from(row.cells, cell => cell.textContent).join('')).join(''));
        return [...tables, document.querySelector('article p:last-child')?.textContent || ''];
        """, arguments: [:], in: nil, in: .page) { result = $0 }
    while result == nil && Date() < deadline { RunLoop.main.run(until: Date().addingTimeInterval(0.05)) }
    guard let result, let contexts = try result.get() as? [String], contexts.count == 3,
          contexts[0].contains("Columns Only"), contexts[1].contains("Selected columns"),
          !contexts[1].contains("Columns Only"), contexts[2] == "新的译文" else {
        throw NSError(domain: "RichAnnotationReference", code: 1,
                      userInfo: [NSLocalizedDescriptionKey: "WebKit did not render the original table, revised table and translation."])
    }
    let old = contexts[0] as NSString
    let revised = contexts[1] as NSString
    let samples: [(String, Int, String, ReaderTextSide)] = [
        ("Row Equality Only", old.range(of: "Row Equality Only").location, contexts[1], .original),
        ("Columns Only", old.range(of: "Columns Only").location, contexts[1], .original),
        ("+", old.range(of: "+").location, contexts[1], .original),
        ("+", revised.range(of: "+", options: .backwards).location, contexts[1], .original),
        ("Columns Only", (table as NSString).range(of: "Columns Only").location, contexts[1], .original),
        ("旧译文", 0, contexts[2], .translation)
    ]
    return samples.map { quote, offset, context, side in
        PaperAnnotation(paragraphID: 1, side: side, quote: quote, rangeLocation: offset,
                        rangeLength: quote.utf16.count).resolvedRange(in: context) != nil
    }
}
