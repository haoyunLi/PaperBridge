import Foundation
import PDFKit

@main
struct ObservePrintedPaper {
    @MainActor
    static func main() throws {
        let arguments = CommandLine.arguments
        let data = try Data(contentsOf: URL(fileURLWithPath: arguments[1]))
        guard let document = PDFDocument(data: data), document.pageCount == 15,
              let fourth = document.page(at: 3), let fifth = document.page(at: 4) else {
            throw CocoaError(.fileReadCorruptFile)
        }
        let fourthPage = fourth.string ?? "", fifthPage = fifth.string ?? ""
        let reading = try PDFTextExtractor().extractText(from: data)
        let paragraphs = reading.components(separatedBy: "\n\n")
        let tail = "yielding", next = "output values", note = "To illustrate why"
        func paragraph(_ text: String) -> Int? { paragraphs.firstIndex { $0.contains(text) }.map { $0 + 1 } }
        guard fourthPage.contains(tail), fourthPage.contains(note), fifthPage.contains(next),
              let before = paragraph(tail), let after = paragraph(next), let footnote = paragraph(note) else {
            throw NSError(domain: "PrintedPaper", code: 1, userInfo: [NSLocalizedDescriptionKey: "A reference point was absent from the native PDF extraction."])
        }
        let figurePages: [[String: Any]] = (12...14).compactMap { index in
            guard let page = document.page(at: index) else { return nil }
            let raw = page.string ?? ""
            let number = index - 9
            return [
                "page": index + 1, "figure": number,
                "containsPrintedCaption": raw.contains("Figure " + String(number)),
                "clippedTitlesInTextLayer": raw.components(separatedBy: "Input-Input Layer5").count - 1,
                "captionParagraph": paragraph("Figure " + String(number) + ":") ?? 0
            ]
        }
        var axisNotes: [[String: Any]] = []
        for number in [14, 15] {
            guard let page = document.page(at: number - 1), let source = page.string as NSString? else {
                throw CocoaError(.fileReadCorruptFile)
            }
            let box = page.bounds(for: .cropBox)
            var location = 0
            while location < source.length {
                let range = source.range(of: "application", options: [],
                                         range: NSRange(location: location, length: source.length - location))
                if range.location == NSNotFound { break }
                location = NSMaxRange(range)
                guard let selected = page.selection(for: range) else { throw CocoaError(.fileReadCorruptFile) }
                let anchors = PDFDocumentView.anchors(for: selected, in: document)
                let note = PaperAnnotation(paragraphID: 0, side: .original, quote: "application",
                    rangeLocation: range.location, rangeLength: range.length, scope: .paper,
                    locator: "pdf-page-\(number - 1)", pdfAnchors: anchors, note: "Figure label")
                guard let restored = PDFDocumentView.selection(for: note, in: document),
                      PDFDocumentView.anchors(for: restored, in: document) == anchors,
                      restored.string == "application" else { throw CocoaError(.fileReadCorruptFile) }
                let rect = restored.bounds(for: page)
                axisNotes.append(["page": number, "quote": "application",
                    "x": (rect.midX - box.minX) / box.width, "y": (box.maxY - rect.midY) / box.height])
            }
        }
        guard axisNotes.count == 8 else { throw CocoaError(.fileReadCorruptFile) }
        let record: [String: Any] = [
            "pageCount": document.pageCount, "startPage": 4, "continuationPage": 5, "footnotePage": 4,
            "startParagraph": before, "continuationParagraph": after, "noteParagraph": footnote,
            "bodyJoined": before == after, "noteSeparate": footnote != after && footnote != before,
            "sumSymbolInFootnote": paragraphs[footnote - 1].contains("∑"),
            "figurePages": figurePages, "axisNotes": axisNotes, "separateAppendixHeading": paragraphs.contains("Attention Visualizations"),
            "article": "1706.03762v7"
        ]
        try JSONSerialization.data(withJSONObject: record, options: [.prettyPrinted, .sortedKeys]).write(to: URL(fileURLWithPath: arguments[2]))
    }
}
