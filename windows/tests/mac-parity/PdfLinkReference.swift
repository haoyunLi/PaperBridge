import AppKit
import CryptoKit
import PDFKit
import SwiftUI

@MainActor
private func waitForPdf(_ condition: () -> Bool) {
    let limit = Date().addingTimeInterval(4)
    while !condition() && Date() < limit { RunLoop.current.run(until: Date().addingTimeInterval(0.02)) }
}

@MainActor
private func showNativePdf(_ file: URL, pages: Int) throws -> (NSWindow, PDFView, PDFDocument) {
    let host = NSHostingView(rootView: PDFDocumentView(pdfURL: file))
    let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 525, height: 405),
                          styleMask: [.borderless], backing: .buffered, defer: false)
    window.contentView = host
    window.orderFront(nil)
    func reader(in view: NSView) -> PDFView? {
        if let view = view as? PDFView { return view }
        return view.subviews.compactMap { reader(in: $0) }.first
    }
    waitForPdf { reader(in: host)?.document?.pageCount == pages }
    guard let view = reader(in: host), let document = view.document else { throw CocoaError(.fileReadCorruptFile) }
    return (window, view, document)
}

@MainActor
func nativePdfLinks(fixtures: URL, namedActions: Bool = false) throws -> [String: Any] {
    let file = fixtures.appendingPathComponent(namedActions ? "maintenance-navigation.pdf" : "linked-instrument-handbook.pdf")
    let bytes = try Data(contentsOf: file)
    let (window, view, document) = try showNativePdf(file, pages: 4)
    defer { window.orderOut(nil); window.contentView = nil }
    if namedActions {
        guard let first = document.page(at: 0) else { throw CocoaError(.fileReadCorruptFile) }
        view.go(to: first)
        let points = [CGPoint(x: 132, y: 320), CGPoint(x: 132, y: 275), CGPoint(x: 132, y: 230)]
        let hit = points.map { view.areaOfInterest(for: view.convert($0, from: first)).contains(.linkArea) }
        var steps = [[String: Any]]()
        for (label, expected) in [("Next record", 2), ("Last record", 4), ("Previous record", 3), ("Previous view", 4), ("Next view", 3), ("First record", 1)] {
            guard let current = view.currentPage,
                  let annotation = current.annotations.first(where: { $0.contents == label }) else { throw CocoaError(.fileReadCorruptFile) }
            let from = document.index(for: current) + 1
            if let action = annotation.action {
                view.perform(action)
                waitForPdf { view.currentPage.map { document.index(for: $0) + 1 } == expected }
            }
            steps.append(["label": label, "from": from, "page": view.currentPage.map { document.index(for: $0) + 1 } ?? 0,
                          "recognized": annotation.action is PDFActionNamed])
        }
        return ["sha256": SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined(), "steps": steps, "linkedAreas": hit]
    }
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
                waitForPdf { view.currentPage.map { document.index(for: $0) } == number }
                item["page"] = number + 1
                item["opened"] = view.currentPage.map { document.index(for: $0) } == number
            }
            links.append(item)
        }
    }
    return ["sha256": SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined(), "links": links]
}

@MainActor
func nativePdfSelectAll(fixtures: URL) throws -> [[String: Any]] {
    try [("rotated-spectrometer.pdf", 4), ("good-enough/article.pdf", 20)].map { filename, pageCount in
        let file = fixtures.appendingPathComponent(filename)
        let (window, view, document) = try showNativePdf(file, pages: pageCount)
        defer { window.orderOut(nil); window.contentView = nil }
        view.selectAll(nil)
        guard let selection = view.currentSelection, let text = selection.string else { throw CocoaError(.fileReadCorruptFile) }
        var result: [String: Any] = ["file": filename, "sha256": SHA256.hash(data: try Data(contentsOf: file)).map { String(format: "%02x", $0) }.joined(),
            "pages": selection.pages.map { document.index(for: $0) + 1 }, "text": text,
            "anchors": PDFDocumentView.anchors(for: selection, in: document).count]
        if ProcessInfo.processInfo.environment["GITHUB_ACTIONS"] == "true" {
            view.copy(nil)
            result["copied"] = NSPasteboard.general.string(forType: .string)
        }
        return result
    }
}

@MainActor
func nativePdfComments(fixtures: URL) throws -> [String: Any] {
    let file = fixtures.appendingPathComponent("reviewed-calibration.pdf")
    let bytes = try Data(contentsOf: file)
    let (window, view, document) = try showNativePdf(file, pages: 2)
    defer { window.orderOut(nil); window.contentView = nil }
    guard let first = document.page(at: 0) else { throw CocoaError(.fileReadCorruptFile) }
    view.go(to: first)
    var result = [[String: Any]]()
    for annotation in first.annotations where ["Text", "Highlight", "Underline"].contains(annotation.type ?? "") {
        let point = CGPoint(x: annotation.bounds.midX, y: annotation.bounds.midY)
        let area = view.areaOfInterest(for: view.convert(point, from: first))
        let hit = first.annotation(at: point)
        result.append(["type": annotation.type ?? "", "author": annotation.userName ?? "", "text": annotation.contents ?? "",
                       "hit": hit === annotation, "area": area.rawValue, "page": 1])
    }
    return ["sha256": SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined(), "comments": result]
}
