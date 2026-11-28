import Foundation

private struct TermFixture: Decodable {
    struct Save: Decodable {
        let source: String
        let target: String
        let reverse: Bool
    }
    struct Query: Decodable {
        let text: String
        let reverse: Bool
    }
    let saves: [Save]
    let queries: [Query]
}

@MainActor
func nativeTerminologyReference(fixturesDirectory: URL) throws -> [String: Any] {
    let input = try Data(contentsOf: fixturesDirectory.appendingPathComponent("terminology.json"))
    let fixture = try JSONDecoder().decode(TermFixture.self, from: input)
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    let store = WorkspaceStore(rootURL: root)
    let model = PaperReaderViewModel(workspaceStore: store)
    model.settings.sourceLanguage = .english
    model.settings.targetLanguage = .simplifiedChinese

    func save(_ source: String, _ target: String, reverse: Bool = false) -> Bool {
        model.activeTextSelection = ReaderTextSelection(paragraphID: 1, side: reverse ? .translation : .original,
                                                       text: source, context: source, rangeLocation: 0,
                                                       rangeLength: (source as NSString).length)
        return model.saveSelectedTerm(translation: target)
    }
    func pairs(_ text: String, reverse: Bool = false) throws -> [[String: String]] {
        let prompt = model.terminologyPrompt(for: text, from: reverse ? .simplifiedChinese : .english,
                                             to: reverse ? .english : .simplifiedChinese)
        if prompt.isEmpty { return [] }
        guard let json = prompt.split(separator: "\n").last else { throw CocoaError(.fileReadCorruptFile) }
        return try JSONDecoder().decode([[String: String]].self, from: Data(json.utf8))
    }
    func rows(_ terms: [SavedTerm]) -> [[String: Any]] {
        terms.map { ["source": $0.source, "target": $0.translation, "reverse": $0.sourceLanguage == .simplifiedChinese] }
    }

    let accepted = fixture.saves.map { save($0.source, $0.target, reverse: $0.reverse) }
    let queries = try fixture.queries.map { try pairs($0.text, reverse: $0.reverse) }
    let reopened = rows(store.loadGlossary())
    guard let reverse = model.glossary.first(where: { $0.source == "磁场" && $0.sourceLanguage == .simplifiedChinese }) else {
        throw CocoaError(.fileReadCorruptFile)
    }
    model.removeTerm(reverse)
    let afterRemoval = rows(store.loadGlossary())
    let symbol = "👩🏽‍🔬"
    let boundaries = [save(String(repeating: symbol, count: 160), "ok"), save(String(repeating: symbol, count: 161), "ok"),
                      save("length", String(repeating: symbol, count: 300)), save("length", String(repeating: symbol, count: 301))]
    model.glossary = (1...500).map {
        SavedTerm(source: String(format: "term-%03d", $0), translation: "T\($0)", sourceLanguage: .english, targetLanguage: .simplifiedChinese)
    }
    let capacity = [save("extra", "extra"), save("TERM-009", "replacement")]
    let text = (1...27).map { String(format: "term-%03d", $0) }.joined(separator: " ")
    return ["accepted": accepted, "queries": queries, "reopened": reopened, "afterRemoval": afterRemoval,
            "boundaries": boundaries, "capacity": capacity, "capped": try pairs(text), "countAtCapacity": store.loadGlossary().count]
}
