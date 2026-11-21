import AppKit
import CryptoKit
import PDFKit
import SwiftUI

// Read a raster-only portrait/landscape notebook through PaperBridge's PDFKit
// importer, PDFDocumentView and library. Each printed page has a distinct swatch.
@MainActor
func nativeScannedNotebook(pdf: URL) throws -> [String: Any] {
    func failure(_ message: String) -> NSError {
        NSError(domain: "ScannedNotebook", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }
    func wait(_ label: String, until condition: () -> Bool) throws {
        let deadline = Date().addingTimeInterval(20)
        while !condition() && Date() < deadline { RunLoop.main.run(until: Date().addingTimeInterval(0.03)) }
        guard condition() else { throw failure(label) }
    }
    func pdfView(in view: NSView) -> PDFView? {
        if let pdf = view as? PDFView { return pdf }
        for child in view.subviews {
            if let found = pdfView(in: child) { return found }
        }
        return nil
    }
    func show(_ model: PaperReaderViewModel) throws -> (NSWindow, PDFView) {
        guard let paper = model.loadedPaper, let url = paper.originalPDFURL else { throw failure("Missing archived PDF") }
        let content = PDFDocumentView(pdfURL: url, readingPosition: model.readingPositions["paper.pdf"],
                                      onPositionChange: { position in
            model.updateReadingPosition(position, key: "paper.pdf", paperChecksum: paper.checksum)
        })
        let host = NSHostingView(rootView: content)
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 480, height: 360), styleMask: [.borderless],
                              backing: .buffered, defer: false)
        window.contentView = host
        window.orderFront(nil)
        try wait("The native PDF view did not load the three pages") { pdfView(in: host)?.document?.pageCount == 3 }
        guard let reader = pdfView(in: host) else { throw failure("Missing PDFView") }
        return (window, reader)
    }

    _ = NSApplication.shared
    let files = FileManager.default
    let dir = files.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? files.removeItem(at: dir) }
    let store = WorkspaceStore(rootURL: dir)
    let model = PaperReaderViewModel(workspaceStore: store)
    model.settings.pdfExtractionMode = .pdfKitOnly
    model.loadPDF(from: pdf)
    try wait("The scan import did not finish") { !model.isBusy && model.loadedPaper != nil }
    guard let paper = model.loadedPaper, let archived = paper.originalPDFURL else { throw failure("Scan unavailable after import") }

    let (window, reader) = try show(model)
    guard let document = reader.document else { throw failure("Missing PDF document") }
    let colors = [[182, 69, 53], [43, 136, 87], [67, 93, 176]]
    for (index, color) in colors.enumerated() {
        guard let page = document.page(at: index) else { throw failure("Missing scan page") }
        let bounds = page.bounds(for: .mediaBox)
        let thumbnail = page.thumbnail(of: NSSize(width: 180, height: 180), for: .mediaBox)
        guard (bounds.width > bounds.height) == (index == 1), let tiff = thumbnail.tiffRepresentation,
              let image = NSBitmapImageRep(data: tiff),
              let sample = image.colorAt(x: image.pixelsWide / 2, y: image.pixelsHigh / 2)?.usingColorSpace(.sRGB) else {
            throw failure("Could not read the scan orientation and printed swatch on page \(index + 1)")
        }
        let channels = [sample.redComponent, sample.greenComponent, sample.blueComponent]
        guard zip(channels, color).allSatisfy({ abs($0.0 * 255 - CGFloat($0.1)) < 18 }) else {
            throw failure("Wrong scan swatch on page \(index + 1)")
        }
    }
    guard let second = document.page(at: 1) else { throw failure("Missing second page") }
    reader.go(to: second)
    try wait("PaperBridge did not receive the PDFKit page change") { model.readingPositions["paper.pdf"]?.pageIndex == 1 }
    model.persistWorkspace()
    store.flush()
    window.orderOut(nil)
    window.contentView = nil

    let reopened = PaperReaderViewModel(workspaceStore: WorkspaceStore(rootURL: dir))
    guard let entry = reopened.libraryEntries.first(where: { $0.id == paper.checksum }) else { throw failure("Scan absent from library") }
    reopened.openLibraryPaper(entry)
    let (restoredWindow, restoredReader) = try show(reopened)
    defer { restoredWindow.orderOut(nil) }
    try wait("Reopening the library scan did not restore page two") {
        guard let page = restoredReader.currentPage, let document = restoredReader.document else { return false }
        return document.index(for: page) == 1
    }
    let data = try Data(contentsOf: archived)
    guard data == (try Data(contentsOf: pdf)) else { throw failure("Archived scan bytes changed") }
    return ["originalSHA256": SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined(),
            "paragraphs": paper.paragraphs.count, "canTranslate": reopened.canTranslate,
            "canSummarize": reopened.canSummarize, "canTranslateFull": reopened.canGenerateConnectedTranslation,
            "restoredPage": 2]
}
