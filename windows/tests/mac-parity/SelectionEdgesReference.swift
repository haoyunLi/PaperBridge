import AppKit

@MainActor
private func nativeTextSelection(_ source: String, range: NSRange, paragraph: Int, side: ReaderTextSide,
                                 scope: TextSelectionScope) throws -> [String: Any] {
    _ = NSApplication.shared
    var observed: ReaderTextSelection?
    let parent = SelectableAcademicText(text: source, paragraphID: paragraph, side: side, annotations: [],
                                        scope: scope, onSelection: { observed = $0 })
    let coordinator = parent.makeCoordinator()
    let view = NSTextView(frame: NSRect(x: 0, y: 0, width: 600, height: 180))
    view.string = source
    view.setSelectedRange(range)
    coordinator.textViewDidChangeSelection(Notification(name: NSTextView.didChangeSelectionNotification, object: view))
    guard let observed else { throw CocoaError(.fileReadCorruptFile) }
    return ["scope": observed.scope.rawValue, "side": observed.side.rawValue, "text": observed.text,
            "offset": observed.rangeLocation, "length": observed.rangeLength]
}

@MainActor
func nativeSelectionEdges(fixtures: URL) throws -> [[String: Any]] {
    struct Sample: Decodable {
        let scope: TextSelectionScope
        let side: ReaderTextSide
        let context: String
        let quote: String
    }
    let samples = try JSONDecoder().decode([Sample].self, from: Data(contentsOf: fixtures.appendingPathComponent("selection-edges.json")))
    return try samples.map { sample in
        try nativeTextSelection(sample.context, range: (sample.context as NSString).range(of: sample.quote),
                                paragraph: sample.scope == .reader ? 1 : 0, side: sample.side, scope: sample.scope)
    }
}

@MainActor
func nativeJournalReaderSelections(_ paragraphs: [ParagraphResult]) throws -> [[String: Any]] {
    guard let paragraph = paragraphs.first(where: { $0.original.hasPrefix("Delimiter separated value (DSV)") }) else {
        throw CocoaError(.fileReadCorruptFile)
    }
    var result: [[String: Any]] = []
    for (side, source) in [(ReaderTextSide.original, paragraph.original), (.translation, paragraph.translation)] {
        let string = source as NSString
        var cursor = 0
        while cursor < string.length {
            let range = string.range(of: "DSV", options: [], range: NSRange(location: cursor, length: string.length - cursor))
            if range.location == NSNotFound { break }
            result.append(try nativeTextSelection(source, range: range, paragraph: paragraph.id, side: side, scope: .reader))
            cursor = NSMaxRange(range)
        }
    }
    guard result.count == 14 else { throw CocoaError(.fileReadCorruptFile) }
    return result
}
