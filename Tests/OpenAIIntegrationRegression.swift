import Foundation

private final class MemoryAPIKeyStore: APIKeyStoring {
    var key: String?
    func read() throws -> String? { key }
    func save(_ value: String) throws { key = value }
    func delete() throws { key = nil }
}

private final class MockOpenAIIntegrationProtocol: URLProtocol {
    static let lock = NSLock()
    static var captured: [[String: Any]] = []
    static var status = 200
    static var delay: TimeInterval = 0
    private var work: DispatchWorkItem?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        var body = request.httpBody ?? Data()
        if let stream = request.httpBodyStream, body.isEmpty {
            stream.open()
            defer { stream.close() }
            var buffer = [UInt8](repeating: 0, count: 4096)
            while stream.hasBytesAvailable {
                let count = stream.read(&buffer, maxLength: buffer.count)
                if count <= 0 { break }
                body.append(contentsOf: buffer.prefix(count))
            }
        }
        let payload = (try? JSONSerialization.jsonObject(with: body)) as? [String: Any] ?? [:]
        Self.lock.lock()
        Self.captured.append(payload)
        let status = Self.status
        let delay = Self.delay
        Self.lock.unlock()
        let model = payload["model"] as? String ?? ""
        let input = payload["input"] as? String ?? ""
        let text = model == "markdown-fixture" ? (input.components(separatedBy: "\n\nMarkdown block:\n").last ?? "") : model == "summary-fixture"
            ? "{\"claims\":[{\"text\":\"A short finding.\",\"sources\":[]}]}"
            : "Translated sentence."
        let responseStatus = model == "partial-fixture" && input.contains("First sentence.") ? "incomplete" : "completed"
        let json: [String: Any] = request.url?.path == "/v1/models"
            ? ["data": [["id": "translation-fixture"], ["id": "summary-fixture"]]]
            : ["status": responseStatus, "output": [["type": "message", "role": "assistant", "content": [["type": "output_text", "text": text]]]]]
        let data = try! JSONSerialization.data(withJSONObject: json)
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!
        let work = DispatchWorkItem { [weak self] in
            guard let self else { return }
            self.client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            self.client?.urlProtocol(self, didLoad: data)
            self.client?.urlProtocolDidFinishLoading(self)
        }
        self.work = work
        DispatchQueue.global().asyncAfter(deadline: .now() + delay, execute: work)
    }

    override func stopLoading() { work?.cancel() }

    static func configure(status: Int = 200, delay: TimeInterval = 0) {
        lock.lock()
        defer { lock.unlock() }
        self.status = status
        self.delay = delay
    }

    static func requests() -> [[String: Any]] {
        lock.lock()
        defer { lock.unlock() }
        return captured
    }
}

extension ReadingReliabilityRegression {
    @MainActor
    static func verifyOpenAIIntegration(root: URL, client: OllamaClient) async throws {
        let legacy = try JSONDecoder().decode(AppSettings.self, from: Data("{\"translationModel\":\"translategemma:12b\"}".utf8))
        require(legacy.aiProvider == .ollama && legacy.activeTranslationModel == "translategemma:12b", "Legacy settings must stay local")
        require(legacy.aiCacheNamespace == legacy.ollamaBaseURL, "Existing local cache namespace changed")
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockOpenAIIntegrationProtocol.self]
        let cloudClient = OpenAIClient(session: URLSession(configuration: configuration))
        let keys = MemoryAPIKeyStore()
        let store = WorkspaceStore(rootURL: root.appendingPathComponent("openai-integration"))
        let vm = PaperReaderViewModel(workspaceStore: store, ollamaClient: client, openAIClient: cloudClient, apiKeyStore: keys)
        let paper = PaperDocument(name: "Synthetic API Fixture", checksum: "synthetic-api-fixture", cleanedText: "First sentence. Second sentence.",
                                  paragraphs: ["First sentence.", "Second sentence."], excludedReferenceParagraphs: [], referenceSectionTitle: nil)
        vm.applyLoadedPaper(paper)
        vm.settings.aiProvider = .openAI
        vm.settings.openAITranslationModel = "translation-fixture"
        vm.settings.openAISummaryModel = "summary-fixture"
        vm.settings.openAIExplainModel = "explain-fixture"
        vm.settings.openAIQuickLookupModel = "lookup-fixture"
        vm.saveOpenAIAPIKey("synthetic-test-key-never-real")
        let before = MockOpenAIIntegrationProtocol.requests().count
        vm.translatePaper()
        try await waitUntilIdle(vm)
        require(MockOpenAIIntegrationProtocol.requests().count == before, "Text was sent before explicit consent")
        require(vm.errorMessage?.contains("Nothing was sent") == true, "Missing consent must have an actionable error")
        vm.refreshOpenAIModels()
        for _ in 0..<200 {
            if !vm.isRefreshingOpenAIModels { break }
            try await Task.sleep(for: .milliseconds(10))
        }
        require(vm.openAIModels == ["summary-fixture", "translation-fixture"], "Model listing did not populate")
        require(vm.settings.activeTranslationModel == "translation-fixture", "Refresh silently changed selected model")
        let ollamaRequests = MockOllamaProtocol.requestCount()
        vm.isOpenAIOptInConfirmed = true
        vm.settings.translationStyleGuide = "Use clear academic language."
        vm.translatePaper()
        try await waitUntilIdle(vm)
        require(vm.translatedCount == 2, "OpenAI paragraph translation did not finish")
        let translationRequests = MockOpenAIIntegrationProtocol.requests().filter { $0["model"] as? String == "translation-fixture" }
        require(translationRequests.count == 2, "Translation model routing is incorrect")
        let instructions = translationRequests.first?["instructions"] as? String ?? ""
        require(instructions.contains("single word") && instructions.contains("Do not ask for more context") && instructions.contains("Synthetic API Fixture") && instructions.contains("Use clear academic language"), "Translation instructions lost complete-unit or context rules")
        require(translationRequests.allSatisfy { ($0["store"] as? Bool) == false }, "Cloud request storage was enabled")

        vm.selectedParagraphID = 1
        vm.explainSelectedParagraph()
        try await waitUntilIdle(vm)
        require(!vm.explanationText.isEmpty, "Online paragraph explanation failed")
        require(MockOpenAIIntegrationProtocol.requests().contains { $0["model"] as? String == "explain-fixture" }, "Explanation used the wrong model")
        vm.generateSummaries()
        try await waitUntilIdle(vm)
        require(vm.summaries != nil, "Online summary generation failed")
        vm.generateConnectedTranslation()
        try await waitUntilIdle(vm)
        require(vm.connectedTranslation?.failedBatchCount == 0, "Online full translation failed")

        let selection = ReaderTextSelection(paragraphID: 1, side: .original, text: "First", context: "First sentence.", rangeLocation: 0, rangeLength: 5)
        vm.captureTextSelection(selection)
        vm.translateTextSelection()
        try await waitForLookup(vm)
        require(vm.selectionTranslation == "Translated sentence.", "Online selection translation failed")
        let lookup = MockOpenAIIntegrationProtocol.requests().last!
        require(lookup["model"] as? String == "lookup-fixture", "Selection used the wrong model")
        require((lookup["input"] as? String)?.contains("PAPERBRIDGE_SELECTION_TRANSLATE_ONLY") == true, "Selection boundaries were lost")
        require(MockOllamaProtocol.requestCount() == ollamaRequests, "Online tasks called the local generation endpoint")

        let encoded = String(data: try JSONEncoder().encode(vm.settings), encoding: .utf8)!
        require(!encoded.contains("synthetic-test-key") && !encoded.contains("OptIn"), "A key or session consent leaked into settings")
        vm.persistWorkspace()
        store.flush()
        let restored = PaperReaderViewModel(workspaceStore: store, ollamaClient: client, openAIClient: cloudClient, apiKeyStore: keys)
        require(!restored.isOpenAIOptInConfirmed && restored.translatedCount == 2, "Reopen lost translations or restored cloud consent")
        vm.settings.aiProvider = .ollama
        require(!vm.isOpenAIOptInConfirmed && vm.translatedCount == 0, "Provider cache separation failed")
        vm.persistWorkspace()
        store.flush()
        let afterSwitchRestart = PaperReaderViewModel(workspaceStore: store, ollamaClient: client, openAIClient: cloudClient, apiKeyStore: keys)
        require(afterSwitchRestart.settings.aiProvider == .ollama && afterSwitchRestart.translatedCount == 0, "Restart restored the wrong active provider")
        afterSwitchRestart.settings.aiProvider = .openAI
        require(afterSwitchRestart.translatedCount == 2 && !afterSwitchRestart.isOpenAIOptInConfirmed,
                "Provider switch across restart lost archived translations or authorized cloud processing")
        vm.settings.aiProvider = .openAI
        require(vm.translatedCount == 2, "Switching back did not restore the correct cache")

        // Revocation must discard an in-flight response and prevent subsequent batches.
        vm.isOpenAIOptInConfirmed = true
        vm.settings.openAIQuickLookupModel = "slow-fixture"
        MockOpenAIIntegrationProtocol.configure(delay: 0.3)
        vm.captureTextSelection(selection)
        vm.explainTextSelection()
        try await Task.sleep(for: .milliseconds(40))
        vm.explainTextSelection()
        try await Task.sleep(for: .milliseconds(40))
        require(vm.isSelectionLookupBusy && vm.selectionTask != nil, "Cancelled lookup erased a newer same-selection task")
        vm.isOpenAIOptInConfirmed = false
        try await Task.sleep(for: .milliseconds(400))
        require(vm.selectionExplanation.isEmpty && !vm.isSelectionLookupBusy, "Revoked cloud lookup updated the UI")
        MockOpenAIIntegrationProtocol.configure(status: 429)
        vm.settings.openAITranslationModel = "quota-fixture"
        vm.isOpenAIOptInConfirmed = true
        let quotaStart = MockOpenAIIntegrationProtocol.requests().count
        vm.translatePaper()
        try await waitUntilIdle(vm)
        require(MockOpenAIIntegrationProtocol.requests().count == quotaStart + 1, "Exhausted quota triggered requests for every paragraph")
        MockOpenAIIntegrationProtocol.configure()
        vm.settings.openAITranslationModel = "partial-fixture"
        vm.translatePaper()
        try await waitUntilIdle(vm)
        require(vm.translatedCount == 1 && vm.failedCount == 1, "One incomplete paragraph prevented other paragraphs from translating")

        let rich = PaperReaderViewModel(workspaceStore: WorkspaceStore(rootURL: root.appendingPathComponent("openai-markdown")),
                                        ollamaClient: client, openAIClient: cloudClient, apiKeyStore: keys)
        let markdown = "# Results\n\nThe equation $x^2$ is unchanged.\n\n![Figure](images/synthetic.png)\n\nFigure 1: A caption.\n\n$$\ny=x+1\n$$\n\n| Group | Value |\n| --- | --- |\n| A | 12 |"
        let structured = AcademicMarkdownProcessor.assignParagraphs(in: AcademicMarkdownProcessor.parse(markdown))
        let richPaper = PaperDocument(name: "Structured Fixture", checksum: "structured-api-fixture", cleanedText: markdown,
            paragraphs: structured.paragraphs, excludedReferenceParagraphs: [], referenceSectionTitle: nil,
            sourceMarkdown: markdown, markdownSegments: structured.segments, extractionEngine: .minerU)
        rich.applyLoadedPaper(richPaper)
        rich.settings.aiProvider = .openAI
        rich.settings.openAITranslationModel = "markdown-fixture"
        rich.isOpenAIOptInConfirmed = true
        let richStart = MockOpenAIIntegrationProtocol.requests().count
        rich.generateConnectedTranslation()
        try await waitUntilIdle(rich)
        require(rich.connectedTranslation?.failedBatchCount == 0, "Structure-preserving online translation failed")
        let full = rich.connectedTranslation?.text ?? ""
        require(full.contains("images/synthetic.png") && full.contains("$x^2$") && full.contains("y=x+1") && full.contains("| A | 12 |"),
                "Online translation changed image, formula, or table structure")
        let richRequests = MockOpenAIIntegrationProtocol.requests().dropFirst(richStart)
        require(richRequests.allSatisfy { !(($0["input"] as? String ?? "").contains("images/synthetic.png")) }, "Local image path leaked instead of protected tokens")
        vm.removeOpenAIAPIKey()
        require(keys.key == nil && !vm.hasOpenAIAPIKey && !vm.isOpenAIOptInConfirmed, "Remove key did not revoke access")
        print("OpenAI integration regressions passed (consent, provider routing, cache isolation, prompts, cancellation, quota, persistence).")
    }

    @MainActor
    private static func waitForLookup(_ vm: PaperReaderViewModel) async throws {
        for _ in 0..<200 {
            if !vm.isSelectionLookupBusy { return }
            try await Task.sleep(for: .milliseconds(10))
        }
        fatalError("Selection lookup did not finish")
    }
}
