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
        let location = item.stored == "explicitLast" ? text.range(of: item.quote, options: .backwards).location
            : item.stored == "missing" ? NSNotFound : 0
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
