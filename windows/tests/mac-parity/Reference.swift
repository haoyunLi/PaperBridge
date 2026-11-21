import Foundation

private struct Fixtures: Decodable {
    struct Paper: Decodable {
        struct Block: Decodable {
            let text: String
            let sourceMarkdown: String?
        }
        let name: String
        let blocks: [Block]
    }
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
        let output: [String: Any] = ["papers": papers, "bibliographies": bibliographies, "markdown": markdown, "practice": ReadingGuideBuilder.sampleParagraphs,
                                     "merges": merges, "reflows": reflows, "annotations": annotations, "pageBoundaries": pageBoundaries]
        let data = try JSONSerialization.data(withJSONObject: output, options: [.sortedKeys])
        try data.write(to: URL(fileURLWithPath: CommandLine.arguments[2]))
    }
}
