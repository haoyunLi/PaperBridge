import Foundation

@MainActor
func nativeAnnotationUndo(paragraphs: [String], checksum: String) throws -> [String: Any] {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    let store = WorkspaceStore(rootURL: root)
    let model = PaperReaderViewModel(workspaceStore: store)
    let document = PaperDocument(name: "emcee v3", checksum: checksum, cleanedText: paragraphs.joined(separator: "\n\n"),
                                 paragraphs: paragraphs, excludedReferenceParagraphs: [], referenceSectionTitle: nil)
    model.applyLoadedPaper(document)
    guard let edited = model.paragraphResults.dropFirst(2).first(where: { $0.original.count > 150 && $0.original.contains(". ") }),
          let boundary = edited.original.range(of: ". ") else {
        throw CocoaError(.fileReadCorruptFile)
    }
    let title = paragraphs[0]
    let quote = String(title.prefix(12))
    model.captureTextSelection(ReaderTextSelection(paragraphID: 1, side: .original, text: quote, context: title,
                                                   rangeLocation: 0, rangeLength: (quote as NSString).length))
    model.saveSelectionNote("Check this passage")
    guard let saved = model.annotations.first else { throw CocoaError(.fileReadCorruptFile) }
    let colors = PaperHighlightColor.allCases.map { color -> String in
        model.applyHighlight(color)
        guard let active = model.activeSelectionAnnotation, active.id == saved.id,
              active.note == saved.note else { return "" }
        return active.highlightColor?.displayName ?? ""
    }
    model.removeSelectionHighlight()
    let noteAfterClearing = model.activeSelectionAnnotation?.id == saved.id && model.activeSelectionAnnotation?.highlightColor == nil
    model.undoAnnotationChange()
    let restoredColor = model.activeSelectionAnnotation?.highlightColor?.displayName ?? ""
    model.persistWorkspace()
    store.flush()
    let reopenedMark = PaperReaderViewModel(workspaceStore: store).annotations.first { $0.id == saved.id }
    guard noteAfterClearing, reopenedMark?.note == saved.note, reopenedMark?.highlightColor?.displayName == restoredColor else {
        throw CocoaError(.fileReadCorruptFile)
    }
    model.removeAnnotation(id: saved.id)
    model.toggleBookmark(for: 2)
    model.undoAnnotationChange()
    let noteRestored = model.annotations.contains { $0.id == saved.id && $0.note == "Check this passage" }
    let bookmarkKept = model.bookmarkedParagraphIDs.contains(2)

    model.beginEditingParagraph(edited.id)
    model.paragraphEditorText = String(edited.original[..<boundary.lowerBound]) + ".\n\n" + String(edited.original[boundary.upperBound...])
    model.saveParagraphEdit()
    let splitCount = model.paragraphResults.count
    let annotationUndoAfterSplit = model.canUndoAnnotationChange
    model.removeAnnotation(id: saved.id)
    model.undoParagraphEdit()
    model.persistWorkspace()
    store.flush()
    let reopened = PaperReaderViewModel(workspaceStore: store)
    return [
        "highlightColors": colors, "restoredColor": restoredColor,
        "noteRestored": noteRestored, "bookmarkKept": bookmarkKept,
        "shiftedQuote": saved.resolvedRange(in: "🔎 " + title)?.location ?? -1,
        "ambiguousQuote": saved.resolvedRange(in: "🔎 " + quote + " " + quote)?.location ?? -1,
        "missingQuote": saved.resolvedRange(in: "")?.location ?? -1,
        "splitCount": splitCount, "annotationUndoAfterSplit": annotationUndoAfterSplit,
        "restoredSources": reopened.paragraphResults.map(\.original) == paragraphs,
        "laterDeletionKept": reopened.annotations.isEmpty, "reopenedBookmark": reopened.bookmarkedParagraphIDs.contains(2)
    ]
}
