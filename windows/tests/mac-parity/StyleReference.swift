import Foundation

private struct StyleCase: Decodable {
    let label: String
    let prefix: String
    let unit: String
    let repeats: Int
    let suffix: String
    let titleUnit: String
    let titleRepeats: Int
}

@MainActor
func nativeStyles(fixturesDirectory: URL) throws -> [[String: String]] {
    let data = try Data(contentsOf: fixturesDirectory.appendingPathComponent("style-guides.json"))
    let cases = try JSONDecoder().decode([StyleCase].self, from: data)
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: directory) }
    let model = PaperReaderViewModel(workspaceStore: WorkspaceStore(rootURL: directory))
    return try cases.map { item in
        let raw = item.prefix + String(repeating: item.unit, count: item.repeats) + item.suffix
        let title = String(repeating: item.titleUnit, count: item.titleRepeats)
        let document = PaperDocument(name: title, checksum: item.label, cleanedText: "The peak remained at 532 nm.",
                                     paragraphs: ["The peak remained at 532 nm."], excludedReferenceParagraphs: [], referenceSectionTitle: nil)
        model.applyLoadedPaper(document)
        let input = try JSONSerialization.data(withJSONObject: ["translationStyleGuide": raw])
        let decoded = try JSONDecoder().decode(AppSettings.self, from: input)
        var settings = decoded
        settings.translationStyleGuide = raw
        let roundTrip = try JSONDecoder().decode(AppSettings.self, from: JSONEncoder().encode(settings))
        let prompt = model.translationInstructions(settings: settings)
        let base = PromptLibrary.translationSystemPrompt(targetLanguage: settings.targetLanguage)
        guard prompt.hasPrefix(base), roundTrip.translationStyleGuide == decoded.translationStyleGuide else { throw CocoaError(.fileReadCorruptFile) }
        return ["label": item.label, "saved": roundTrip.translationStyleGuide, "namespace": settings.aiCacheNamespace,
                "suffix": String(prompt.dropFirst(base.count)), "count": String(roundTrip.translationStyleGuide.count)]
    }
}

