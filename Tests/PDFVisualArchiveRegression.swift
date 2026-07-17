import CoreGraphics
import Foundation

@main
struct PDFVisualArchiveRegression {
    static func main() throws {
        let fileManager = FileManager.default
        let testRoot = fileManager.temporaryDirectory.appendingPathComponent(
            "paperbridge-facsimile-regression-" + UUID().uuidString,
            isDirectory: true
        )
        defer { try? fileManager.removeItem(at: testRoot) }

        let pdfData = try makeVectorPDF()
        let service = PDFVisualArchiveService(
            fileManager: fileManager,
            workspaceRoot: testRoot,
            maxPageDimension: 900
        )
        let first = try service.archive(pdfData: pdfData, checksum: "visual-cache")

        require(!first.usedCachedOutput, "First facsimile archive unexpectedly used a cache")
        require(first.pageCount == 1, "Facsimile archive returned the wrong page count")
        require(first.renderedPageCount == 1, "PDF page was not rendered to PNG")
        require(first.omittedPageCount == 0, "A short PDF page was unexpectedly omitted")
        require(first.markdown.contains("[Open the exact original PDF](original.pdf)"), "Original PDF link is missing")
        require(first.markdown.contains("pages/page-0001.png"), "Rendered page link is missing")
        try require(
            try Data(contentsOf: first.originalPDFURL) == pdfData,
            "The archived original PDF bytes changed"
        )
        require(
            fileManager.fileExists(
                atPath: first.resourceDirectoryURL
                    .appendingPathComponent("pages/page-0001.png")
                    .path
            ),
            "Rendered page image was not written"
        )

        let cached = try service.archive(pdfData: pdfData, checksum: "visual-cache")
        require(cached.usedCachedOutput, "Completed facsimile archive was not reused")
        require(cached.markdown == first.markdown, "Cached facsimile manifest changed")

        let limitedService = PDFVisualArchiveService(
            fileManager: fileManager,
            workspaceRoot: testRoot,
            maxPageDimension: 900,
            maximumRenderedPages: 0
        )
        let limited = try limitedService.archive(
            pdfData: pdfData,
            checksum: "visual-page-limit"
        )
        require(limited.renderedPageCount == 0, "Page rendering ignored the safety limit")
        require(limited.omittedPageCount == 1, "The omitted page was not reported")
        require(
            limited.markdown.contains("omitted for long-document safety"),
            "The facsimile manifest did not explain the omitted page"
        )
        try require(
            try Data(contentsOf: limited.originalPDFURL) == pdfData,
            "The complete original PDF was not retained when previews were limited"
        )

        print("PDF facsimile regression tests passed.")
    }

    private static func makeVectorPDF() throws -> Data {
        let mutableData = NSMutableData()
        guard let consumer = CGDataConsumer(data: mutableData as CFMutableData) else {
            throw TestError.pdfCreationFailed
        }
        var mediaBox = CGRect(x: 0, y: 0, width: 612, height: 792)
        guard let context = CGContext(
            consumer: consumer,
            mediaBox: &mediaBox,
            nil
        ) else {
            throw TestError.pdfCreationFailed
        }

        context.beginPDFPage(nil)
        context.setFillColor(CGColor(gray: 1, alpha: 1))
        context.fill(mediaBox)
        context.setStrokeColor(CGColor(red: 0.08, green: 0.36, blue: 0.25, alpha: 1))
        context.setLineWidth(8)
        context.move(to: CGPoint(x: 90, y: 150))
        context.addLine(to: CGPoint(x: 520, y: 650))
        context.strokePath()
        context.endPDFPage()
        context.closePDF()
        return mutableData as Data
    }

    private static func require(
        _ condition: @autoclosure () throws -> Bool,
        _ message: String
    ) rethrows {
        guard try condition() else {
            fputs("FAIL: \(message)\n", stderr)
            exit(1)
        }
    }

    private enum TestError: Error {
        case pdfCreationFailed
    }
}
