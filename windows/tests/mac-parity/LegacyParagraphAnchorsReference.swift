import Foundation

@MainActor
func nativeLegacyParagraphAnchors(paragraphs: [String], checksum: String) throws -> [String: Any] {
    guard let start = paragraphs.firstIndex(where: { $0.contains("the new backends interface") }),
          paragraphs.indices.contains(start + 1) else { throw CocoaError(.fileReadCorruptFile) }
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    let model = PaperReaderViewModel(workspaceStore: WorkspaceStore(rootURL: root))
    model.applyLoadedPaper(PaperDocument(name: "emcee", checksum: checksum, cleanedText: paragraphs.joined(separator: "\n\n"),
        paragraphs: paragraphs, excludedReferenceParagraphs: [], referenceSectionTitle: nil))
    let samples = [("new backends interface", 0), ("new moves interface", 1), ("results", 0), ("HDFBackend", 0), ("kernel density proposal", 1)]
    for (i, sample) in samples.enumerated() {
        var item = PaperAnnotation(paragraphID: start + sample.1 + 1, side: .original, quote: sample.0, rangeLocation: 0,
            rangeLength: sample.0.utf16.count, highlightColor: .amber, note: sample.0)
        item.needsReview = i == 3
        model.annotations.append(item)
    }
    func snapshot() -> [[String: Any]] {
        model.annotations.sorted { $0.quote < $1.quote }.map { item in
            let index = item.paragraphID - 1
            let offset = item.resolvedRange(in: model.paragraphResults[index].original)?.location ?? -1
            return ["quote": item.quote, "block": index - start, "offset": offset]
        }
    }
    let before = snapshot()
    model.mergeParagraphWithNext(start + 1)
    let merged = snapshot()
    model.reflowParagraph(start + 1)
    let reflowed = snapshot()
    model.undoParagraphEdit()
    return ["before": before, "merged": merged, "reflowed": reflowed, "undo": snapshot()]
}
