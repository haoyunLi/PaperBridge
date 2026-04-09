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

struct PDFTextExtractor {
    func extractText(from data: Data) throws -> String {
        guard let document = PDFDocument(data: data) else {
            throw PDFTextExtractorError.invalidDocument
        }

        var paragraphs: [String] = []

        for pageIndex in 0..<document.pageCount {
            guard let page = document.page(at: pageIndex) else { continue }

            let extractedLines = extractLines(from: page)
            if !extractedLines.isEmpty {
                paragraphs.append(contentsOf: TextProcessing.rebuildParagraphs(from: extractedLines, pageBounds: page.bounds(for: .cropBox)))
                continue
            }

            let fallbackPageText = (page.string ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            if !fallbackPageText.isEmpty {
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
}
