import CryptoKit
import Foundation
import PDFKit

private struct SavedPDFJournal: Decodable {
    struct Block: Decodable {
        let id: Int
        let text: String
        let translation: String?
    }
    let sourceSHA256: String
    let blocks: [Block]
}

@MainActor
func nativePDFJournal(fixtures: URL) throws -> [String: Any] {
    let files = FileManager.default
    let input = fixtures.appendingPathComponent("good-enough")
    let saved = try JSONDecoder().decode(SavedPDFJournal.self, from: Data(contentsOf: input.appendingPathComponent("reader.json")))
    let pdf = input.appendingPathComponent("article.pdf")
    let bytes = try Data(contentsOf: pdf)
    let root = files.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? files.removeItem(at: root) }
    let model = PaperReaderViewModel(workspaceStore: WorkspaceStore(rootURL: root.appendingPathComponent("library")))
    model.settings.pdfExtractionMode = .pdfKitOnly
    model.settings.sourceLanguage = .english
    model.settings.targetLanguage = .simplifiedChinese
    model.loadPDF(from: pdf)
    let deadline = Date().addingTimeInterval(120)
    while model.isBusy && Date() < deadline { RunLoop.main.run(until: Date().addingTimeInterval(0.03)) }
    guard !model.isBusy, let paper = model.loadedPaper, paper.hasFacsimileMarkdown,
          let assets = paper.markdownResourceURL, let original = paper.originalPDFURL,
          try Data(contentsOf: original) == bytes, PDFDocument(data: bytes)?.pageCount == 20,
          SHA256.hash(data: bytes).map({ String(format: "%02x", $0) }).joined() == saved.sourceSHA256
    else { throw CocoaError(.fileReadCorruptFile) }

    // Save the native extraction separately. Supply the same saved Reader
    // paragraphs and translations to both exporters to isolate export behavior.
    let nativeSource = model.paragraphResults.map(\.original)
    let complete = saved.blocks.compactMap { block -> ParagraphResult? in
        guard let translation = block.translation else { return nil }
        return ParagraphResult(id: block.id, original: block.text, translation: translation, status: .ok)
    }
    guard complete.count == 208 else { throw CocoaError(.fileReadCorruptFile) }
    func export(_ results: [ParagraphResult], name: String) throws -> [String: String] {
        model.paragraphResults = results
        model.displayMode = .translationOnly
        let translated = model.previewMarkdown
        model.displayMode = .bilingual
        let bilingual = model.previewMarkdown
        let bundle = try MarkdownBundleExporter().export(paperName: name, documents: [
            "paper_translation_zh-Hans.md": translated, "paper_bilingual_en_zh-Hans.md": bilingual
        ], assetSourceDirectory: assets, to: root)
        guard bundle.missingAssetPaths.isEmpty, try Data(contentsOf: bundle.directoryURL.appendingPathComponent("original.pdf")) == bytes
        else { throw CocoaError(.fileReadCorruptFile) }
        let pngs = try files.contentsOfDirectory(at: bundle.directoryURL.appendingPathComponent("pages"), includingPropertiesForKeys: nil)
        guard pngs.filter({ $0.pathExtension == "png" }).count == 20 else { throw CocoaError(.fileReadCorruptFile) }
        func body(_ file: String, heading: String) throws -> String {
            let text = try String(contentsOf: bundle.directoryURL.appendingPathComponent(file), encoding: .utf8)
            guard let range = text.range(of: "\n# " + heading + "\n\n", options: .backwards) else { throw CocoaError(.fileReadCorruptFile) }
            let prefix = text[..<range.lowerBound]
            for page in 1...20 {
                let image = String(format: "pages/page-%04d.png", page)
                guard prefix.contains("![Original PDF page \(page)](\(image))") else { throw CocoaError(.fileReadCorruptFile) }
            }
            return String(text[range.upperBound...]).trimmingCharacters(in: .newlines)
        }
        return ["translated": try body("paper_translation_zh-Hans.md", heading: "Simplified Chinese translation of selectable text"),
                "bilingual": try body("paper_bilingual_en_zh-Hans.md", heading: "Extracted bilingual text")]
    }
    var partial = complete
    for index in partial.indices {
        if partial[index].id == 75 { partial[index].status = .pending }
        if partial[index].id == 189 { partial[index].status = .failed }
    }
    return ["sourceSHA256": saved.sourceSHA256, "nativeSource": nativeSource,
            "nativeSummaryBatches": SummaryEvidence.sourceBatches(paper.paragraphs),
            "savedSummaryBatches": SummaryEvidence.sourceBatches(complete.map(\.original)),
            "complete": try export(complete, name: "Complete"), "partial": try export(partial, name: "Partial")]
}
