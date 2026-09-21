import AppKit
import Foundation
import PDFKit

final class MockOllamaProtocol: URLProtocol {
    static let lock = NSLock()
    static var generationCount = 0
    static var truncate = false
    static var generationDelay: TimeInterval = 0
    static var responseOverride: String?
    private var pendingResponse: DispatchWorkItem?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.lock.lock()
        let isGenerate = request.url?.path == "/api/generate"
        if isGenerate { Self.generationCount += 1 }
        let truncated = Self.truncate
        let delay = isGenerate ? Self.generationDelay : 0
        let responseText = Self.responseOverride ?? "Translated sentence."
        Self.lock.unlock()
        let payload: [String: Any] = isGenerate
            ? ["response": responseText, "done": true, "done_reason": truncated ? "length" : "stop"]
            : ["models": [["name": "translategemma:4b"]]]
        let data = try! JSONSerialization.data(withJSONObject: payload)
        let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
        let work = DispatchWorkItem { [weak self] in
            guard let self else { return }
            self.client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            self.client?.urlProtocol(self, didLoad: data)
            self.client?.urlProtocolDidFinishLoading(self)
        }
        pendingResponse = work
        DispatchQueue.global().asyncAfter(deadline: .now() + delay, execute: work)
    }
    override func stopLoading() { pendingResponse?.cancel() }

    static func setDelay(_ delay: TimeInterval) {
        lock.lock()
        defer { lock.unlock() }
        generationDelay = delay
    }

    static func requestCount() -> Int {
        lock.lock()
        defer { lock.unlock() }
        return generationCount
    }

    static func setResponse(_ response: String?) {
        lock.lock()
        defer { lock.unlock() }
        responseOverride = response
    }
}

@main
struct ReadingReliabilityRegression {
    @MainActor
    static func main() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("paperbridge-reading-tests-" + UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        if CommandLine.arguments.contains("--live-smoke") {
            try await verifyLiveOllama(root: root)
            return
        }
        let store = WorkspaceStore(rootURL: root)
        var settings = AppSettings()
        settings.translationModel = "translategemma:4b"
        let paragraphs = ["First complete sentence.", "Second pending sentence.", "Third failed sentence."]
        let paper = PaperDocument(name: "Fixture", checksum: "fixture", cleanedText: paragraphs.joined(separator: "\n\n"),
                                  paragraphs: paragraphs, excludedReferenceParagraphs: [], referenceSectionTitle: nil)
        let results = [
            ParagraphResult(id: 1, original: paragraphs[0], translation: "Keep this exact translation.", status: .ok),
            ParagraphResult(id: 2, original: paragraphs[1]),
            ParagraphResult(id: 3, original: paragraphs[2], status: .failed, errorMessage: "Temporary failure")
        ]
        let summary = SummaryResult(sourceLanguage: .english, targetLanguage: .simplifiedChinese,
                                    sourceSummary: "Saved summary.", targetSummary: "Saved target summary.")
        let connected = ConnectedTranslationResult(sourceLanguage: .english, targetLanguage: .simplifiedChinese,
                                                   text: "Saved full translation.", batchCount: 1, failedBatchCount: 0)
        let snapshot = PersistedWorkspace(settings: settings, paper: paper, paragraphResults: results,
                                          connectedTranslation: connected, summaries: summary, selectedParagraphID: 1,
                                          displayMode: .bilingual, workspaceMode: .reader, explanationLanguage: .english,
                                          explanationText: "Saved explanation.", annotations: [], bookmarkedParagraphIDs: [],
                                          isInspectorPresented: false, readingPositions: ["reader": ReadingPosition(paragraphID: 2)])
        store.saveSettings(settings)
        store.saveWorkspace(snapshot)
        store.flush()
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [MockOllamaProtocol.self]
        let client = OllamaClient(session: URLSession(configuration: config))
        try await verifyNoteAutosaveAndNavigation(root: root, client: client)
        try verifyReadingGuide()
        try await verifyReadingImprovements(root: root, client: client)
        let sampleStore = WorkspaceStore(rootURL: root.appendingPathComponent("first-use"))
        let firstUse = PaperReaderViewModel(workspaceStore: sampleStore, ollamaClient: client)
        let requestCount = MockOllamaProtocol.requestCount()
        firstUse.loadSamplePaper()
        require(firstUse.workspaceMode == .summary && firstUse.readingGuide.count == 5, "Sample did not open a complete source reading map")
        require(MockOllamaProtocol.requestCount() == requestCount, "Practice paper unexpectedly called a model")
        require(firstUse.primarySetupMessage != nil, "Missing AI setup has no explanation")
        firstUse.displayMode = .translationOnly
        let method = firstUse.readingGuide.first { $0.id == "method" }!
        firstUse.openReadingPassage(method)
        require(firstUse.workspaceMode == .reader && firstUse.displayMode == .bilingual && firstUse.navigationRequest?.paragraphID == method.paragraphID,
                "Reading map did not reveal its source passage")
        firstUse.loadSamplePaper()
        require(firstUse.workspaceMode == .reader, "Practice action replaced an already open workspace")
        firstUse.persistWorkspace()
        sampleStore.flush()
        let sampleReopened = PaperReaderViewModel(workspaceStore: sampleStore, ollamaClient: client)
        require(sampleReopened.workspaceMode == .reader && sampleReopened.readingGuide.count == 5, "Reopen reset the chosen workspace or lost the reading map")
        let model = PaperReaderViewModel(workspaceStore: store, ollamaClient: client)
        require(model.summaries == summary && model.connectedTranslation == connected, "Saved outputs did not restore")
        require(model.readingPositions["reader"]?.paragraphID == 2, "Reading position did not restore")
        model.settings.quickLookupModel = "different-lookup"
        require(model.summaries == summary && model.connectedTranslation == connected, "Lookup model erased saved outputs")
        require(model.explanationText == "Saved explanation.", "Saved explanation cache was not seeded")
        model.settings.minerUExecutablePath = "/different/parser"
        require(model.summaries == summary, "Parser setting erased the summary")
        model.translatePaper()
        try await waitUntilIdle(model)
        require(model.translatedCount == 3, "Resume did not finish pending and failed paragraphs")
        require(MockOllamaProtocol.requestCount() - requestCount == 2, "Resume translated successful blocks again")
        require(model.paragraphResults[0].translation == results[0].translation, "Completed translation changed")
        model.translatePaper()
        try await waitUntilIdle(model)
        require(MockOllamaProtocol.requestCount() - requestCount == 2, "Completed document should use cache")

        model.persistWorkspace()
        store.flush()
        let reopened = PaperReaderViewModel(workspaceStore: store, ollamaClient: client)
        require(reopened.translatedCount == 3 && reopened.summaries == summary, "Second launch lost progress or summaries")
        reopened.settings.summaryModel = "different-summary"
        require(reopened.summaries == nil && reopened.connectedTranslation == connected && reopened.translatedCount == 3,
                "Summary model should invalidate only its own output")

        let cancellationStore = WorkspaceStore(rootURL: root.appendingPathComponent("cancellation"))
        cancellationStore.saveSettings(settings)
        cancellationStore.saveWorkspace(snapshot)
        cancellationStore.flush()
        let cancelled = PaperReaderViewModel(workspaceStore: cancellationStore, ollamaClient: client)
        let requestsBeforeCancel = MockOllamaProtocol.requestCount()
        MockOllamaProtocol.setDelay(0.3)
        cancelled.retryTranslation(for: 3)
        for _ in 0..<500 {
            if MockOllamaProtocol.requestCount() > requestsBeforeCancel { break }
            try await Task.sleep(for: .milliseconds(10))
        }
        require(MockOllamaProtocol.requestCount() > requestsBeforeCancel, "Delayed request never started")
        cancelled.cancelCurrentTask()
        MockOllamaProtocol.setDelay(0)
        cancelled.retryTranslation(for: 2)
        try await waitUntilIdle(cancelled)
        try await Task.sleep(for: .milliseconds(350))
        require(cancelled.paragraphResults[1].status == .ok, "Cancelled task interrupted its replacement")
        require(cancelled.paragraphResults[2] == results[2], "Cancelled request overwrote the original failed paragraph")
        require(cancelled.statusMessage == "Paragraph 2 translated successfully.", "Stale task overwrote the replacement status")
        cancellationStore.flush()

        let selection = ReaderTextSelection(paragraphID: 1, side: .original, text: "First", context: paragraphs[0],
                                             rangeLocation: 0, rangeLength: 5)
        reopened.captureTextSelection(selection)
        reopened.applyHighlight(.amber)
        reopened.saveSelectionNote("Important evidence.")
        reopened.removeSelectionHighlight()
        require(reopened.annotations.count == 1 && reopened.annotations[0].highlightColor == nil,
                "Removing a highlight deleted its annotation")
        require(reopened.annotations[0].note == "Important evidence.", "Removing highlight erased the note")
        reopened.undoAnnotationChange()
        require(reopened.annotations[0].highlightColor == .amber, "Highlight removal could not be undone")
        reopened.removeAnnotation(id: reopened.annotations[0].id)
        require(reopened.annotations.isEmpty, "Delete Annotation did not delete")
        reopened.undoAnnotationChange()
        require(reopened.annotations.first?.note == "Important evidence.", "Delete undo did not recover note")
        reopened.workspaceMode = .summary
        reopened.displayMode = .translationOnly
        reopened.activateAnnotation(reopened.annotations[0])
        require(reopened.workspaceMode == .reader && reopened.displayMode == .bilingual,
                "Reader annotation did not reopen the visible source paragraph")

        let stale = PaperAnnotation(paragraphID: 1, side: .original, quote: "gene", rangeLocation: 99, rangeLength: 4)
        require(stale.resolvedRange(in: "gene and gene") == nil, "Ambiguous quote silently recovered to first occurrence")
        require(stale.resolvedRange(in: "one gene")?.location == 4, "Unique legacy quote could not recover")
        reopened.activateAnnotation(stale)
        require(reopened.selectionLookupError != nil, "Unresolvable Reader annotation failed silently")
        try verifyPDFAnchors()
        let web = PaperAnnotation(paragraphID: 0, side: .original, quote: "First", rangeLocation: 0, rangeLength: 5,
                                  scope: .paper, context: paragraphs[0], locator: "web:0")
        reopened.activateAnnotation(web)
        require(reopened.displayMode == .bilingual && reopened.annotationNavigationRequest?.annotation == web,
                "Web annotation opened source PDF or failed to request navigation")

        MockOllamaProtocol.truncate = true
        do {
            _ = try await client.generate(baseURL: settings.ollamaBaseURL, model: settings.translationModel,
                                          prompt: "Test", systemPrompt: nil)
            fatalError("Truncated response was accepted as successful")
        } catch OllamaClientError.incompleteResponse {}
        MockOllamaProtocol.truncate = false

        // Backwards compatibility: new optional fields must not prevent loading v1.8 workspaces.
        let oldData = try JSONEncoder().encode(snapshot)
        var oldJSON = try JSONSerialization.jsonObject(with: oldData) as! [String: Any]
        oldJSON.removeValue(forKey: "readingPositions")
        let old = try JSONDecoder().decode(PersistedWorkspace.self, from: JSONSerialization.data(withJSONObject: oldJSON))
        require(old.readingPositions == nil, "Legacy workspace decoding failed")
        let blocker = root.appendingPathComponent("not-a-directory")
        try Data("blocker".utf8).write(to: blocker)
        let badStore = WorkspaceStore(rootURL: blocker)
        var saveFailure: String?
        badStore.onSaveStatus = { saveFailure = $0 }
        badStore.saveWorkspace(snapshot)
        badStore.flush()
        require(saveFailure != nil, "Save failure was silently ignored")
        store.flush()
        if CommandLine.arguments.count == 3, CommandLine.arguments[1] == "--write-guide-fixture" {
            let output = WorkspaceStore(rootURL: URL(fileURLWithPath: CommandLine.arguments[2]))
            let guideModel = PaperReaderViewModel(workspaceStore: output, ollamaClient: client)
            guard guideModel.loadedPaper == nil else { fatalError("Guide fixture requires an empty workspace directory") }
            guideModel.loadSamplePaper()
            output.flush()
        }
        if CommandLine.arguments.count == 3, CommandLine.arguments[1] == "--write-fixture" {
            let output = WorkspaceStore(rootURL: URL(fileURLWithPath: CommandLine.arguments[2]))
            let markdown = (1...30).map { index in
                "## Section \(index)\n\nThis is sample paragraph \(index). It includes the word gene twice: gene. Select either occurrence to check highlighting and notes. This is demonstration text, not a scientific claim."
            }.joined(separator: "\n\n")
            let structured = AcademicMarkdownProcessor.assignParagraphs(in: AcademicMarkdownProcessor.parse(markdown))
            let demo = PaperDocument(name: "Reading checks (demo)", checksum: "demo", cleanedText: markdown,
                                     paragraphs: structured.paragraphs, excludedReferenceParagraphs: [], referenceSectionTitle: nil,
                                     sourceMarkdown: markdown, markdownSegments: structured.segments, extractionEngine: .minerU)
            let demoResults = structured.paragraphs.enumerated().map { index, text in
                ParagraphResult(id: index + 1, original: text,
                                sourceMarkdown: structured.segments.first(where: { $0.paragraphID == index + 1 })?.source,
                                translation: "示例译文 \(index + 1)：用于检查阅读位置、高亮和笔记。这不是模型生成的真实论文翻译。",
                                status: .ok)
            }
            output.saveSettings(settings)
            output.saveWorkspace(PersistedWorkspace(settings: settings, paper: demo, paragraphResults: demoResults,
                connectedTranslation: nil, summaries: summary, selectedParagraphID: 2, displayMode: .bilingual,
                workspaceMode: .preview, explanationLanguage: .english, explanationText: "", annotations: [],
                bookmarkedParagraphIDs: [2, 20, 40], isInspectorPresented: true))
            output.flush()
        }
        print("Reading reliability regression tests passed (resume, cancellation, caches, notes, anchors, positions, response integrity, legacy data, save errors).")
    }

    @MainActor
    static func waitUntilIdle(_ model: PaperReaderViewModel) async throws {
        for _ in 0..<500 {
            if !model.isBusy { return }
            try await Task.sleep(for: .milliseconds(10))
        }
        fatalError("Task did not finish")
    }

    @MainActor
    static func verifyNoteAutosaveAndNavigation(root: URL, client: OllamaClient) async throws {
        let store = WorkspaceStore(rootURL: root.appendingPathComponent("note-autosave"))
        let model = PaperReaderViewModel(workspaceStore: store, ollamaClient: client)
        let text = ["Abstract", "First evidence and second evidence.", "2 Methods", "Methods retain the original source."]
        let paper = PaperDocument(name: "Notes", checksum: "notes", cleanedText: text.joined(separator: "\n\n"),
                                  paragraphs: text, excludedReferenceParagraphs: [], referenceSectionTitle: nil)
        model.applyLoadedPaper(paper)
        let first = ReaderTextSelection(paragraphID: 2, side: .original, text: "First evidence", context: text[1],
                                        rangeLocation: 0, rangeLength: 14)
        let secondRange = (text[1] as NSString).range(of: "second evidence")
        let second = ReaderTextSelection(paragraphID: 2, side: .original, text: "second evidence", context: text[1],
                                         rangeLocation: secondRange.location, rangeLength: secondRange.length)
        model.captureTextSelection(first)
        model.updateSelectionNote("Draft line one\n", for: first, paperChecksum: paper.checksum)
        model.updateSelectionNote("Draft line one\nLine two  ", for: first, paperChecksum: paper.checksum)
        require(model.isNoteSavePending, "Typing did not mark a pending save")
        require(model.annotationUndoStack.count == 1, "Typing made an undo snapshot per keystroke")
        model.captureTextSelection(second)
        require(!model.isNoteSavePending, "Changing selection did not flush the previous note")
        require(model.noteText(for: first) == "Draft line one\nLine two  ", "Selection switch lost note whitespace or content")
        model.updateSelectionNote("Late stale editor callback", for: first, paperChecksum: paper.checksum)
        require(model.noteText(for: second).isEmpty, "Late editor callback attached a note to a different selection")
        model.updateSelectionNote("Another passage", for: second, paperChecksum: paper.checksum)
        model.isInspectorPresented = true
        model.isInspectorPresented = false
        model.finishNoteEditing()
        model.flushPendingSaves()
        let reopened = PaperReaderViewModel(workspaceStore: store, ollamaClient: client)
        require(reopened.noteText(for: first) == "Draft line one\nLine two  " && reopened.noteText(for: second) == "Another passage",
                "Notes did not survive hiding the editor and reopening")

        model.captureTextSelection(first)
        model.updateSelectionNote("Revised", for: first, paperChecksum: paper.checksum)
        model.updateSelectionNote("Revised again", for: first, paperChecksum: paper.checksum)
        model.undoAnnotationChange()
        require(model.noteText(for: first) == "Draft line one\nLine two  ", "Undo did not restore the note before its edit session")
        try await Task.sleep(for: .milliseconds(450))
        model.flushPendingSaves()
        require(store.loadLastWorkspace()?.annotations.first(where: { $0.quote == first.text })?.note == "Draft line one\nLine two  ",
                "A delayed autosave overwrote undo")

        model.updateSelectionNote("Debounced save", for: first, paperChecksum: paper.checksum)
        try await Task.sleep(for: .milliseconds(450))
        store.flush()
        require(store.loadLastWorkspace()?.annotations.first(where: { $0.quote == first.text })?.note == "Debounced save",
                "Typing without Save Now did not reach disk")
        model.updateSelectionNote("Immediately before switching papers", for: first, paperChecksum: paper.checksum)
        let other = PaperDocument(name: "Other", checksum: "other-notes", cleanedText: paper.cleanedText,
                                  paragraphs: text, excludedReferenceParagraphs: [], referenceSectionTitle: nil)
        model.applyLoadedPaper(other)
        model.captureTextSelection(first)
        model.updateSelectionNote("Wrong paper callback", for: first, paperChecksum: paper.checksum)
        require(model.annotations.isEmpty, "Old editor wrote a note into the next paper")
        model.applyLoadedPaper(paper)
        require(model.noteText(for: first) == "Immediately before switching papers", "Paper switch lost the last typed note")
        model.captureTextSelection(first)
        model.applyHighlight(.amber)
        model.updateSelectionNote("", for: first, paperChecksum: paper.checksum)
        model.flushPendingSaves()
        require(model.activeSelectionAnnotation?.highlightColor == .amber && model.noteText(for: first).isEmpty,
                "Clearing a note removed its highlight")

        model.clearTextSelection()
        model.workspaceMode = .summary
        model.displayMode = .translationOnly
        model.readingPositions["summary.source"] = ReadingPosition(y: 280, blockIndex: 3)
        model.navigateToParagraph(2, revealSource: true)
        require(model.workspaceMode == .reader && model.displayMode == .bilingual && model.canGoBackInReading,
                "Source jump did not record its origin")
        let countBeforeRepeat = model.readingBackHistory.count
        model.navigateToParagraph(2)
        require(model.readingBackHistory.count == countBeforeRepeat, "Repeated jump created an empty back-navigation step")
        model.updateReadingPosition(ReadingPosition(paragraphID: 2, readerItemID: "paragraph-2"), key: "reader", paperChecksum: paper.checksum)
        model.navigateToParagraph(4)
        model.goBackInReading()
        require(model.workspaceMode == .reader && model.readingPositions["reader"]?.readerItemID == "paragraph-2",
                "Back did not restore the prior paragraph")
        model.goBackInReading()
        require(model.workspaceMode == .summary && model.displayMode == .translationOnly &&
                model.readingPositions["summary.source"]?.y == 280, "Back did not restore source workspace and viewport")
        model.goForwardInReading()
        require(model.workspaceMode == .reader && model.readingPositions["reader"]?.paragraphID == 2,
                "Forward did not restore the destination")
        model.paragraphSearchText = "evidence"
        model.readingPositions["reader"] = ReadingPosition(readerItemID: "resource-figure")
        model.navigateToParagraph(4)
        require(!model.canGoForwardInReading, "A new jump retained a stale forward branch")
        model.goBackInReading()
        require(model.paragraphSearchText == "evidence" && model.readingPositions["reader"]?.readerItemID == "resource-figure",
                "Back lost the search or a non-paragraph resource position")
        let historyCount = model.readingBackHistory.count
        model.navigateToParagraph(999)
        require(model.readingBackHistory.count == historyCount, "Invalid jump changed history")
        for index in 0..<60 { model.navigateToParagraph(index.isMultiple(of: 2) ? 2 : 4) }
        require(model.readingBackHistory.count <= 50, "Reading history is unbounded")
        model.mergeParagraphWithNext(1)
        require(!model.canGoBackInReading && !model.canGoForwardInReading, "Paragraph repair retained stale navigation anchors")
        model.navigateToParagraph(2)
        model.applyLoadedPaper(other)
        require(!model.canGoBackInReading && !model.canGoForwardInReading, "Paper switch retained another paper's history")

        require(TextProcessing.standaloneSectionTitle(in: "Abstract") == "Abstract", "Standalone abstract was not compacted")
        require(TextProcessing.standaloneSectionTitle(in: "2 Methods") == "2 Methods", "Standalone numbered heading was not compacted")
        require(TextProcessing.standaloneSectionTitle(in: "Abstract. We tested a new approach.") == nil,
                "Inline abstract body was mistaken for a standalone heading")
        require(TextProcessing.standaloneSectionTitle(in: "2 Methods\nWe retained all evidence.") == nil,
                "Heading plus body was mistaken for a standalone heading")
        require(TextProcessing.standaloneSectionTitle(in: "Section 24", sourceMarkdown: "## Section 24") == "Section 24",
                "MinerU heading semantics were ignored for a custom section title")
        require(TextProcessing.standaloneSectionTitle(in: "Study design", sourceMarkdown: "## Study design\n\nEvidence remains.") == nil,
                "A structured heading and body were compacted together")

        model.applyLoadedPaper(paper)
        for scope in [TextSelectionScope.paper, .summarySource, .summaryTarget, .fullTranslation] {
            let selection = ReaderTextSelection(scope: scope, paragraphID: 0, side: .original, text: "Evidence",
                context: "Evidence stays local.", rangeLocation: 0, rangeLength: 8, locator: "block-\(scope.rawValue)")
            model.captureTextSelection(selection)
            model.updateSelectionNote("A note in \(scope.rawValue)", for: selection, paperChecksum: model.loadedPaper?.checksum)
            model.clearTextSelection()
            model.flushPendingSaves()
            require(store.loadLastWorkspace()?.annotations.contains(where: { $0.resolvedScope == scope && $0.note == "A note in \(scope.rawValue)" }) == true,
                    "Autosave lost a note outside Reader")
        }

        let blockedRoot = root.appendingPathComponent("note-save-blocked")
        try Data("not a directory".utf8).write(to: blockedRoot)
        let failedStore = WorkspaceStore(rootURL: blockedRoot)
        let failed = PaperReaderViewModel(workspaceStore: failedStore, ollamaClient: client)
        failed.applyLoadedPaper(paper)
        failed.captureTextSelection(first)
        failed.updateSelectionNote("Keep this if saving fails", for: first, paperChecksum: paper.checksum)
        failed.flushPendingSaves()
        for _ in 0..<100 where failed.isWorkspaceSaving { try await Task.sleep(for: .milliseconds(10)) }
        require(failed.workspaceSaveError != nil && failed.noteText(for: first) == "Keep this if saving fails",
                "Save failure erased the note or falsely reported success")
        try FileManager.default.removeItem(at: blockedRoot)
        failed.flushPendingSaves()
        for _ in 0..<100 where failed.isWorkspaceSaving { try await Task.sleep(for: .milliseconds(10)) }
        require(failed.workspaceSaveError == nil && failedStore.loadLastWorkspace()?.annotations.first?.note == "Keep this if saving fails",
                "Retry save did not recover the in-memory note")
        print("Note autosave, save recovery, compact headings, and reading navigation regressions passed.")
    }

    static func verifyReadingGuide() throws {
        func paper(_ paragraphs: [String]) -> PaperDocument {
            PaperDocument(name: "Guide fixture", checksum: "guide", cleanedText: paragraphs.joined(separator: "\n\n"),
                paragraphs: paragraphs, excludedReferenceParagraphs: [], referenceSectionTitle: nil)
        }
        let source = paper(ReadingGuideBuilder.sampleParagraphs)
        let guide = ReadingGuideBuilder.build(for: source)
        require(guide.count == 5, "Expected research question, approach, evidence, limits, and conclusion")
        require(guide.allSatisfy { source.paragraphs[$0.paragraphID - 1] == $0.excerpt }, "Reading map invented or modified a source quote")
        let missingMethod = ReadingGuideBuilder.build(for: paper(["1 Methods", "2 Results", "These results describe a distinct section and must never be treated as a methods passage."]))
        require(!missingMethod.contains { $0.id == "method" }, "Empty methods section borrowed content from Results")
        let unstructured = ReadingGuideBuilder.build(for: paper(["This plain abstract has no trustworthy section headings. It should be offered as an opening passage, not invented as a method."]))
        require(unstructured.count == 1 && unstructured[0].id == "beginning", "Unstructured text was assigned fabricated section roles")
        require(ReadingGuideBuilder.build(for: paper([])).isEmpty, "Scanned image-only input produced a reading map")
    }

    @MainActor
    static func verifyReadingImprovements(root: URL, client: OllamaClient) async throws {
        let texts = ["Abstract", "This abstract describes a deliberately fictional reading test with no scientific claims.",
                     "1 Methods", "This method paragraph explains the test design with sufficiently detailed source wording.",
                     "2 Results", "For the measurement, we out-", "123 (4)",
                     "3 Conclusion", "This conclusion belongs to the tutorial fixture and can be checked against the original."]
        let paper = PaperDocument(name: "Reading features", checksum: "reading-features", cleanedText: texts.joined(separator: "\n\n"),
            paragraphs: texts, excludedReferenceParagraphs: [], referenceSectionTitle: nil)
        let sections = PaperReadingAnalysis.sections(in: paper)
        require(sections.count == 4, "Section detector merged separate document sections")
        let priority = PaperReadingAnalysis.overviewParagraphIDs(in: sections)
        require(priority == [1, 2, 8, 9], "Quick reading scope includes methods or misses conclusion")
        let issues = PaperReadingAnalysis.qualityIssues(in: paper)
        require(issues.map(\.paragraphID) == [6, 7], "Quality checks missed dangling words/numbers or flagged complete prose/headings")
        let json = """
        {"claims":[{"text":"A cited method.","sources":[{"paragraphID":4,"quote":"This method paragraph explains the test design"}]},
        {"text":"An invented source.","sources":[{"paragraphID":999,"quote":"Invented evidence should never receive a source link."}]},
        {"text":"A wrong quotation.","sources":[{"paragraphID":4,"quote":"The results prove every scientific claim is true."}]}]}
        """
        let claims = SummaryEvidence.parse(json, paper: paper)
        require(claims.count == 3 && claims[0].sources.count == 1 && claims[1].sources.isEmpty && claims[2].sources.isEmpty,
                "Summary citation validator accepted fabricated evidence")
        require(SummaryEvidence.parse(json, paper: paper, allowedSources: []).allSatisfy { $0.sources.isEmpty }, "Merge invented evidence not provided by partial summaries")
        require(SummaryEvidence.parse("Model did not return JSON.", paper: paper).first?.sources.isEmpty == true, "Malformed summary output fabricated citations")
        let batches = SummaryEvidence.sourceBatches(texts, maxChars: 300)
        require(batches.joined().contains("[P9]"), "Summary batching renumbered source paragraphs")

        let store = WorkspaceStore(rootURL: root.appendingPathComponent("reading-improvements"))
        let model = PaperReaderViewModel(workspaceStore: store, ollamaClient: client)
        model.applyLoadedPaper(paper)
        let before = MockOllamaProtocol.requestCount()
        model.translatePaper(paragraphIDs: [2, 9, 999])
        try await waitUntilIdle(model)
        require(MockOllamaProtocol.requestCount() - before == 2, "Section translation generated outside the requested range")
        require(model.paragraphResults.filter { $0.status == .ok }.map(\.id) == [2, 9], "Section translation altered unrelated blocks")
        model.translatePaper(paragraphIDs: [2, 9])
        try await waitUntilIdle(model)
        require(MockOllamaProtocol.requestCount() - before == 2, "Section resume translated completed work twice")
        let previous = model.paragraphResults
        model.settings.readingAppearance.fontSize = 22
        require(model.paragraphResults == previous, "Appearance invalidated existing translations")
        let clamped = ReadingAppearance(fontSize: .infinity, lineSpacing: -50, contentWidth: 100000).clamped
        require(clamped.fontSize == 16 && clamped.lineSpacing == 2 && clamped.contentWidth == 1200, "Invalid reading preferences were not clamped")
        model.captureTextSelection(ReaderTextSelection(paragraphID: 4, side: .original, text: "method",
            context: texts[3], rangeLocation: 5, rangeLength: 6))
        require(model.isQuickLookupPresented && !model.isInspectorPresented, "Selection unexpectedly resized the reader")
        require(model.saveSelectedTerm(translation: "方法"), "Could not save selected terminology")
        require(model.terminologyPrompt(for: texts[3], from: .english, to: .simplifiedChinese).contains("方法"), "Saved term missing from matching translation prompt")
        require(model.terminologyPrompt(for: texts[3], from: .simplifiedChinese, to: .english).isEmpty, "Wrong language-direction terms leaked into prompt")
        model.bookmarkedParagraphIDs = [4]
        model.updateReadingPosition(ReadingPosition(paragraphID: 4), key: "reader", paperChecksum: paper.checksum)
        model.persistWorkspace()
        store.flush()
        model.showLibrary()
        let entry = model.libraryEntries.first { $0.id == paper.checksum }!
        model.updateLibraryMetadata(entry, title: "My methods paper", tags: "methods, reading, methods")
        let other = PaperDocument(name: "Second paper", checksum: "second-paper", cleanedText: "Another document.",
            paragraphs: ["Another document."], excludedReferenceParagraphs: [], referenceSectionTitle: nil)
        model.applyLoadedPaper(other)
        model.showLibrary()
        require(model.libraryEntries.count == 2, "Library lost a previously saved document")
        model.openLibraryPaper(entry)
        require(model.loadedPaper?.checksum == paper.checksum && model.bookmarkedParagraphIDs == [4] && model.translatedCount == 2,
                "Library failed to restore independent paper progress")
        require(model.readingPositions["reader"]?.paragraphID == 4 && store.loadGlossary().count == 1, "Library lost the reading position or glossary")
        require(store.loadLibrary().first { $0.id == entry.id }?.tags == ["methods", "reading"], "Library metadata was overwritten by progress saves")
        let reopened = PaperReaderViewModel(workspaceStore: store, ollamaClient: client)
        require(reopened.libraryEntries.count == 2 && reopened.glossary.count == 1, "Library or terms did not survive restart")

        MockOllamaProtocol.setDelay(0.15)
        model.translatePaper()
        try await Task.sleep(for: .milliseconds(40))
        model.prioritizeSection(sections[1])
        require(model.translationQueue.first == 3, "Current section was not moved ahead in the active queue")
        model.cancelCurrentTask()
        try await Task.sleep(for: .milliseconds(30))
        MockOllamaProtocol.setDelay(0)
        require(model.paragraphResults.filter { $0.status == .ok }.count >= 2, "Cancelling a reprioritized queue discarded saved translations")
        model.beginEditingParagraph(4)
        model.paragraphEditorText = texts[3] + " This sentence was added in the test."
        model.saveParagraphEdit()
        store.flush()
        require(store.loadLibrary().count == 2, "Editing a paragraph created duplicate library papers")
        require(model.paragraphEditorText.isEmpty, "Paragraph editor did not clear its transient buffer")
        model.openLibraryPaper(entry)
        require(model.loadedPaper?.paragraphs[3].hasSuffix("This sentence was added in the test.") == true,
                "Library opened a stale version after a paragraph edit")
        model.applyLoadedPaper(paper)
        require(model.loadedPaper?.paragraphs[3].hasSuffix("This sentence was added in the test.") == true,
                "Reimporting the original silently replaced the saved revision")
        require(model.translatedCount >= 2 && model.bookmarkedParagraphIDs == [4],
                "Reimport lost preserved translations or bookmarks")
        try verifyParagraphMutationSafety(root: root, client: client)

        let summaryStore = WorkspaceStore(rootURL: root.appendingPathComponent("cited-summary"))
        let summaryModel = PaperReaderViewModel(workspaceStore: summaryStore, ollamaClient: client)
        summaryModel.applyLoadedPaper(paper)
        summaryModel.settings.targetLanguage = .english
        MockOllamaProtocol.setResponse(json)
        defer { MockOllamaProtocol.setResponse(nil) }
        summaryModel.generateSummaries()
        try await waitUntilIdle(summaryModel)
        require(summaryModel.summaries?.claims?.count == 3 && summaryModel.summaries?.claims?.first?.sources.count == 1,
                "Summary generation did not persist validated claim sources")
        require(summaryModel.summaries?.sourceSummary == summaryModel.summaries?.targetSummary,
                "Same-language summaries did not reuse the numbered claims")
        summaryModel.prepareMarkdownExport()
        require(summaryModel.exportDocument.text.contains("Summary source passages") && summaryModel.exportDocument.text.contains("No source link validated"),
                "Analysis export lost summary evidence or unlinked-claim warnings")
        let emptySummaryModel = PaperReaderViewModel(workspaceStore: WorkspaceStore(rootURL: root.appendingPathComponent("empty-summary")), ollamaClient: client)
        emptySummaryModel.applyLoadedPaper(paper)
        MockOllamaProtocol.setResponse("{\"claims\":[]}")
        emptySummaryModel.generateSummaries()
        try await waitUntilIdle(emptySummaryModel)
        require(emptySummaryModel.summaries == nil && emptySummaryModel.errorMessage?.contains("no usable claims") == true,
                "Empty structured summaries were incorrectly reported as successful")
    }

    @MainActor
    static func verifyLiveOllama(root: URL) async throws {
        let client = OllamaClient()
        let models = try await client.listModels(baseURL: "http://127.0.0.1:11434")
        require(models.contains("translategemma:4b") && models.contains("gemma4:e4b"),
                "Live smoke test needs existing translategemma:4b and gemma4:e4b; no models are downloaded")
        let model = PaperReaderViewModel(workspaceStore: WorkspaceStore(rootURL: root), ollamaClient: client)
        let texts = ["In this fictional pilot, we measured BRCA1 expression in ten samples. The mean concentration was 5 mg/L. This is a tutorial example, not an actual study.",
                     "The small sample size limits generalization. The example does not establish a causal relationship or a clinical benefit."]
        model.settings.translationModel = "translategemma:4b"
        model.settings.summaryModel = "gemma4:e4b"
        model.settings.explainModel = "gemma4:e4b"
        model.applyLoadedPaper(PaperDocument(name: "Live local smoke (fictional)", checksum: "live-fictional-smoke",
            cleanedText: texts.joined(separator: "\n\n"), paragraphs: texts,
            excludedReferenceParagraphs: [], referenceSectionTitle: nil))
        func waitForLiveTask() async throws {
            for _ in 0..<1200 {
                if !model.isBusy { return }
                try await Task.sleep(for: .milliseconds(500))
            }
            model.cancelCurrentTask()
            throw NSError(domain: "LiveSmoke", code: 1, userInfo: [NSLocalizedDescriptionKey: "Local model timed out"])
        }
        model.translatePaper()
        try await waitForLiveTask()
        require(model.translatedCount == 2, "Live paragraph translation failed: \(model.errorMessage ?? model.statusMessage)")
        require(model.paragraphResults[0].translation.contains("BRCA1"), "Live translation lost the gene symbol")
        print("Live translation: \(model.paragraphResults[0].translation)")
        model.generateSummaries()
        try await waitForLiveTask()
        require(model.summaries?.sourceSummary.isEmpty == false && model.summaries?.targetSummary.isEmpty == false,
                "Live bilingual summary failed: \(model.errorMessage ?? model.statusMessage)")
        print("Live summary: \(model.summaries!.sourceSummary)")
        print("Validated summary sources: \(model.summaries!.claims?.flatMap(\.sources).count ?? 0)")
        model.selectedParagraphID = 1
        model.explainSelectedParagraph()
        try await waitForLiveTask()
        require(!model.explanationText.isEmpty, "Live explanation failed")
        model.prepareMarkdownExport()
        require(model.exportDocument.text.contains("BRCA1") && model.exportDocument.text.contains("Summary source passages"),
                "Live export omitted source text or source notes")
        print("Live local Ollama smoke passed: translation, bilingual summary, explanation, Markdown export.")
    }

    @MainActor
    static func verifyParagraphMutationSafety(root: URL, client: OllamaClient) throws {
        let directory = root.appendingPathComponent("mutation-safety")
        let store = WorkspaceStore(rootURL: directory)
        let model = PaperReaderViewModel(workspaceStore: store, ollamaClient: client)
        let source = ["Opening sentence. Next sentence.", "Duplicate paragraph.", "Duplicate paragraph.",
                      "A 🧬 gene and another gene.", "Last paragraph."]
        let paper = PaperDocument(name: "Edits", checksum: "original-edit-source", cleanedText: source.joined(separator: "\n\n"),
            paragraphs: source, excludedReferenceParagraphs: [], referenceSectionTitle: nil)
        model.applyLoadedPaper(paper)
        model.paragraphResults[1].translation = "First duplicate translation."
        model.paragraphResults[1].status = .ok
        model.paragraphResults[2].translation = "Second duplicate translation."
        model.paragraphResults[2].status = .ok
        let quoteRange = (source[3] as NSString).range(of: "gene", options: .backwards)
        let note = PaperAnnotation(paragraphID: 4, side: .original, quote: "gene", rangeLocation: quoteRange.location,
            rangeLength: quoteRange.length, context: source[3], highlightColor: .amber, note: "Second occurrence.")
        let translatedNote = PaperAnnotation(paragraphID: 2, side: .translation, quote: "First", rangeLocation: 0,
            rangeLength: 5, context: "First duplicate translation.", note: "Translated side.")
        let pdfNote = PaperAnnotation(paragraphID: 4, side: .original, quote: "gene", rangeLocation: quoteRange.location,
            rangeLength: 4, scope: .paper, locator: "pdf-page-0", note: "Original page.")
        model.annotations = [note, translatedNote, pdfNote]
        model.bookmarkedParagraphIDs = [1, 4, 5]
        model.beginEditingParagraph(1)
        model.paragraphEditorText = "Opening sentence.\n\nNext sentence."
        model.saveParagraphEdit()
        require(model.bookmarkedParagraphIDs == [1, 2, 5, 6], "Split did not move bookmarks with their content")
        require(model.annotations[0].paragraphID == 5 && model.annotations[0].rangeLocation == quoteRange.location,
                "Split moved a Unicode repeated-word highlight to the wrong occurrence")
        require(model.paragraphResults[2].translation == "First duplicate translation." &&
                model.paragraphResults[3].translation == "Second duplicate translation.", "Duplicate text stole another paragraph's translation")
        require(model.annotations[1].paragraphID == 3 && model.annotations[1].needsReview != true,
                "Unchanged translated annotation did not follow its paragraph")
        require(model.annotations[2] == pdfNote, "Reader edit modified original PDF anchors")
        model.mergeParagraphWithNext(4)
        let merged = model.paragraphResults[3].original
        require(model.annotations[0].paragraphID == 4 && model.annotations[0].resolvedRange(in: merged) ==
                (merged as NSString).range(of: "gene", options: .backwards), "Merge lost exact source occurrence")
        model.undoParagraphEdit()
        require(model.annotations[0].paragraphID == 5 && model.annotations[0].rangeLocation == quoteRange.location,
                "Undo did not restore the original annotation anchor")
        model.beginEditingParagraph(5)
        model.paragraphEditorText = "The previously quoted term is no longer present."
        model.saveParagraphEdit()
        require(model.annotations[0].needsReview == true && model.annotations[0].note == note.note,
                "Deleted quote must retain its note without attaching to unrelated content")
        require(model.annotations(for: 5, side: .original).isEmpty, "Unresolved note was rendered as a highlight")
        model.prepareMarkdownExport()
        require(model.exportDocument.text.contains("Source changed: this note was preserved") &&
                model.exportDocument.text.contains("Original page.") && model.exportDocument.text.contains("Second occurrence."),
                "Export dropped non-Reader notes or mislabeled an unresolved quote")
        model.undoParagraphEdit()
        require(model.annotations[0].needsReview != true, "Undo did not recover a preserved unresolved note")
        model.mergeParagraphWithNext(3)
        require(model.annotations[1].needsReview == true, "Changed translated text retained a stale highlight")
        model.undoParagraphEdit()
        model.persistWorkspace()
        store.flush()
        let restart = PaperReaderViewModel(workspaceStore: store, ollamaClient: client)
        restart.applyLoadedPaper(paper)
        require(restart.loadedPaper?.paragraphs.count == 6 && restart.annotations[0].paragraphID == 5,
                "Restart and reimport lost the edited document or moved its notes")
        let savedURL = directory.appendingPathComponent("Workspaces/original-edit-source.json")
        require(FileManager.default.fileExists(atPath: savedURL.appendingPathExtension("backup").path),
                "Workspace backup was not created")
        try Data("broken JSON".utf8).write(to: savedURL, options: .atomic)
        require(store.loadWorkspace(checksum: paper.checksum) != nil, "Readable backup was not recovered after primary corruption")
        let assets = directory.appendingPathComponent("assets", isDirectory: true)
        try FileManager.default.createDirectory(at: assets, withIntermediateDirectories: true)
        let outside = directory.appendingPathComponent("outside.txt")
        try Data("This must not be exported".utf8).write(to: outside)
        try FileManager.default.createSymbolicLink(at: assets.appendingPathComponent("escape.png"), withDestinationURL: outside)
        let exported = try MarkdownBundleExporter().export(paperName: "Safety", documents: ["paper.md": "![Figure](escape.png)"],
            assetSourceDirectory: assets, to: directory)
        require(exported.copiedAssetCount == 0 && exported.missingAssetPaths == ["escape.png"],
                "Markdown export followed an asset symlink outside the document folder")
    }

    @MainActor
    static func verifyPDFAnchors() throws {
        let data = NSMutableData()
        var bounds = CGRect(x: 0, y: 0, width: 400, height: 240)
        let consumer = CGDataConsumer(data: data)!
        let context = CGContext(consumer: consumer, mediaBox: &bounds, nil)!
        for text in ["gene then gene", "second page gene"] {
            context.beginPDFPage(nil)
            NSGraphicsContext.saveGraphicsState()
            NSGraphicsContext.current = NSGraphicsContext(cgContext: context, flipped: false)
            (text as NSString).draw(at: CGPoint(x: 30, y: 160), withAttributes: [.font: NSFont.systemFont(ofSize: 18)])
            NSGraphicsContext.restoreGraphicsState()
            context.endPDFPage()
        }
        context.closePDF()
        let document = PDFDocument(data: data as Data)!
        let first = document.page(at: 0)!
        let second = document.page(at: 1)!
        let secondOccurrence = (first.string! as NSString).range(of: "gene", options: .backwards)
        let selection = first.selection(for: secondOccurrence)!
        let anchors = PDFDocumentView.anchors(for: selection, in: document)
        require(anchors.first?.location == secondOccurrence.location, "PDF capture changed to first repeated word")
        let other = (second.string! as NSString).range(of: "gene")
        selection.add(second.selection(for: other)!)
        let crossPage = PDFDocumentView.anchors(for: selection, in: document)
        require(Set(crossPage.map(\.pageIndex)) == [0, 1], "Cross-page selection lost a page")
        let annotation = PaperAnnotation(paragraphID: 0, side: .original, quote: selection.string!,
                                         rangeLocation: secondOccurrence.location, rangeLength: 4,
                                         scope: .paper, locator: "pdf-page-0", pdfAnchors: crossPage)
        let roundTrip = try JSONDecoder().decode(PaperAnnotation.self, from: JSONEncoder().encode(annotation))
        require(PDFDocumentView.selection(for: roundTrip, in: document)?.pages.count == 2,
                "Saved cross-page annotation did not reconstruct")
    }

    static func require(_ condition: @autoclosure () -> Bool, _ message: String) {
        if !condition() { fatalError(message) }
    }
}
