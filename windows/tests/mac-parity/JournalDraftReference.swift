import CryptoKit
import Foundation

// Use the same saved model outputs on both platforms so differences come from
// the reader or exporter. The source hashes distinguish repeatable, exact inputs.
func nativeJournalDraft(fixtures: URL) throws -> [String: Any] {
    func sha(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }
    let directory = fixtures.appendingPathComponent("tabbed")
    let source = try String(contentsOf: directory.appendingPathComponent("article.md"), encoding: .utf8)
    let translations = try JSONDecoder().decode([String: String].self,
        from: Data(contentsOf: directory.appendingPathComponent("translations.json")))
    let article = AcademicMarkdownProcessor.assignParagraphs(in: AcademicMarkdownProcessor.parse(source))
    var matched = Set<String>()
    let complete = article.segments.compactMap { segment -> ParagraphResult? in
        guard let id = segment.paragraphID else { return nil }
        let key = sha(Data(segment.source.utf8))
        let value = translations[key]
        if value != nil { matched.insert(key) }
        return ParagraphResult(id: id, original: segment.analysisText ?? segment.source, sourceMarkdown: segment.source,
                               translation: value ?? "", translationMarkdown: value, status: value == nil ? .pending : .ok)
    }
    func drafts(_ results: [ParagraphResult]) -> [String: String] {
        ["translated": AcademicMarkdownProcessor.translatedMarkdown(segments: article.segments, results: results),
         "bilingual": AcademicMarkdownProcessor.bilingualMarkdown(segments: article.segments, results: results,
                                                                  targetLanguage: .simplifiedChinese)]
    }
    var unfinished = complete
    for index in unfinished.indices where unfinished[index].sourceMarkdown?.hasPrefix("Automated reading of large") == true {
        unfinished[index].status = .failed
    }

    let documents = drafts(complete)
    let files = FileManager.default
    let temp = files.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try files.createDirectory(at: temp, withIntermediateDirectories: true)
    defer { try? files.removeItem(at: temp) }
    let result = try MarkdownBundleExporter().export(paperName: "Tabbed.pdf", documents: [
        "paper_original.md": source, "paper_translation_zh-Hans.md": documents["translated"]!,
        "paper_bilingual_en_zh-Hans.md": documents["bilingual"]!, "paper_full_translation_zh-Hans.md": documents["translated"]!
    ], assetSourceDirectory: directory, to: temp)
    let urls = try files.contentsOfDirectory(at: result.directoryURL.appendingPathComponent("images"),
                                               includingPropertiesForKeys: nil)
    let imageHashes = try urls.map { sha(try Data(contentsOf: $0)) }.sorted()
    let exported = try String(contentsOf: result.directoryURL.appendingPathComponent("paper_full_translation_zh-Hans.md"),
                              encoding: .utf8)

    // Older results may have just their plain translated text.
    let legacySource = "## Signals\n\n1. Calibrate the sensor.\n\n> Keep the probe dry."
    let legacy = AcademicMarkdownProcessor.assignParagraphs(in: AcademicMarkdownProcessor.parse(legacySource))
    let targets = ["信号", "校准传感器。", "保持探针干燥。\n记录温度。"]
    let legacyResults = legacy.segments.compactMap { segment -> ParagraphResult? in
        guard let id = segment.paragraphID else { return nil }
        return ParagraphResult(id: id, original: segment.analysisText ?? "", sourceMarkdown: segment.source,
                               translation: targets[id - 1], status: .ok)
    }
    return ["matched": matched.count, "unmatched": translations.keys.filter { !matched.contains($0) }.sorted(),
            "complete": documents, "unfinished": drafts(unfinished), "failedCount": unfinished.filter { $0.status == .failed }.count,
            "exportedFull": exported, "imageHashes": imageHashes, "assets": result.copiedAssetCount,
            "legacyTranslated": AcademicMarkdownProcessor.translatedMarkdown(segments: legacy.segments, results: legacyResults),
            "legacyBilingual": AcademicMarkdownProcessor.bilingualMarkdown(segments: legacy.segments, results: legacyResults,
                                                                           targetLanguage: .simplifiedChinese)]
}
