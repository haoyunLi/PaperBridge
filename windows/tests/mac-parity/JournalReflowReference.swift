import Foundation

func nativeJournalReflows(fixtures: URL) throws -> [[String: Any]] {
    struct Reader: Decodable {
        struct Block: Decodable { let id: Int; let text: String }
        let blocks: [Block]
    }
    let source = fixtures.appendingPathComponent("good-enough/reader.json")
    let paper = try JSONDecoder().decode(Reader.self, from: Data(contentsOf: source))
    // The final block is the numbered bibliography. Reflow only the article's prose.
    return [900, 500].flatMap { target in
        paper.blocks.dropLast().filter { $0.text.count > target }.map { block in
            let pieces = TextProcessing.splitForReading(block.text, targetChars: target)
            return ["id": block.id, "target": target, "parts": pieces.count > 1 ? pieces : [block.text]]
        }
    }
}
