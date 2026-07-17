import AppKit
import Foundation
import PDFKit

struct PDFVisualArchive {
    let markdown: String
    let resourceDirectoryURL: URL
    let originalPDFURL: URL
    let pageCount: Int
    let renderedPageCount: Int
    let omittedPageCount: Int
    let usedCachedOutput: Bool
}

enum PDFVisualArchiveError: LocalizedError {
    case invalidDocument
    case failedToPrepareWorkspace(String)
    case failedToWriteManifest(String)

    var errorDescription: String? {
        switch self {
        case .invalidDocument:
            return "PDFKit could not open this document for visual preservation."
        case .failedToPrepareWorkspace(let details):
            return "PaperBridge could not prepare the PDF facsimile workspace. \(details)"
        case .failedToWriteManifest(let details):
            return "PaperBridge preserved the PDF but could not create its preview manifest. \(details)"
        }
    }
}

struct PDFVisualArchiveService {
    static let defaultMaximumRenderedPages = 120

    private static let cacheFormatVersion = "pdfkit-facsimile-v2"
    private let fileManager: FileManager
    private let workspaceRootOverride: URL?
    private let maxPageDimension: CGFloat
    private let maximumRenderedPages: Int

    init(
        fileManager: FileManager = .default,
        workspaceRoot: URL? = nil,
        maxPageDimension: CGFloat = 1_800,
        maximumRenderedPages: Int = PDFVisualArchiveService.defaultMaximumRenderedPages
    ) {
        self.fileManager = fileManager
        workspaceRootOverride = workspaceRoot
        self.maxPageDimension = max(maxPageDimension, 720)
        self.maximumRenderedPages = max(maximumRenderedPages, 0)
    }

    func archive(pdfData: Data, checksum: String) throws -> PDFVisualArchive {
        let workspace = workspaceURLs(checksum: checksum)
        if let cached = cachedArchive(at: workspace) {
            return cached
        }

        guard let document = PDFDocument(data: pdfData), document.pageCount > 0 else {
            throw PDFVisualArchiveError.invalidDocument
        }

        do {
            try fileManager.createDirectory(
                at: workspace.root,
                withIntermediateDirectories: true
            )
            try? fileManager.removeItem(at: workspace.completionMarker)
            if fileManager.fileExists(atPath: workspace.pages.path) {
                try fileManager.removeItem(at: workspace.pages)
            }
            try fileManager.createDirectory(
                at: workspace.pages,
                withIntermediateDirectories: true
            )
            try pdfData.write(to: workspace.originalPDF, options: .atomic)
        } catch {
            throw PDFVisualArchiveError.failedToPrepareWorkspace(error.localizedDescription)
        }

        var renderedPageCount = 0
        var omittedPageCount = 0
        var pageBlocks: [String] = []
        for pageIndex in 0..<document.pageCount {
            let pageNumber = pageIndex + 1
            guard pageIndex < maximumRenderedPages else {
                omittedPageCount += 1
                pageBlocks.append(omittedPageBlock(pageNumber))
                continue
            }

            let filename = String(format: "page-%04d.png", pageNumber)
            let pageURL = workspace.pages.appendingPathComponent(filename)

            if let page = document.page(at: pageIndex),
               let pngData = renderPNG(page: page) {
                do {
                    try pngData.write(to: pageURL, options: .atomic)
                    renderedPageCount += 1
                    pageBlocks.append(
                        "## Page \(pageNumber)\n\n![Original PDF page \(pageNumber)](pages/\(filename))"
                    )
                } catch {
                    pageBlocks.append(unavailablePageBlock(pageNumber))
                }
            } else {
                pageBlocks.append(unavailablePageBlock(pageNumber))
            }
        }

        let markdown = makeMarkdown(
            pageBlocks: pageBlocks,
            pageCount: document.pageCount,
            renderedPageCount: renderedPageCount,
            omittedPageCount: omittedPageCount
        )
        do {
            try Data(markdown.utf8).write(to: workspace.manifest, options: .atomic)
            try Data(Self.cacheFormatVersion.utf8).write(
                to: workspace.completionMarker,
                options: .atomic
            )
        } catch {
            throw PDFVisualArchiveError.failedToWriteManifest(error.localizedDescription)
        }

        return PDFVisualArchive(
            markdown: markdown,
            resourceDirectoryURL: workspace.root,
            originalPDFURL: workspace.originalPDF,
            pageCount: document.pageCount,
            renderedPageCount: renderedPageCount,
            omittedPageCount: omittedPageCount,
            usedCachedOutput: false
        )
    }

    private func renderPNG(page: PDFPage) -> Data? {
        var bounds = page.bounds(for: .cropBox)
        if abs(page.rotation) % 180 == 90 {
            bounds = CGRect(
                x: bounds.origin.x,
                y: bounds.origin.y,
                width: bounds.height,
                height: bounds.width
            )
        }
        guard bounds.width > 0, bounds.height > 0 else { return nil }

        let scale = maxPageDimension / max(bounds.width, bounds.height)
        let targetSize = CGSize(
            width: max(round(bounds.width * scale), 1),
            height: max(round(bounds.height * scale), 1)
        )
        let image = page.thumbnail(of: targetSize, for: .cropBox)
        guard let tiffData = image.tiffRepresentation,
              let bitmap = NSBitmapImageRep(data: tiffData) else { return nil }
        return bitmap.representation(using: .png, properties: [:])
    }

    private func makeMarkdown(
        pageBlocks: [String],
        pageCount: Int,
        renderedPageCount: Int,
        omittedPageCount: Int
    ) -> String {
        var notice = "This is a model-free PDFKit facsimile. The original PDF remains unchanged; page images preserve formulas, figures, tables, and visual layout without OCR."
        if omittedPageCount > 0 {
            notice += " To protect disk space on long documents, PNG previews are limited to the first \(maximumRenderedPages) pages; the exact original PDF still contains all \(pageCount) pages."
        }
        let failedPageCount = pageCount - renderedPageCount - omittedPageCount
        if failedPageCount > 0 {
            notice += " \(failedPageCount) page image(s) could not be generated; use the original PDF link for those pages."
        }

        return """
        # Original PDF facsimile

        > \(notice)

        [Open the exact original PDF](original.pdf)

        \(pageBlocks.joined(separator: "\n\n---\n\n"))
        """ + "\n"
    }

    private func unavailablePageBlock(_ pageNumber: Int) -> String {
        "## Page \(pageNumber)\n\n> Page preview unavailable. Open the exact original PDF above."
    }

    private func omittedPageBlock(_ pageNumber: Int) -> String {
        "## Page \(pageNumber)\n\n> Page PNG omitted for long-document safety. Open the exact original PDF above."
    }

    private func cachedArchive(
        at workspace: (
            root: URL,
            pages: URL,
            originalPDF: URL,
            manifest: URL,
            completionMarker: URL
        )
    ) -> PDFVisualArchive? {
        guard let marker = try? String(
            contentsOf: workspace.completionMarker,
            encoding: .utf8
        ), marker == Self.cacheFormatVersion,
              fileManager.fileExists(atPath: workspace.originalPDF.path),
              let document = PDFDocument(url: workspace.originalPDF),
              document.pageCount > 0,
              let markdown = try? String(contentsOf: workspace.manifest, encoding: .utf8),
              !markdown.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return nil
        }

        let renderedPageCount = (try? fileManager.contentsOfDirectory(
            at: workspace.pages,
            includingPropertiesForKeys: nil
        ))?.filter { $0.pathExtension.lowercased() == "png" }.count ?? 0
        let omittedPageCount = max(document.pageCount - maximumRenderedPages, 0)

        return PDFVisualArchive(
            markdown: markdown,
            resourceDirectoryURL: workspace.root,
            originalPDFURL: workspace.originalPDF,
            pageCount: document.pageCount,
            renderedPageCount: renderedPageCount,
            omittedPageCount: omittedPageCount,
            usedCachedOutput: true
        )
    }

    private func workspaceURLs(checksum: String) -> (
        root: URL,
        pages: URL,
        originalPDF: URL,
        manifest: URL,
        completionMarker: URL
    ) {
        let root = (workspaceRootOverride ?? defaultWorkspaceRoot())
            .appendingPathComponent(checksum, isDirectory: true)
        return (
            root,
            root.appendingPathComponent("pages", isDirectory: true),
            root.appendingPathComponent("original.pdf"),
            root.appendingPathComponent("paper_facsimile.md"),
            root.appendingPathComponent(".complete")
        )
    }

    private func defaultWorkspaceRoot() -> URL {
        let applicationSupport = fileManager.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        ).first ?? fileManager.temporaryDirectory
        return applicationSupport
            .appendingPathComponent("PaperBridge", isDirectory: true)
            .appendingPathComponent("PDFKitFacsimiles", isDirectory: true)
    }
}
