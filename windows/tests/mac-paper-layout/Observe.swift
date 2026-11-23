import Foundation
import PDFKit

@main
struct ObservePrintedPaper {
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
        let record: [String: Any] = [
            "pageCount": document.pageCount, "startPage": 4, "continuationPage": 5, "footnotePage": 4,
            "startParagraph": before, "continuationParagraph": after, "noteParagraph": footnote,
            "bodyJoined": before == after, "noteSeparate": footnote != after && footnote != before,
            "sumSymbolInFootnote": paragraphs[footnote - 1].contains("∑"),
            "figurePages": figurePages, "separateAppendixHeading": paragraphs.contains("Attention Visualizations"),
            "article": "1706.03762v7"
        ]
        try JSONSerialization.data(withJSONObject: record, options: [.prettyPrinted, .sortedKeys]).write(to: URL(fileURLWithPath: arguments[2]))
    }
}
