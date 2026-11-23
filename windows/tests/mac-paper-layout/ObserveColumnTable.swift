import Foundation
import PDFKit

let args = CommandLine.arguments
guard let doc = PDFDocument(url: URL(fileURLWithPath: args[1])), doc.pageCount == 12,
      let page = doc.page(at: 11) else { throw CocoaError(.fileReadCorruptFile) }

func printed(_ rect: CGRect) throws -> String {
    guard let text = page.selection(for: rect)?.string, !text.isEmpty else { throw CocoaError(.fileReadCorruptFile) }
    return text.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
}

let record = [
    "leftEnd": try printed(CGRect(x: 49, y: 79, width: 238, height: 11)),
    "rightBody": try printed(CGRect(x: 308, y: 598, width: 237, height: 11)),
    "caption": try printed(CGRect(x: 308, y: 625, width: 240, height: 22)),
    "finalTableRow": try printed(CGRect(x: 313, y: 656, width: 232, height: 10))
]
try JSONSerialization.data(withJSONObject: record, options: [.sortedKeys, .prettyPrinted])
    .write(to: URL(fileURLWithPath: args[2]))
