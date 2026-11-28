import AppKit
import CryptoKit
import PDFKit
import SwiftUI

@MainActor
func nativeRasterSwatches(pdf: URL) throws -> [[Int]] {
    guard let page = PDFDocument(url: pdf)?.page(at: 0),
          let tiff = page.thumbnail(of: NSSize(width: 192, height: 96), for: .mediaBox).tiffRepresentation,
          let bitmap = NSBitmapImageRep(data: tiff) else { throw CocoaError(.fileReadCorruptFile) }
    return try [36, 96, 156].map { x in
        guard let color = bitmap.colorAt(x: x * bitmap.pixelsWide / 192, y: bitmap.pixelsHigh / 2)?.usingColorSpace(.sRGB)
            else { throw CocoaError(.fileReadCorruptFile) }
        return [color.redComponent, color.greenComponent, color.blueComponent].map { Int(($0 * 255).rounded()) }
    }
}

// Draw into a named sRGB bitmap so its samples can be compared directly with a browser canvas.
@MainActor
func nativeSRGBScale(pdf: URL) throws -> [[Int]] {
    guard let page = PDFDocument(url: pdf)?.page(at: 0),
          let space = CGColorSpace(name: CGColorSpace.sRGB) else { throw CocoaError(.fileReadCorruptFile) }
    let width = 192, height = 96
    var bytes = [UInt8](repeating: 255, count: width * height * 4)
    return try bytes.withUnsafeMutableBytes { buffer in
        let bitmapInfo = CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue
        guard let context = CGContext(data: buffer.baseAddress, width: width, height: height, bitsPerComponent: 8,
                                     bytesPerRow: width * 4, space: space, bitmapInfo: bitmapInfo) else { throw CocoaError(.fileReadCorruptFile) }
        page.draw(with: .mediaBox, to: context)
        context.flush()
        return [36, 96, 156].map { x in
            let offset = (width * (height / 2) + x) * 4
            return (0..<3).map { Int(buffer[offset + $0]) }
        }
    }
}

@MainActor
func nativeLongFacsimile(pdf: URL) throws -> [String: Any] {
    let bytes = try Data(contentsOf: pdf)
    let checksum = SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: directory) }
    let service = PDFVisualArchiveService(workspaceRoot: directory)
    let archive = try service.archive(pdfData: bytes, checksum: checksum)
    let saved = try Data(contentsOf: archive.originalPDFURL)
    guard saved == bytes, let document = PDFDocument(data: saved), document.pageCount > 0,
          let text = document.page(at: document.pageCount - 1)?.string else {
        throw NSError(domain: "LongFacsimile", code: 1, userInfo: [NSLocalizedDescriptionKey: "Cannot read the archived last page"])
    }
    let headings = archive.markdown.components(separatedBy: "\n").filter { $0.hasPrefix("## Page ") }
    guard archive.pageCount == 125, archive.omittedPageCount == 5 else {
        throw NSError(domain: "LongFacsimile", code: 3, userInfo: [NSLocalizedDescriptionKey: "Unexpected archive page limit"])
    }
    for number in 121...125 {
        guard archive.markdown.contains("## Page \(number)\n\n> Page PNG omitted") else {
            throw NSError(domain: "LongFacsimile", code: 2, userInfo: [NSLocalizedDescriptionKey: "Missing numbered omitted page"])
        }
    }
    let readerText = try PDFTextExtractor().extractText(from: bytes)
    let observations = (1...125).filter { readerText.contains("Observation \($0) in the printed notebook.") }
    return ["readerObservations": observations.count, "sha256": checksum, "total": archive.pageCount, "rendered": archive.renderedPageCount,
            "omitted": archive.omittedPageCount, "headings": headings.count,
            "lastText": text.trimmingCharacters(in: CharacterSet.whitespacesAndNewlines)]
}

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
    // The notebook prints a red, green and blue square on successive pages.
    for index in 0..<3 {
        guard let page = document.page(at: index) else { throw failure("Missing scan page") }
        let bounds = page.bounds(for: .mediaBox)
        let thumbnail = page.thumbnail(of: NSSize(width: 180, height: 180), for: .mediaBox)
        guard (bounds.width > bounds.height) == (index == 1), let tiff = thumbnail.tiffRepresentation,
              let image = NSBitmapImageRep(data: tiff),
              let sample = image.colorAt(x: image.pixelsWide / 2, y: image.pixelsHigh / 2)?.usingColorSpace(.sRGB) else {
            throw failure("Could not read the scan orientation and printed swatch on page \(index + 1)")
        }
        let channels = [sample.redComponent, sample.greenComponent, sample.blueComponent]
        // DeviceRGB is unprofiled. Identify the printed swatch by its dominant
        // channel and contrast, which survive PDFKit's display-profile conversion.
        let others = channels.indices.filter { $0 != index }.map { channels[$0] }
        guard channels[index] > (others.max() ?? 0) + 0.16 else {
            throw failure("Wrong scan swatch on page \(index + 1): \(channels)")
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
    func needsOCR(_ mode: ReaderDisplayMode, section: String) -> Bool {
        reopened.displayMode = mode
        let markdown = reopened.previewMarkdown
        guard let range = markdown.range(of: section, options: .backwards) else { return false }
        let body = markdown[range.upperBound...]
        return body.contains("No selectable text was found.") &&
            (body.contains("OCR") || body.contains("scanned image-only PDF"))
    }
    return ["translationNeedsOCR": needsOCR(.translationOnly, section: "translation of selectable text"),
            "bilingualNeedsOCR": needsOCR(.bilingual, section: "# Extracted bilingual text"),
            "originalSHA256": SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined(),
            "paragraphs": paper.paragraphs.count, "canTranslate": reopened.canTranslate,
            "canSummarize": reopened.canSummarize, "canTranslateFull": reopened.canGenerateConnectedTranslation,
            "restoredPage": 2]
}
