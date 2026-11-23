import Foundation

@main
struct CompareLocalTranslation {
    struct Article: Decodable {
        struct Paragraph: Decodable { let id: Int; let text: String }
        let blocks: [Paragraph]
    }

    @MainActor
    static func waitForTranslation(_ model: PaperReaderViewModel) async throws {
        let deadline = Date().addingTimeInterval(900)
        while model.isBusy {
            guard Date() < deadline else { throw CocoaError(.userCancelled) }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        if let error = model.errorMessage {
            throw NSError(domain: "MacLocalTranslation", code: 1, userInfo: [NSLocalizedDescriptionKey: error])
        }
    }

    @MainActor
    static func compareJournal(_ model: PaperReaderViewModel, sourceURL: URL, outputURL: URL) async throws {
        let source = try String(contentsOf: sourceURL, encoding: .utf8)
        let article = AcademicMarkdownProcessor.assignParagraphs(in: AcademicMarkdownProcessor.parse(source))
        model.applyLoadedPaper(PaperDocument(name: "Tabbed", checksum: Hashing.sha256(source),
            cleanedText: article.paragraphs.joined(separator: "\n\n"), paragraphs: article.paragraphs,
            excludedReferenceParagraphs: [], referenceSectionTitle: nil, sourceMarkdown: source,
            markdownSegments: article.segments))
        model.settings.maxParagraphChars = 1800
        let prefixes = ["Authors of papers retain copyright", "Strings in the data section",
                        "**from** tabbed.reading", "## Iterative Reading"]
        let selected = try prefixes.map { prefix in
            guard let block = model.paragraphResults.first(where: { $0.sourceMarkdown?.hasPrefix(prefix) == true }) else {
                throw NSError(domain: "MacLocalTranslation", code: 2, userInfo: [NSLocalizedDescriptionKey: prefix])
            }
            return block.id
        }
        model.translatePaper(paragraphIDs: selected)
        try await waitForTranslation(model)
        let records = try selected.map { id -> [String: Any] in
            guard let block = model.paragraphResults.first(where: { $0.id == id }) else { throw CocoaError(.fileReadCorruptFile) }
            return ["source": block.sourceMarkdown ?? block.original, "translation": block.translationMarkdown ?? block.translation,
                    "chunks": block.chunkCount, "status": block.status.rawValue, "error": block.errorMessage ?? ""]
        }
        try JSONSerialization.data(withJSONObject: records, options: [.prettyPrinted, .sortedKeys]).write(to: outputURL, options: .atomic)
    }

    @MainActor
    static func main() async throws {
        let arguments = CommandLine.arguments
        let article = try JSONDecoder().decode(Article.self, from: Data(contentsOf: URL(fileURLWithPath: arguments[1])))
        let selected = article.blocks.filter { (54...56).contains($0.id) }
        guard selected.map(\.id) == [54, 55, 56] else { throw CocoaError(.fileReadCorruptFile) }
        let text = selected.map(\.text)
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let model = PaperReaderViewModel(workspaceStore: WorkspaceStore(rootURL: root))
        model.applyLoadedPaper(PaperDocument(name: "Good enough practices in scientific computing",
            checksum: Hashing.sha256(text.joined(separator: "\n\n")), cleanedText: text.joined(separator: "\n\n"),
            paragraphs: text, excludedReferenceParagraphs: [], referenceSectionTitle: nil))
        model.settings = AppSettings()
        model.settings.ollamaBaseURL = "http://127.0.0.1:11491"
        model.settings.maxParagraphChars = 500
        model.translatePaper()
        try await waitForTranslation(model)
        let paragraphs: [[String: Any]] = zip(selected, model.paragraphResults).map { item, result in
            ["articleID": item.id, "source": item.text, "chunks": result.chunkCount, "translation": result.translation,
             "status": result.status.rawValue, "error": result.errorMessage ?? ""]
        }
        model.generateConnectedTranslation()
        try await waitForTranslation(model)
        guard let draft = model.connectedTranslation else { throw CocoaError(.fileReadUnknown) }
        let output: [String: Any] = ["paragraphs": paragraphs, "connected": draft.text,
            "batches": draft.batchCount, "failedBatches": draft.failedBatchCount]
        let data = try JSONSerialization.data(withJSONObject: output, options: [.prettyPrinted, .sortedKeys])
        try data.write(to: URL(fileURLWithPath: arguments[2]), options: .atomic)
        if arguments.count == 5 {
            try await compareJournal(model, sourceURL: URL(fileURLWithPath: arguments[3]), outputURL: URL(fileURLWithPath: arguments[4]))
        }
    }
}
