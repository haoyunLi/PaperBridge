import Foundation
import PDFKit

let args = CommandLine.arguments
guard let doc = PDFDocument(url: URL(fileURLWithPath: args[1])), doc.pageCount == 12,
      let page = doc.page(at: 11), let text = page.string else { throw CocoaError(.fileReadCorruptFile) }
let lines = text.components(separatedBy: .newlines).map { $0.trimmingCharacters(in: .whitespaces) }

guard let left = lines.first(where: { $0.contains("VGG’s paper") }),
      let right = lines.first(where: { $0.hasPrefix("ports a center-crop") }),
      let caption = lines.firstIndex(where: { $0.hasPrefix("Table 14.") }), caption + 1 < lines.count,
      let lastRow = lines.first(where: { $0.hasPrefix("ours (ILSVRC") }) else {
    throw CocoaError(.fileReadCorruptFile)
}
let record = ["leftEnd": left, "rightBody": right, "caption": [lines[caption], lines[caption + 1]].joined(separator: " "),
              "finalTableRow": lastRow]
try JSONSerialization.data(withJSONObject: record, options: [.sortedKeys, .prettyPrinted])
    .write(to: URL(fileURLWithPath: args[2]))
