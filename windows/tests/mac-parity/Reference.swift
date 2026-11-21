import Foundation
import CryptoKit

private struct Fixtures: Decodable {
    struct Paper: Decodable {
        struct Block: Decodable {
            let text: String
            let sourceMarkdown: String?
        }
        let name: String
        let blocks: [Block]
    }
    struct Consolidation: Decodable {
        struct Response: Codable {
            struct Claim: Codable {
                let text: String
                let sources: [SummarySource]
            }
            let claims: [Claim]
        }
        let paragraphs: [String]
        let excerpt: Response
        let merge: Response
    }
    struct Paste: Decodable {
        let text: String
    }
    let pastedFrontMatter: [Paste]
    struct ReaderSearch: Decodable {
        struct Block: Decodable {
            let source: String
            let translation: String?
        }
        let blocks: [Block]
        let queries: [String]
    }
    let readerSearch: ReaderSearch
    let summaryConsolidation: Consolidation
    struct Evidence: Decodable {
        let source: String
        let quote: String
        let `repeat`: Int?
    }
    struct Batch: Decodable {
        struct Paragraph: Decodable {
            let text: String
            let `repeat`: Int?
            let prefix: String?
            let suffix: String?
        }
        let paragraphs: [Paragraph]
        var texts: [String] {
            paragraphs.map { ($0.prefix ?? "") + String(repeating: $0.text, count: $0.repeat ?? 1) + ($0.suffix ?? "") }
        }
    }
    let summaryEvidence: [Evidence]
    let summaryBatches: [Batch]
    let connectedBatches: [Batch]
    struct Bibliography: Decodable {
        let paragraphs: [String]
    }
    let bibliographies: [Bibliography]
    let papers: [Paper]
    struct Merge: Decodable {
        let left: String
        let right: String
        let marks: [Mark]?
    }
    struct Mark: Decodable {
        let paragraph: Int
        let quote: String
        let offset: Int
        let body: String
        let translation: Bool?
    }
    struct Reflow: Decodable {
        let text: String
        let target: Int
    }
    let markdown: [String]
    let merges: [Merge]
    let reflows: [Reflow]
    let pageBoundaries: [Merge]
}

@main
struct Reference {
    static func main() throws {
        let fixtureURL = URL(fileURLWithPath: CommandLine.arguments[1])
        let fixtures = try JSONDecoder().decode(Fixtures.self, from: Data(contentsOf: fixtureURL))
        let sample = Fixtures.Paper(name: "built-in practice",
                                   blocks: ReadingGuideBuilder.sampleParagraphs.map { Fixtures.Paper.Block(text: $0, sourceMarkdown: nil) })
        let papers: [[String: Any]] = (fixtures.papers + [sample]).map { fixture in
            let paragraphs = fixture.blocks.map(\.text)
            let segments: [PaperMarkdownSegment] = fixture.blocks.enumerated().compactMap { index, block in
                guard let source = block.sourceMarkdown,
                      var segment = AcademicMarkdownProcessor.parse(source).first else { return nil }
                segment.paragraphID = index + 1
                return segment
            }
            let paper = PaperDocument(name: fixture.name, checksum: fixture.name,
                                      cleanedText: paragraphs.joined(separator: "\n\n"),
                                      paragraphs: paragraphs, excludedReferenceParagraphs: [],
                                      referenceSectionTitle: nil, markdownSegments: segments)
            let sections = PaperReadingAnalysis.sections(in: paper)
            let ranges: [[String: Any]] = sections.map { ["title": $0.title, "startId": $0.id, "ids": $0.paragraphIDs] }
            let guide: [[String: Any]] = ReadingGuideBuilder.build(for: paper).map {
                ["id": $0.id, "title": $0.title, "question": $0.question, "sectionTitle": $0.sectionTitle,
                 "paragraphID": $0.paragraphID, "excerpt": $0.excerpt]
            }
            let issues: [[String: Any]] = PaperReadingAnalysis.qualityIssues(in: paper).map {
                ["id": $0.paragraphID, "reason": $0.reason]
            }
            return ["name": fixture.name, "sections": ranges, "overview": PaperReadingAnalysis.overviewParagraphIDs(in: sections),
                    "guide": guide, "issues": issues]
        }
        let consolidation = fixtures.summaryConsolidation
        let paper = PaperDocument(name: "Study", checksum: "study", cleanedText: consolidation.paragraphs.joined(separator: "\n\n"),
                                  paragraphs: consolidation.paragraphs, excludedReferenceParagraphs: [], referenceSectionTitle: nil)
        let supplied = SummaryEvidence.sourceBatches(paper.paragraphs).joined(separator: "\n\n")
        let partial = SummaryEvidence.parse(String(decoding: try JSONEncoder().encode(consolidation.excerpt), as: UTF8.self),
                                            paper: paper, providedText: supplied)
        let merged = SummaryEvidence.parse(String(decoding: try JSONEncoder().encode(consolidation.merge), as: UTF8.self),
                                           paper: paper, allowedSources: partial.flatMap(\.sources))
        let summaryStages: [[String: Any]] = [partial, merged].map { claims in
            ["numbered": SummaryEvidence.markdown(claims), "sources": claims.map { claim in
                claim.sources.map { ["paragraphID": $0.paragraphID, "quote": $0.quote] as [String: Any] }
            }]
        }
        let evidence = try fixtures.summaryEvidence.map { fixture -> [String] in
            let paragraph = String(repeating: fixture.source, count: fixture.repeat ?? 1)
            let quote = String(repeating: fixture.quote, count: fixture.repeat ?? 1)
            let paper = PaperDocument(name: "Summary", checksum: "summary", cleanedText: paragraph,
                                      paragraphs: [paragraph], excludedReferenceParagraphs: [], referenceSectionTitle: nil)
            let object: [String: Any] = ["claims": [["text": "Study result", "sources": [["paragraphID": 1, "quote": quote]]]]]
            let output = String(decoding: try JSONSerialization.data(withJSONObject: object), as: UTF8.self)
            return SummaryEvidence.parse(output, paper: paper, providedText: "[P1]\n" + paragraph).flatMap(\.sources).map(\.quote)
        }
        let summaryBatches = fixtures.summaryBatches.map { SummaryEvidence.sourceBatches($0.texts) }
        let connectedBatches = fixtures.connectedBatches.map {
            TextProcessing.buildTextBatches($0.texts, maxChars: TextProcessing.connectedTranslationBatchChars)
        }
        let publishedPDF = try Data(contentsOf: fixtureURL.deletingLastPathComponent().appendingPathComponent("emcee-v3.pdf"))
        let publishedText = try PDFTextExtractor().extractText(from: publishedPDF)
        let paragraphs = TextProcessing.splitIntoParagraphs(TextProcessing.cleanExtractedText(publishedText))
        let body = TextProcessing.excludeReferenceSection(from: paragraphs).bodyParagraphs
        let published: [String: Any] = [
            "sha256": SHA256.hash(data: publishedPDF).map { String(format: "%02x", $0) }.joined(),
            "paragraphs": body,
            "summaryBatches": SummaryEvidence.sourceBatches(body),
            "paragraphChunks": [500, 1000, 1800].map { limit -> [String: Any] in
                ["limit": limit, "chunks": body.map { TextProcessing.chunkParagraph($0, maxChars: limit) }]
            },
            "batches": TextProcessing.buildTextBatches(body, maxChars: TextProcessing.connectedTranslationBatchChars)
        ]
        let journalMarkdown = try String(contentsOf: fixtureURL.deletingLastPathComponent().appendingPathComponent("emcee-v3-mineru.md"), encoding: .utf8)
        let structured = AcademicMarkdownProcessor.assignParagraphs(in: AcademicMarkdownProcessor.parse(journalMarkdown))
        let structuredJournal: [String: Any] = [
            "headings": structured.segments.filter { $0.kind == .heading && $0.paragraphID != nil }.compactMap(\.analysisText),
            "body": structured.paragraphs,
            "summaryBatches": SummaryEvidence.sourceBatches(structured.paragraphs)
        ]
        let bibliographies = fixtures.bibliographies.map { fixture in
            let result = TextProcessing.excludeReferenceSection(from: fixture.paragraphs)
            return ["body": result.bodyParagraphs, "references": result.referenceParagraphs]
        }
        let markdown = try fixtures.markdown.map { source in
            let payload = AcademicMarkdownProcessor.protectForTranslation(source)
            let translated = payload.text.replacingOccurrences(of: "Before", with: "前文")
                                         .replacingOccurrences(of: "After", with: "后文")
            return try AcademicMarkdownProcessor.restoreProtectedTokens(in: translated, from: payload)
        }
        let merges = fixtures.merges.map { TextProcessing.mergeForReading($0.left, $0.right) }
        let annotations = fixtures.merges.enumerated().map { index, fixture -> [[String: Any]] in
            let old = [ParagraphResult(id: 1, original: fixture.left, translation: "译文"),
                       ParagraphResult(id: 2, original: fixture.right, translation: "译文")]
            let new = [ParagraphResult(id: 1, original: merges[index])]
            let mapping = ParagraphMutationMapping(oldRange: 0..<2, replacementCount: 1)
            return (fixture.marks ?? []).map { mark in
                let original = PaperAnnotation(paragraphID: mark.paragraph, side: mark.translation == true ? .translation : .original,
                                               quote: mark.quote, rangeLocation: mark.offset, rangeLength: mark.quote.utf16.count, note: mark.body)
                let result = mapping.remap(original, old: old, new: new)
                return ["paragraph": result.paragraphID, "quote": result.quote, "offset": result.rangeLocation,
                        "body": result.note, "review": result.needsReview ?? false]
            }
        }
        let reflows = fixtures.reflows.map { fixture -> [String] in
            let paragraphs = TextProcessing.splitForReading(fixture.text, targetChars: fixture.target)
            // The Reader applies a reflow only when it produces more than one paragraph.
            return paragraphs.count > 1 ? paragraphs : [fixture.text]
        }
        let pageBoundaries = fixtures.pageBoundaries.map { TextProcessing.stitchPageParagraphs([[$0.left], [$0.right]]) }
        let pdfURL = fixtureURL.deletingLastPathComponent().appendingPathComponent("column-footnote.pdf")
        let pdfBytes = try Data(contentsOf: pdfURL)
        let columnPDF = try PDFTextExtractor().extractText(from: pdfBytes)
        let pdfHash = SHA256.hash(data: pdfBytes).map { String(format: "%02x", $0) }.joined()
        // PaperReaderViewModel.visibleParagraphResults searches each side separately.
        let readerSearch = fixtures.readerSearch.queries.map { raw in
            let query = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            return fixtures.readerSearch.blocks.enumerated().compactMap { index, block -> Int? in
                let matches = query.isEmpty || block.source.localizedCaseInsensitiveContains(query)
                    || (block.translation ?? "").localizedCaseInsensitiveContains(query)
                return matches ? index + 1 : nil
            }
        }
        // Follow PaperReaderViewModel.buildPaper(fromText:) for each clipboard layout.
        let pastedFrontMatter = fixtures.pastedFrontMatter.map { example -> [String] in
            let text = example.text.replacingOccurrences(of: "\r", with: "\n")
            if text.contains("\n\n") {
                return TextProcessing.postProcessParagraphs(TextProcessing.splitIntoParagraphs(TextProcessing.cleanExtractedText(text)))
            }
            if text.contains("\n") { return TextProcessing.rebuildParagraphs(fromPageText: text) }
            return TextProcessing.postProcessParagraphs([text])
        }
        let bundle = try nativeBundleReference(fixturesDirectory: fixtureURL.deletingLastPathComponent())
        let library = try nativeLibraryReference(fixturesDirectory: fixtureURL.deletingLastPathComponent())
        let output: [String: Any] = ["library": library, "pastedFrontMatter": pastedFrontMatter, "bundle": bundle, "readerSearch": readerSearch, "publishedPaper": published, "structuredJournal": structuredJournal, "connectedBatches": connectedBatches, "columnPDF": columnPDF, "columnPDFSHA256": pdfHash, "summaryStages": summaryStages, "summaryEvidence": evidence, "summaryBatches": summaryBatches, "papers": papers, "bibliographies": bibliographies, "markdown": markdown, "practice": ReadingGuideBuilder.sampleParagraphs,
                                     "merges": merges, "reflows": reflows, "annotations": annotations, "pageBoundaries": pageBoundaries]
        let data = try JSONSerialization.data(withJSONObject: output, options: [.sortedKeys])
        try data.write(to: URL(fileURLWithPath: CommandLine.arguments[2]))
    }
}
