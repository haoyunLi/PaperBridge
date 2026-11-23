import Foundation

func nativeLongBibliographies(fixtures: URL) throws -> [[String: Any]] {
    struct Reader: Decodable {
        struct Block: Decodable { let text: String }
        let blocks: [Block]
    }
    let reader = try JSONDecoder().decode(Reader.self, from: Data(contentsOf: fixtures.appendingPathComponent("good-enough/reader.json")))
    guard let references = reader.blocks.last?.text, let boundary = references.range(of: " 16. ") else {
        throw CocoaError(.fileReadCorruptFile)
    }
    let introduction = reader.blocks.prefix(12).map(\.text)
    let appendix = ["Appendix", "The additional observations were independently confirmed."]
    let lists = [["References " + references],
                 ["References " + references[..<boundary.lowerBound], String(references[boundary.lowerBound...]).trimmingCharacters(in: .whitespaces)]]
    return lists.map { list in
        let paragraphs = introduction + list + appendix
        let result = TextProcessing.excludeReferenceSection(from: paragraphs)
        return ["paragraphs": paragraphs, "body": result.bodyParagraphs, "references": result.referenceParagraphs]
    }
}
