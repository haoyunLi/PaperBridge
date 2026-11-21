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
    let papers: [Paper]
    let markdown: [String]
}

@main
struct Reference {
    static func main() throws {
        let fixtureURL = URL(fileURLWithPath: CommandLine.arguments[1])
        let fixtures = try JSONDecoder().decode(Fixtures.self, from: Data(contentsOf: fixtureURL))
        let papers: [[String: Any]] = fixtures.papers.map { fixture in
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
        let markdown = try fixtures.markdown.map { source in
            let payload = AcademicMarkdownProcessor.protectForTranslation(source)
            let translated = payload.text.replacingOccurrences(of: "Before", with: "前文")
                                         .replacingOccurrences(of: "After", with: "后文")
            return try AcademicMarkdownProcessor.restoreProtectedTokens(in: translated, from: payload)
        }
        let data = try JSONSerialization.data(withJSONObject: ["papers": papers, "markdown": markdown], options: [.sortedKeys])
        try data.write(to: URL(fileURLWithPath: CommandLine.arguments[2]))
    }
}
