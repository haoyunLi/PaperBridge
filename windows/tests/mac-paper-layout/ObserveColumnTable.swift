import Foundation
import PDFKit

let args = CommandLine.arguments
guard let doc = PDFDocument(url: URL(fileURLWithPath: args[1])), doc.pageCount == 12,
      let page = doc.page(at: 11) else { throw CocoaError(.fileReadCorruptFile) }

// Use PDFKit's per-character geometry. A rectangular PDFSelection can return
// nil on this two-column page, even when the individual characters are mapped.
let characters = (0..<page.numberOfCharacters).compactMap { index -> (CGRect, String)? in
    let rect = page.characterBounds(at: index)
    let text = page.selection(for: NSRange(location: index, length: 1))?.string ?? ""
    return rect.isEmpty || text.isEmpty ? nil : (rect, text)
}
func printed(_ region: CGRect) -> String {
    let selected = characters.filter { region.contains(CGPoint(x: $0.0.midX, y: $0.0.midY)) }
    return selected.map { $0.1 }.joined().split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
}

let record: [String: Any] = [
    "pages": doc.pageCount,
    "leftEnd": printed(CGRect(x: 48, y: 78, width: 241, height: 14)),
    "rightBody": printed(CGRect(x: 306, y: 597, width: 242, height: 13)),
    "caption": printed(CGRect(x: 306, y: 624, width: 242, height: 23)),
    "finalTableRow": printed(CGRect(x: 313, y: 654, width: 232, height: 13)),
    "characterCount": characters.count,
    "pageText": page.string ?? "",
    "geometry": characters.prefix(20).map { ["text": $0.1, "x": $0.0.midX, "y": $0.0.midY] as [String: Any] }
]
try JSONSerialization.data(withJSONObject: record, options: [.sortedKeys, .prettyPrinted])
    .write(to: URL(fileURLWithPath: args[2]))
