import AppKit

@MainActor
func nativeSelectionEdges(fixtures: URL) throws -> [[String: Any]] {
    struct Sample: Decodable {
        let scope: TextSelectionScope
        let side: ReaderTextSide
        let context: String
        let quote: String
    }
    let samples = try JSONDecoder().decode([Sample].self, from: Data(contentsOf: fixtures.appendingPathComponent("selection-edges.json")))
    _ = NSApplication.shared
    return try samples.map { sample in
        var observed: ReaderTextSelection?
        let parent = SelectableAcademicText(text: sample.context, paragraphID: sample.scope == .reader ? 1 : 0,
                                            side: sample.side, annotations: [], scope: sample.scope,
                                            onSelection: { observed = $0 })
        let coordinator = parent.makeCoordinator()
        let text = NSTextView(frame: NSRect(x: 0, y: 0, width: 600, height: 180))
        text.string = sample.context
        text.setSelectedRange((sample.context as NSString).range(of: sample.quote))
        coordinator.textViewDidChangeSelection(Notification(name: NSTextView.didChangeSelectionNotification, object: text))
        guard let observed else { throw CocoaError(.fileReadCorruptFile) }
        return ["scope": observed.scope.rawValue, "side": observed.side.rawValue, "text": observed.text,
                "offset": observed.rangeLocation, "length": observed.rangeLength]
    }
}
