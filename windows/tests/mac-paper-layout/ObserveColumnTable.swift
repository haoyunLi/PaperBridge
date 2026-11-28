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
var record: [String: Any] = ["leftEnd": left, "rightBody": right, "caption": [lines[caption], lines[caption + 1]].joined(separator: " "),
              "finalTableRow": lastRow]
if args.count > 3 {
    struct Figure: Decodable { let page: Int; let width: Int; let height: Int; let points: [[Int]] }
    let figure = try JSONDecoder().decode(Figure.self, from: Data(contentsOf: URL(fileURLWithPath: args[3])))
    guard let page = PDFDocument(url: URL(fileURLWithPath: args[1]))?.page(at: figure.page - 1),
          let space = CGColorSpace(name: CGColorSpace.sRGB) else { throw CocoaError(.fileReadCorruptFile) }
    var pixels = [UInt8](repeating: 255, count: 4 * figure.width * figure.height)
    let values: [[Int]] = try pixels.withUnsafeMutableBytes { data in
        let info = CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue
        guard let context = CGContext(data: data.baseAddress, width: figure.width, height: figure.height,
                                     bitsPerComponent: 8, bytesPerRow: figure.width * 4, space: space, bitmapInfo: info)
            else { throw CocoaError(.fileReadCorruptFile) }
        let bounds = page.bounds(for: .mediaBox)
        context.scaleBy(x: CGFloat(figure.width) / bounds.width, y: CGFloat(figure.height) / bounds.height)
        page.draw(with: .mediaBox, to: context)
        context.flush()
        return figure.points.map { point in
            let offset = (point[1] * figure.width + point[0]) * 4
            return (0..<3).map { Int(data[offset + $0]) }
        }
    }
    record["figure3"] = values
}

try JSONSerialization.data(withJSONObject: record, options: [.sortedKeys, .prettyPrinted])
    .write(to: URL(fileURLWithPath: args[2]))
