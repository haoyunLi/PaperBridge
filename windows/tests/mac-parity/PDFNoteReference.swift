import Foundation
import PDFKit

@MainActor
func nativePDFNoteRecovery(pdf: Data, fixtures: URL) throws -> [String: Bool] {
    struct NoteCase: Decodable {
        let name: String
        let page: Int
        let quote: String
        let stored: String
    }
    let cases = try JSONDecoder().decode([NoteCase].self, from: Data(contentsOf: fixtures.appendingPathComponent("pdf-note-cases.json")))
    guard let document = PDFDocument(data: pdf) else { throw CocoaError(.fileReadCorruptFile) }
    var matched: [String: Bool] = [:]
    for item in cases {
        let index = item.page - 1
        guard let text = document.page(at: index)?.string as NSString? else { throw CocoaError(.fileReadCorruptFile) }
        let length = item.quote.utf16.count
        let location: Int
        switch item.stored {
        case "explicitLast": location = text.range(of: item.quote, options: .backwards).location
        case "missing": location = NSNotFound
        case "explicitWrong": location = 1
        default: location = 0
        }
        let ranges = item.stored.hasPrefix("explicit")
            ? [PDFTextAnchor(pageIndex: index, location: location, length: length, quote: item.quote)] : nil
        let note = PaperAnnotation(paragraphID: 0, side: .original, quote: item.quote, rangeLocation: location,
            rangeLength: length, scope: .paper, locator: "pdf-page-\(index)", pdfAnchors: ranges, note: item.name)
        let selection = PDFDocumentView.selection(for: note, in: document)
        let parts = selection.map { PDFDocumentView.anchors(for: $0, in: document) } ?? []
        matched[item.name] = parts.count == 1 && parts[0].quote == item.quote && parts[0].pageIndex == index
    }
    return matched
}

// PDFKit and PDF.js order some page furniture differently. Compare the selected pages
// and boundary words, and verify the exact ranges against each engine's own page text.
@MainActor
func nativeLongPDFSelections(fixtures: URL) throws -> [String: [Int]] {
    struct Passage: Decodable {
        let name, start, end: String
        let first, last: Int
    }
    let cases = try JSONDecoder().decode([Passage].self, from: Data(contentsOf: fixtures.appendingPathComponent("long-pdf-selections.json")))
    guard let document = PDFDocument(url: fixtures.appendingPathComponent("good-enough/article.pdf")) else { throw CocoaError(.fileReadCorruptFile) }
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    let model = PaperReaderViewModel(workspaceStore: WorkspaceStore(rootURL: root))
    model.applyLoadedPaper(PaperDocument(name: "Good enough practices", checksum: "long-pdf-selection",
        cleanedText: "Good enough practices", paragraphs: ["Good enough practices"], excludedReferenceParagraphs: [], referenceSectionTitle: nil))
    var results: [String: [Int]] = [:]
    for item in cases {
        func failure(_ message: String) -> NSError {
            NSError(domain: "PaperBridge.LongPDFSelections", code: 1, userInfo: [NSLocalizedDescriptionKey: "\(item.name): \(message)"])
        }
        let selection = PDFSelection(document: document)
        for number in item.first...item.last {
            guard let page = document.page(at: number - 1), let text = page.string as NSString? else { throw failure("Cannot read page \(number)") }
            let start = number == item.first ? text.range(of: item.start).location : 0
            let match = text.range(of: item.end)
            guard start != NSNotFound, number != item.last || match.location != NSNotFound else { throw failure("Boundary missing on page \(number), start \(start), end \(match.location)") }
            let end = number == item.last ? NSMaxRange(match) : text.length
            guard end > start, let part = page.selection(for: NSRange(location: start, length: end - start)) else { throw failure("Cannot select \(start)..<\(end) on page \(number)") }
            selection.add(part)
        }
        let anchors = PDFDocumentView.anchors(for: selection, in: document)
        guard let first = anchors.first, let text = selection.string, text.count > 3000,
              first.quote.hasPrefix(item.start), anchors.last?.quote.hasSuffix(item.end) == true else {
            throw failure("Selected \(selection.string?.count ?? 0) characters in \(anchors.count) ranges, starting with \(anchors.first?.quote.prefix(65) ?? "") and ending with \(anchors.last?.quote.suffix(65) ?? "")")
        }
        model.captureTextSelection(ReaderTextSelection(scope: .paper, paragraphID: 0, side: .original, text: text,
            context: text, rangeLocation: first.location, rangeLength: first.length,
            locator: "pdf-page-\(first.pageIndex)", pdfAnchors: anchors))
        model.applyHighlight(.amber)
        model.saveSelectionNote(item.name)
        guard let note = model.activeSelectionAnnotation, note.note == item.name, note.highlightColor == .amber,
              let reopened = PDFDocumentView.selection(for: note, in: document),
              PDFDocumentView.anchors(for: reopened, in: document) == anchors else { throw failure("Saving or revisiting the exact highlighted note changed its ranges") }
        results[item.name] = anchors.map { $0.pageIndex + 1 }
    }
    return results
}
