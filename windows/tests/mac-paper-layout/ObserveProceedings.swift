import Foundation
import PDFKit

@main
struct ObserveProceedings {
    static func main() throws {
        let args = CommandLine.arguments
        let bytes = try Data(contentsOf: URL(fileURLWithPath: args[1]))
        guard let document = PDFDocument(data: bytes), document.pageCount == 16,
              let first = document.page(at: 0), let second = document.page(at: 1), let third = document.page(at: 2),
              let fourth = document.page(at: 3), let fifth = document.page(at: 4) else {
            throw CocoaError(.fileReadCorruptFile)
        }
        func printed(_ page: PDFPage, _ rect: CGRect) throws -> String {
            guard let text = page.selection(for: rect)?.string, !text.isEmpty else { throw CocoaError(.fileReadCorruptFile) }
            return text.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
        }
        guard let beforeTables = document.page(at: 5)?.string?.components(separatedBy: .newlines)
            .first(where: { $0.contains("Without TriviaQA fine-") }),
              let afterTables = document.page(at: 6)?.string?.components(separatedBy: .newlines)
            .first(where: { $0.contains("tuning data, we only lose") }) else { throw CocoaError(.fileReadCorruptFile) }
        let output: [String: Any] = [
            "beforeTables": beforeTables,
            "afterTables": afterTables,
            "pages": document.pageCount,
            "title": try printed(first, CGRect(x: 105, y: 740, width: 388, height: 38)),
            "byline": try printed(first, CGRect(x: 115, y: 701, width: 372, height: 13)),
            "lastBodyLine": try printed(first, CGRect(x: 305, y: 77, width: 225, height: 12)),
            "firstBodyLine": try printed(second, CGRect(x: 69, y: 765, width: 225, height: 13)),
            "notice": try printed(first, CGRect(x: 110, y: 25, width: 370, height: 26)),
            "beforeFigurePage": try printed(second, CGRect(x: 305, y: 77, width: 225, height: 12)),
            "afterFigure": try printed(third, CGRect(x: 69, y: 491, width: 224, height: 12)),
            "leftColumnEnd": try printed(third, CGRect(x: 69, y: 77, width: 224, height: 12)),
            "rightColumnStart": try printed(third, CGRect(x: 305, y: 491, width: 224, height: 12)),
            "ordinal": try printed(fourth, CGRect(x: 224, y: 441, width: 13, height: 13)),
            "indexedVector": try printed(fourth, CGRect(x: 83, y: 426, width: 11, height: 12)),
            "hiddenDimension": try printed(fifth, CGRect(x: 388, y: 207, width: 18, height: 13)),
            "weightsDimension": try printed(fifth, CGRect(x: 306, y: 154, width: 32, height: 13)),
            "captionEnd": try printed(third, CGRect(x: 69, y: 526, width: 451, height: 11)),
            "extractor": try PDFTextExtractor().extractText(from: bytes).components(separatedBy: "\n\n").enumerated().compactMap { i, text -> [String: Any]? in
                let markers = ["BERT: Pre-training", "predict the original vocabulary", "word based only on its context", "Proceedings of NAACL-HLT", "auto-encoder objectives", "Overall pre-training and fine-tuning"].filter(text.contains)
                return markers.isEmpty ? nil : ["paragraph": i + 1, "markers": markers]
            }
        ]
        try JSONSerialization.data(withJSONObject: output, options: [.prettyPrinted, .sortedKeys])
            .write(to: URL(fileURLWithPath: args[2]))
    }
}
