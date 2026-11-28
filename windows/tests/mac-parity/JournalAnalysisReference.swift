import CryptoKit
import Foundation

@MainActor
func nativeJournalAnalysis(fixtures: URL) throws -> [String: Any] {
    let directory = fixtures.appendingPathComponent("tabbed")
    let article = try String(contentsOf: directory.appendingPathComponent("article.md"), encoding: .utf8)
    let translations = try JSONDecoder().decode([String: String].self,
        from: Data(contentsOf: directory.appendingPathComponent("translations.json")))
    let passages = article.components(separatedBy: "\n\n")
    guard let first = passages.first(where: { $0.hasPrefix("Delimiter separated value") }),
          let second = passages.first(where: { $0.hasPrefix("To the best of our knowledge") }),
          let wrap = first.range(of: ". For example,"),
          let quoteEnd = first.range(of: "a search of GitHub"),
          let translation = translations[SHA256.hash(data: Data(first.utf8)).map { String(format: "%02x", $0) }.joined()]
    else { throw CocoaError(.fileReadCorruptFile) }

    // A pasted reading can retain line breaks from the PDF text layer.
    let original = first.replacingCharacters(in: wrap, with: ".\nFor example,")
    let quote = String(first[..<quoteEnd.upperBound]).replacingOccurrences(of: ". For example,", with: ".\nFor example,")
    let otherQuote = String(second.prefix(70))
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    let model = PaperReaderViewModel(workspaceStore: WorkspaceStore(rootURL: root))
    let paragraphs = [original, second]
    model.applyLoadedPaper(PaperDocument(name: "Tabbed reading notes", checksum: "tabbed-analysis",
        cleanedText: paragraphs.joined(separator: "\n\n"), paragraphs: paragraphs,
        excludedReferenceParagraphs: [], referenceSectionTitle: nil))
    model.settings.sourceLanguage = .english
    model.settings.targetLanguage = .simplifiedChinese
    model.paragraphResults = [ParagraphResult(id: 1, original: original, translation: translation, status: .ok),
                              ParagraphResult(id: 2, original: second, status: .failed, errorMessage: "Model interrupted")]
    model.toggleBookmark(for: 1)
    let readerQuote = "tabular data"
    model.captureTextSelection(ReaderTextSelection(paragraphID: 1, side: .original, text: readerQuote, context: original,
        rangeLocation: (original as NSString).range(of: readerQuote).location, rangeLength: readerQuote.utf16.count))
    model.saveSelectionNote("Check the input format.")
    let sourceSummary = "The paper describes a reader for variably structured data."
    let targetSummary = "本文介绍了一种可读取不同结构数据的工具。"
    let summaryNote = PaperAnnotation(paragraphID: 0, side: .original, quote: "a reader", rangeLocation: 20,
        rangeLength: 8, scope: .summarySource, highlightColor: .amber, note: "Compare with the abstract.")
    model.annotations.append(summaryNote)
    func export() -> String {
        model.prepareMarkdownExport()
        return model.exportDocument.text
    }
    let without = export()
    let summary = SummaryResult(sourceLanguage: .english, targetLanguage: .simplifiedChinese,
        sourceSummary: sourceSummary, targetSummary: targetSummary)
    model.summaries = summary
    let legacy = export()
    let claims = [SummaryClaim(text: "The paper discusses variability in DSV input.", sources: [
                        SummarySource(paragraphID: 1, quote: quote), SummarySource(paragraphID: 2, quote: otherQuote)]),
                  SummaryClaim(text: "A reader interpretation to verify.", sources: [])]
    model.summaries?.claims = claims
    let populated = export()
    let draft = ConnectedTranslationResult(sourceLanguage: .english, targetLanguage: .simplifiedChinese,
        text: translation, batchCount: 1, failedBatchCount: 0)
    model.connectedTranslation = draft
    model.beginEditingParagraph(1)
    model.paragraphEditorText = original.replacingOccurrences(of: ".\nFor example,", with: ".\n\nFor example,")
    model.saveParagraphEdit()
    let edited = model.paragraphResults.map(\.original)
    let editedBookmarks = model.bookmarkedParagraphIDs.sorted()
    let summaryCurrentAfterEdit = model.summaries != nil
    let draftCurrentAfterEdit = model.connectedTranslation != nil
    model.undoParagraphEdit()
    let edit: [String: Any] = [
        "paragraphs": edited, "bookmarks": editedBookmarks, "summaryCurrentAfterEdit": summaryCurrentAfterEdit,
        "draftCurrentAfterEdit": draftCurrentAfterEdit, "restoredParagraphs": model.paragraphResults.map(\.original),
        "restoredSummary": model.summaries?.sourceSummary == sourceSummary && model.summaries?.claims == claims,
        "restoredDraft": model.connectedTranslation == draft, "restoredTranslation": model.paragraphResults.first?.translation ?? ""
    ]
    return ["withoutSummary": without, "legacy": legacy, "populated": populated, "edit": edit,
            "originals": paragraphs, "translation": translation, "sourceSummary": sourceSummary,
            "targetSummary": targetSummary, "claims": claims.map { claim -> [String: Any] in
                ["text": claim.text, "sources": claim.sources.map { ["paragraphID": $0.paragraphID, "quote": $0.quote] as [String: Any] }]
            }]
}
