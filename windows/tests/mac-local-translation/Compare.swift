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
    }
}
