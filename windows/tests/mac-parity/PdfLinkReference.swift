import AppKit
import CryptoKit
import PDFKit
import SwiftUI

@MainActor
func nativePdfLinks(fixtures: URL) throws -> [String: Any] {
    let file = fixtures.appendingPathComponent("linked-instrument-handbook.pdf")
    let bytes = try Data(contentsOf: file)
    let host = NSHostingView(rootView: PDFDocumentView(pdfURL: file))
    let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 525, height: 405),
                          styleMask: [.borderless], backing: .buffered, defer: false)
    window.contentView = host
    window.orderFront(nil)
    defer { window.orderOut(nil); window.contentView = nil }
    func reader(in view: NSView) -> PDFView? {
        if let view = view as? PDFView { return view }
        return view.subviews.compactMap { reader(in: $0) }.first
    }
    func wait(_ condition: () -> Bool) {
        let limit = Date().addingTimeInterval(4)
        while !condition() && Date() < limit { RunLoop.current.run(until: Date().addingTimeInterval(0.02)) }
    }
    wait { reader(in: host)?.document?.pageCount == 4 }
    guard let view = reader(in: host), let document = view.document else { throw CocoaError(.fileReadCorruptFile) }
    var links = [[String: Any]]()
    for i in 0..<document.pageCount {
        guard let page = document.page(at: i) else { continue }
        for annotation in page.annotations where annotation.type == "Link" {
            var item: [String: Any] = ["from": i + 1, "label": annotation.contents ?? ""]
            if let url = (annotation.action as? PDFActionURL)?.url ?? annotation.url {
                item["url"] = url.absoluteString
            } else if let destination = (annotation.action as? PDFActionGoTo)?.destination ?? annotation.destination,
                      let target = destination.page {
                let number = document.index(for: target)
                view.go(to: page)
                view.perform(PDFActionGoTo(destination: destination))
                wait { view.currentPage.map { document.index(for: $0) } == number }
                item["page"] = number + 1
                item["opened"] = view.currentPage.map { document.index(for: $0) } == number
            }
            links.append(item)
        }
    }
    return ["sha256": SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined(), "links": links]
}
