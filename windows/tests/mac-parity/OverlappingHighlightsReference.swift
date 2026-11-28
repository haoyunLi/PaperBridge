import AppKit
import SwiftUI

@MainActor
func nativeOverlappingHighlights(fixtures: URL) throws -> [String: [[String]]] {
    struct Sample: Decodable {
        struct Mark: Decodable { let quote: String; let color: PaperHighlightColor }
        let text: String
        let marks: [Mark]
    }
    let sample = try JSONDecoder().decode(Sample.self, from: Data(contentsOf: fixtures.appendingPathComponent("overlap-highlights.json")))
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    let store = WorkspaceStore(rootURL: root)
    let model = PaperReaderViewModel(workspaceStore: store)
    model.applyLoadedPaper(PaperDocument(name: "emcee", checksum: "overlapping-colors", cleanedText: sample.text,
        paragraphs: [sample.text], excludedReferenceParagraphs: [], referenceSectionTitle: nil))
    func select(_ i: Int) {
        let quote = sample.marks[i].quote
        model.captureTextSelection(ReaderTextSelection(paragraphID: 1, side: .original, text: quote, context: sample.text,
            rangeLocation: (sample.text as NSString).range(of: quote).location, rangeLength: quote.utf16.count))
    }
    func textView(_ root: NSView) -> NSTextView? {
        if let view = root as? NSTextView { return view }
        for child in root.subviews { if let view = textView(child) { return view } }
        return nil
    }
    func rendered(_ marks: [PaperAnnotation], width: CGFloat) throws -> [[String]] {
        let content = SelectableAcademicText(text: sample.text, paragraphID: 1, side: .original,
            annotations: marks, onSelection: { _ in })
        let host = NSHostingView(rootView: content)
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: width, height: 240),
                              styleMask: [.borderless], backing: .buffered, defer: false)
        window.contentView = host
        window.orderFront(nil)
        defer { window.orderOut(nil) }
        let deadline = Date().addingTimeInterval(10)
        while textView(host)?.string != sample.text && Date() < deadline { RunLoop.main.run(until: Date().addingTimeInterval(0.03)) }
        guard let attributed = textView(host)?.textStorage, attributed.string == sample.text else { throw CocoaError(.fileReadCorruptFile) }
        var output: [[String]] = []
        var previous = -2
        for i in 0..<attributed.length {
            guard let color = attributed.attribute(.backgroundColor, at: i, effectiveRange: nil) as? NSColor,
                  let name = PaperHighlightColor.allCases.first(where: { $0.nsColor.isEqual(color) })?.rawValue else { continue }
            let character = (sample.text as NSString).substring(with: NSRange(location: i, length: 1))
            if previous + 1 == i && output.last?.first == name { output[output.count - 1][1] += character }
            else { output.append([name, character]) }
            previous = i
        }
        return output
    }
    for (index, mark) in sample.marks.enumerated() {
        select(index)
        model.applyHighlight(mark.color)
    }
    model.saveSelectionNote("Keep this exact overlap")
    let initial = try rendered(model.annotations, width: 540)
    select(0)
    model.applyHighlight(.teal)
    let recolored = try rendered(model.annotations, width: 260)
    select(1)
    model.removeSelectionHighlight()
    let removed = try rendered(model.annotations, width: 260)
    model.undoAnnotationChange()
    model.persistWorkspace()
    store.flush()
    let reopened = PaperReaderViewModel(workspaceStore: store)
    guard reopened.annotations.contains(where: { $0.note == "Keep this exact overlap" }) else { throw CocoaError(.fileReadCorruptFile) }
    return ["initial": initial, "recolored": recolored, "removed": removed, "reopened": try rendered(reopened.annotations, width: 540)]
}
