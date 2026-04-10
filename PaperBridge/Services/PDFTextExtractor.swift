import Foundation
import PDFKit

enum PDFTextExtractorError: LocalizedError {
    case invalidDocument
    case noReadableText

    var errorDescription: String? {
        switch self {
        case .invalidDocument:
            return "Could not open the PDF. Make sure the file is valid, readable, and not password-protected."
        case .noReadableText:
            return "No readable text was extracted from this PDF. It may be image-only, encrypted, or malformed."
        }
    }
}

private struct ExtractedPDFPage {
    let bounds: CGRect
    let lines: [ExtractedTextLine]
    let fallbackText: String?
}

struct PDFTextExtractor {
    func extractText(from data: Data) throws -> String {
        guard let document = PDFDocument(data: data) else {
            throw PDFTextExtractorError.invalidDocument
        }

        var pageExtractions: [ExtractedPDFPage] = []

        for pageIndex in 0..<document.pageCount {
            guard let page = document.page(at: pageIndex) else { continue }

            let extractedLines = extractLines(from: page)
            let fallbackPageText = extractedLines.isEmpty
                ? (page.string ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                : nil

            pageExtractions.append(
                ExtractedPDFPage(
                    bounds: page.bounds(for: .cropBox),
                    lines: extractedLines,
                    fallbackText: fallbackPageText?.isEmpty == false ? fallbackPageText : nil
                )
            )
        }

        let filteredLinesByPage = filterRepeatedPageDecorations(in: pageExtractions)
        var paragraphs: [String] = []

        for (pageIndex, extraction) in pageExtractions.enumerated() {
            let filteredLines = pageIndex < filteredLinesByPage.count ? filteredLinesByPage[pageIndex] : extraction.lines
            if !filteredLines.isEmpty {
                paragraphs.append(contentsOf: TextProcessing.rebuildParagraphs(from: filteredLines, pageBounds: extraction.bounds))
                continue
            }

            if let fallbackPageText = extraction.fallbackText {
                paragraphs.append(contentsOf: TextProcessing.rebuildParagraphs(fromPageText: fallbackPageText))
            }
        }

        guard !paragraphs.isEmpty else {
            throw PDFTextExtractorError.noReadableText
        }

        return paragraphs.joined(separator: "\n\n")
    }

    private func extractLines(from page: PDFPage) -> [ExtractedTextLine] {
        guard let pageSelection = page.selection(for: page.bounds(for: .cropBox)) else {
            return []
        }

        return pageSelection.selectionsByLine().compactMap { lineSelection in
            let text = TextProcessing.normalizeExtractedLine(lineSelection.string ?? "")
            guard !text.isEmpty else { return nil }

            return ExtractedTextLine(
                text: text,
                bounds: lineSelection.bounds(for: page)
            )
        }
    }

    private func filterRepeatedPageDecorations(
        in pageExtractions: [ExtractedPDFPage]
    ) -> [[ExtractedTextLine]] {
        struct RepeatedLineInfo {
            var pages: Set<Int> = []
            var headerPages: Set<Int> = []
            var footerPages: Set<Int> = []
            var firstPage: Int = .max
        }

        guard !pageExtractions.isEmpty else { return [] }

        var repeatedLineInfoBySignature: [String: RepeatedLineInfo] = [:]

        for (pageIndex, extraction) in pageExtractions.enumerated() {
            let headerThreshold = extraction.bounds.maxY - (extraction.bounds.height * 0.18)
            let footerThreshold = extraction.bounds.minY + (extraction.bounds.height * 0.12)
            var signaturesSeenOnPage: Set<String> = []

            for line in extraction.lines {
                let signature = pageDecorationSignature(for: line.text)
                guard !signature.isEmpty else { continue }
                guard isLikelyHeaderOrFooterLine(line, headerThreshold: headerThreshold, footerThreshold: footerThreshold) else {
                    continue
                }
                guard signaturesSeenOnPage.insert(signature).inserted else { continue }

                var info = repeatedLineInfoBySignature[signature] ?? RepeatedLineInfo()
                info.pages.insert(pageIndex)
                info.firstPage = min(info.firstPage, pageIndex)

                if line.bounds.minY >= headerThreshold {
                    info.headerPages.insert(pageIndex)
                }

                if line.bounds.maxY <= footerThreshold {
                    info.footerPages.insert(pageIndex)
                }

                repeatedLineInfoBySignature[signature] = info
            }
        }

        let repeatedSignatures = repeatedLineInfoBySignature.filter { _, info in
            info.pages.count >= 2 && (info.headerPages.count >= 2 || info.footerPages.count >= 2)
        }

        return pageExtractions.enumerated().map { pageIndex, extraction in
            let headerThreshold = extraction.bounds.maxY - (extraction.bounds.height * 0.18)
            let footerThreshold = extraction.bounds.minY + (extraction.bounds.height * 0.12)

            return extraction.lines.filter { line in
                let signature = pageDecorationSignature(for: line.text)
                guard let info = repeatedSignatures[signature] else { return true }

                let isHeader = line.bounds.minY >= headerThreshold
                let isFooter = line.bounds.maxY <= footerThreshold

                if isFooter {
                    return false
                }

                if isHeader, pageIndex > info.firstPage {
                    return false
                }

                return true
            }
        }
    }

    private func isLikelyHeaderOrFooterLine(
        _ line: ExtractedTextLine,
        headerThreshold: CGFloat,
        footerThreshold: CGFloat
    ) -> Bool {
        let text = line.text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, text.count <= 180 else { return false }
        return line.bounds.minY >= headerThreshold || line.bounds.maxY <= footerThreshold
    }

    private func pageDecorationSignature(for text: String) -> String {
        text
            .lowercased()
            .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
