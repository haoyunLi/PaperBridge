import Foundation

@MainActor
func nativeRetainedSlice(paragraphs: [String], checksum: String) throws -> [String: Any] {
    let quote = "results"
    guard let index = paragraphs.firstIndex(where: { $0.contains("the new backends interface") }),
          let cut = paragraphs[index].range(of: "For example,")?.lowerBound else { throw CocoaError(.fileReadCorruptFile) }
    let original = paragraphs[index], cropped = String(original[cut...])
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    let store = WorkspaceStore(rootURL: root)
    let model = PaperReaderViewModel(workspaceStore: store)
    model.applyLoadedPaper(PaperDocument(name: "emcee v3", checksum: checksum, cleanedText: paragraphs.joined(separator: "\n\n"),
        paragraphs: paragraphs, excludedReferenceParagraphs: [], referenceSectionTitle: nil))
    let source = original as NSString
    let locations = [source.range(of: quote).location, source.range(of: quote, options: .backwards).location]
    guard locations[0] < locations[1] else { throw CocoaError(.fileReadCorruptFile) }
    for (i, location) in locations.enumerated() {
        model.captureTextSelection(ReaderTextSelection(paragraphID: index + 1, side: .original, text: quote, context: original,
            rangeLocation: location, rangeLength: quote.utf16.count))
        model.applyHighlight(i == 0 ? .amber : .coral)
        model.saveSelectionNote(i == 0 ? "Serialized results" : "In-memory results")
    }
    func positions(_ annotations: [PaperAnnotation], _ text: String) -> [Int] {
        annotations.sorted { $0.rangeLocation < $1.rangeLocation }.map { $0.resolvedRange(in: text)?.location ?? -1 }
    }
    model.beginEditingParagraph(index + 1)
    model.paragraphEditorText = cropped
    model.saveParagraphEdit()
    let after = positions(model.annotations, cropped)
    model.persistWorkspace()
    store.flush()
    let reopened = PaperReaderViewModel(workspaceStore: store)
    guard reopened.annotations.count == 2 && positions(reopened.annotations, cropped) == after else { throw CocoaError(.fileReadCorruptFile) }
    model.undoParagraphEdit()
    return ["paragraphID": index + 1, "source": original, "cropped": cropped, "quote": quote,
            "originalOffsets": locations, "croppedOffsets": after, "undoOffsets": positions(model.annotations, original)]
}
