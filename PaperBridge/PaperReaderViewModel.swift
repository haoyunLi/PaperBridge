import AppKit
import Foundation
import SwiftUI

@MainActor
final class PaperReaderViewModel: ObservableObject {
    @Published var settings = AppSettings() {
        didSet {
            guard settings != oldValue else { return }
            handleSettingsChange(from: oldValue)
            if !isRestoringWorkspace {
                workspaceStore.saveSettings(settings)
                persistWorkspace()
            }
        }
    }
    @Published var loadedPaper: PaperDocument?
    @Published var paragraphResults: [ParagraphResult] = []
    @Published var connectedTranslation: ConnectedTranslationResult?
    @Published var summaries: SummaryResult?
    @Published var explanationLanguage: ReaderLanguage = .english {
        didSet {
            guard explanationLanguage != oldValue else { return }
            explanationText = ""
            if let paper = loadedPaper {
                restoreCachedExplanationIfAvailable(for: paper)
            }
            if let selection = activeTextSelection {
                selectionExplanation = ""
                restoreSelectionLookupCache(for: selection)
            }
            persistWorkspace()
        }
    }
    @Published var explanationText = ""
    @Published var displayMode: ReaderDisplayMode = .bilingual {
        didSet {
            guard displayMode != oldValue else { return }
            persistWorkspace()
        }
    }
    @Published var workspaceMode: ReaderWorkspaceMode = .reader {
        didSet {
            guard workspaceMode != oldValue else { return }
            persistWorkspace()
        }
    }
    @Published var paragraphSearchText = ""
    @Published var manualInputText = ""
    @Published var selectedParagraphID: Int? {
        didSet {
            guard selectedParagraphID != oldValue else { return }
            explanationText = ""
            if let paper = loadedPaper {
                restoreCachedExplanationIfAvailable(for: paper)
            }
            persistWorkspace()
        }
    }
    @Published var editingParagraphID: Int?
    @Published var paragraphEditorText = ""
    @Published var isParagraphEditorPresented = false
    @Published private(set) var canUndoParagraphEdit = false
    @Published var statusMessage = "Open a PDF, paste text, or drag one into the window."
    @Published var progressValue = 0.0
    @Published var isProgressIndeterminate = false
    @Published var isBusy = false
    @Published var errorMessage: String?
    @Published var isImporterPresented = false
    @Published var isExporterPresented = false
    @Published var exportDocument = MarkdownDocument()
    @Published var availableModels: [String] = []
    @Published var isRefreshingModels = false
    @Published var modelRefreshError: String?
    @Published var minerUStatus = MinerUToolStatus(
        executablePath: nil,
        message: "MinerU status has not been checked yet."
    )
    @Published var isRefreshingMinerU = false
    @Published var isInspectorPresented = false {
        didSet {
            guard isInspectorPresented != oldValue else { return }
            persistWorkspace()
        }
    }
    @Published var activeTextSelection: ReaderTextSelection?
    @Published var selectionTranslation = ""
    @Published var selectionExplanation = ""
    @Published var selectionLookupStatus = ""
    @Published var selectionLookupError: String?
    @Published var isSelectionLookupBusy = false
    @Published var annotations: [PaperAnnotation] = []
    @Published var bookmarkedParagraphIDs: Set<Int> = []
    @Published var navigationRequest: ParagraphNavigationRequest?

    let ollamaClient = OllamaClient()
    let minerUService = MinerUService()
    private let workspaceStore: WorkspaceStore
    private let markdownBundleExporter = MarkdownBundleExporter()
    private var activeTask: Task<Void, Never>?
    private var modelRefreshTask: Task<Void, Never>?
    private var minerUStatusTask: Task<Void, Never>?
    private var paragraphUndoStack: [ParagraphEditSnapshot] = []
    var selectionTask: Task<Void, Never>?

    private var extractedPaperCache: [String: PaperDocument] = [:]
    private var chunkTranslationCache: [String: String] = [:]
    private var paragraphTranslationCache: [String: ParagraphTranslationSnapshot] = [:]
    private var paperTranslationCache: [String: [ParagraphResult]] = [:]
    private var connectedTranslationCache: [String: ConnectedTranslationResult] = [:]
    private var summaryCache: [String: SummaryResult] = [:]
    private var explanationCache: [String: String] = [:]
    var selectionLookupCache: [String: String] = [:]
    private var isRestoringWorkspace = false

    init(workspaceStore: WorkspaceStore = WorkspaceStore()) {
        self.workspaceStore = workspaceStore

        if let savedSettings = workspaceStore.loadSettings() {
            settings = savedSettings
        }

        guard let workspace = workspaceStore.loadLastWorkspace() else { return }

        loadedPaper = workspace.paper
        annotations = workspace.annotations
        bookmarkedParagraphIDs = workspace.bookmarkedParagraphIDs
        selectedParagraphID = workspace.selectedParagraphID
        displayMode = workspace.displayMode
        workspaceMode = workspace.workspaceMode
        explanationLanguage = workspace.explanationLanguage
        isInspectorPresented = workspace.isInspectorPresented

        let canRestoreGeneratedOutput =
            workspace.settings == settings &&
            workspace.paragraphResults.map(\.original) == workspace.paper.paragraphs

        if canRestoreGeneratedOutput {
            paragraphResults = workspace.paragraphResults
            connectedTranslation = workspace.connectedTranslation
            summaries = workspace.summaries
            explanationText = workspace.explanationText
            paperTranslationCache[
                translationCacheKey(for: workspace.paper, settings: settings)
            ] = workspace.paragraphResults
        } else {
            paragraphResults = Self.makeParagraphResults(for: workspace.paper)
            connectedTranslation = nil
            summaries = nil
            explanationText = ""
        }

        statusMessage = "Restored \(workspace.paper.name) from local PaperBridge storage."
    }

    deinit {
        activeTask?.cancel()
        modelRefreshTask?.cancel()
        minerUStatusTask?.cancel()
        selectionTask?.cancel()
        minerUService.cancelCurrentRun()
    }

    var translatedCount: Int {
        paragraphResults.filter { $0.status == .ok }.count
    }

    var failedCount: Int {
        paragraphResults.filter { $0.status == .failed }.count
    }

    var canTranslate: Bool {
        !paragraphResults.isEmpty && !isBusy
    }

    var canLoadInputText: Bool {
        !manualInputText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !isBusy
    }

    var canSummarize: Bool {
        loadedPaper?.paragraphs.isEmpty == false && !isBusy
    }

    var canGenerateConnectedTranslation: Bool {
        loadedPaper?.paragraphs.isEmpty == false && !isBusy
    }

    var canExplain: Bool {
        selectedParagraph != nil && !isBusy
    }

    var canExport: Bool {
        guard !isBusy else { return false }
        return !paragraphResults.isEmpty || loadedPaper?.hasMarkdownBundle == true
    }

    var canEditParagraphStructure: Bool {
        loadedPaper?.hasStructuredMarkdown != true && !isBusy
    }

    var canPerformPrimaryWorkspaceAction: Bool {
        guard loadedPaper != nil, !isBusy else { return false }

        switch workspaceMode {
        case .preview:
            return canTranslate && paragraphResults.contains { $0.status != .ok }
        case .reader:
            return canTranslate && paragraphResults.contains { $0.status != .ok }
        case .summary:
            return canSummarize && summaries == nil
        case .fullTranslation:
            return canGenerateConnectedTranslation && (connectedTranslation == nil ||
                (connectedTranslation?.failedBatchCount ?? 0) > 0
            )
        }
    }

    var selectedParagraph: ParagraphResult? {
        paragraphResults.first(where: { $0.id == selectedParagraphID })
    }

    var visibleParagraphResults: [ParagraphResult] {
        let query = paragraphSearchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return paragraphResults }

        return paragraphResults.filter {
            $0.original.localizedCaseInsensitiveContains(query) ||
                $0.translation.localizedCaseInsensitiveContains(query)
        }
    }

    var visibleReaderItems: [ReaderFlowItem] {
        let query = paragraphSearchText.trimmingCharacters(in: .whitespacesAndNewlines)
        if !query.isEmpty {
            return visibleParagraphResults.map(ReaderFlowItem.paragraph)
        }

        guard let segments = loadedPaper?.markdownSegments, !segments.isEmpty else {
            return paragraphResults.map(ReaderFlowItem.paragraph)
        }

        let items = AcademicMarkdownProcessor.readerFlowItems(
            segments: segments,
            results: paragraphResults
        )
        return items.isEmpty ? paragraphResults.map(ReaderFlowItem.paragraph) : items
    }

    var defaultExportFilename: String {
        guard let loadedPaper else { return "paper_bilingual.md" }
        let stem = URL(fileURLWithPath: loadedPaper.name)
            .deletingPathExtension()
            .lastPathComponent
        return stem + "_bilingual.md"
    }

    var previewMarkdown: String {
        guard let paper = loadedPaper else { return "" }
        let segments = paper.markdownSegments
        let translatedBody = paragraphResults.map { result in
            result.status == .ok ? result.translation : result.original
        }.joined(separator: "\n\n")
        let bilingualBody = paragraphResults.map { result in
            let translation = result.status == .ok ? result.translation : "[Translation unavailable]"
            return result.original + "\n\n> **\(settings.targetLanguage.displayName) translation**\n> " + translation
        }.joined(separator: "\n\n")

        switch displayMode {
        case .sourceOnly:
            return paper.sourceMarkdown ?? paper.paragraphs.joined(separator: "\n\n")
        case .translationOnly:
            if let structuredTranslation = structuredTranslationMarkdown(
                for: paper,
                results: paragraphResults
            ) {
                return structuredTranslation
            }
            if paper.hasFacsimileMarkdown, let facsimile = paper.sourceMarkdown {
                return facsimileTranslationMarkdown(
                    facsimile: facsimile,
                    translatedBody: translatedBody
                )
            }
            return translatedBody
        case .bilingual:
            if let segments {
                return AcademicMarkdownProcessor.bilingualMarkdown(
                    segments: segments,
                    results: paragraphResults,
                    targetLanguage: settings.targetLanguage
                )
            }
            if paper.hasFacsimileMarkdown, let facsimile = paper.sourceMarkdown {
                return facsimileBilingualMarkdown(
                    facsimile: facsimile,
                    bilingualBody: bilingualBody
                )
            }
            return bilingualBody
        }
    }

    private func structuredTranslationMarkdown(
        for paper: PaperDocument,
        results: [ParagraphResult]
    ) -> String? {
        guard let segments = paper.markdownSegments, !segments.isEmpty else { return nil }
        return AcademicMarkdownProcessor.translatedMarkdown(
            segments: segments,
            results: results
        )
    }

    var previewResourceDirectory: URL? {
        loadedPaper?.markdownResourceURL
    }

    var previewOriginalPDFURL: URL? {
        guard displayMode == .sourceOnly else { return nil }
        return loadedPaper?.originalPDFURL
    }

    private func facsimileTranslationMarkdown(
        facsimile: String,
        translatedBody: String
    ) -> String {
        let body = translatedBody.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? "> No selectable text was found. Translation requires a PDF text layer or an OCR parser."
            : translatedBody
        return """
        \(facsimile.trimmingCharacters(in: .whitespacesAndNewlines))

        # \(settings.targetLanguage.displayName) translation of selectable text

        \(body)
        """ + "\n"
    }

    private func facsimileBilingualMarkdown(
        facsimile: String,
        bilingualBody: String
    ) -> String {
        let body = bilingualBody.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? "> No selectable text was found. The original pages remain available above, but model-free translation is not possible for a scanned image-only PDF."
            : bilingualBody
        return """
        \(facsimile.trimmingCharacters(in: .whitespacesAndNewlines))

        # Extracted bilingual text

        \(body)
        """ + "\n"
    }

    var hasAvailableModels: Bool {
        !availableModels.isEmpty
    }

    var documentSections: [DocumentSection] {
        if let markdownSections = loadedPaper?.markdownSegments?.compactMap({ segment -> DocumentSection? in
            guard segment.kind == .heading,
                  let paragraphID = segment.paragraphID,
                  let title = segment.analysisText,
                  !title.isEmpty else { return nil }
            return DocumentSection(paragraphID: paragraphID, title: title)
        }), !markdownSections.isEmpty {
            return markdownSections
        }

        let detected = paragraphResults.compactMap { paragraph -> DocumentSection? in
            guard let title = TextProcessing.detectedSectionTitle(in: paragraph.original) else {
                return nil
            }
            return DocumentSection(paragraphID: paragraph.id, title: title)
        }

        if !detected.isEmpty {
            return detected
        }

        guard let firstParagraphID = paragraphResults.first?.id else { return [] }
        return [DocumentSection(paragraphID: firstParagraphID, title: "Beginning")]
    }

    private struct ParagraphEditSnapshot {
        let paragraphs: [String]
        let selectedIndex: Int?
    }

    func showImporter() {
        isImporterPresented = true
    }

    func clearError() {
        errorMessage = nil
    }

    func toggleInspector() {
        isInspectorPresented.toggle()
    }

    func performPrimaryWorkspaceAction() {
        switch workspaceMode {
        case .preview:
            translatePaper()
        case .reader:
            translatePaper()
        case .summary:
            generateSummaries()
        case .fullTranslation:
            generateConnectedTranslation()
        }
    }

    func navigateToParagraph(_ paragraphID: Int) {
        guard paragraphResults.contains(where: { $0.id == paragraphID }) else { return }
        paragraphSearchText = ""
        selectedParagraphID = paragraphID
        navigationRequest = ParagraphNavigationRequest(paragraphID: paragraphID)
    }

    func toggleBookmark(for paragraphID: Int) {
        if bookmarkedParagraphIDs.contains(paragraphID) {
            bookmarkedParagraphIDs.remove(paragraphID)
        } else {
            bookmarkedParagraphIDs.insert(paragraphID)
        }
        persistWorkspace()
    }

    func clearSavedData() {
        activeTask?.cancel()
        selectionTask?.cancel()
        activeTask = nil
        selectionTask = nil
        workspaceStore.clearAll()

        isRestoringWorkspace = true
        settings = AppSettings()
        loadedPaper = nil
        paragraphResults = []
        connectedTranslation = nil
        summaries = nil
        explanationText = ""
        selectedParagraphID = nil
        activeTextSelection = nil
        selectionTranslation = ""
        selectionExplanation = ""
        selectionLookupStatus = ""
        selectionLookupError = nil
        annotations = []
        bookmarkedParagraphIDs = []
        workspaceMode = .reader
        displayMode = .bilingual
        isInspectorPresented = false
        isBusy = false
        isProgressIndeterminate = false
        isSelectionLookupBusy = false
        progressValue = 0
        manualInputText = ""
        paragraphUndoStack.removeAll()
        canUndoParagraphEdit = false
        extractedPaperCache.removeAll()
        chunkTranslationCache.removeAll()
        paragraphTranslationCache.removeAll()
        paperTranslationCache.removeAll()
        connectedTranslationCache.removeAll()
        summaryCache.removeAll()
        explanationCache.removeAll()
        selectionLookupCache.removeAll()
        isRestoringWorkspace = false
        statusMessage = "Saved PaperBridge workspaces were removed from this Mac."
    }

    func swapTranslationLanguages() {
        var updatedSettings = settings
        let previousSource = updatedSettings.sourceLanguage
        updatedSettings.sourceLanguage = updatedSettings.targetLanguage
        updatedSettings.targetLanguage = previousSource
        settings = updatedSettings
    }

    func refreshAvailableModels() {
        modelRefreshTask?.cancel()
        modelRefreshTask = Task { [weak self] in
            guard let self else { return }

            self.isRefreshingModels = true
            self.modelRefreshError = nil

            do {
                let models = try await self.ollamaClient.listModels(baseURL: self.settings.ollamaBaseURL)
                let sortedModels = Array(Set(models)).sorted()
                self.availableModels = sortedModels
                self.syncModelSelections(with: sortedModels)
            } catch is CancellationError {
                self.isRefreshingModels = false
                return
            } catch {
                self.availableModels = []
                self.modelRefreshError = error.localizedDescription
            }

            self.isRefreshingModels = false
        }
    }

    func refreshMinerUStatus() {
        minerUStatusTask?.cancel()
        let configuredPath = settings.minerUExecutablePath
        minerUStatusTask = Task { [weak self] in
            guard let self else { return }
            self.isRefreshingMinerU = true
            let status = await Task.detached(priority: .utility) {
                self.minerUService.status(configuredPath: configuredPath)
            }.value
            guard !Task.isCancelled else {
                self.isRefreshingMinerU = false
                return
            }
            self.minerUStatus = status
            self.isRefreshingMinerU = false
        }
    }

    func scheduleMinerUStatusRefresh() {
        minerUStatusTask?.cancel()
        minerUStatusTask = Task { [weak self] in
            guard let self else { return }
            do {
                try await Task.sleep(for: .milliseconds(450))
                try Task.checkCancellation()
                self.refreshMinerUStatus()
            } catch {
                return
            }
        }
    }

    func scheduleModelRefresh() {
        modelRefreshTask?.cancel()
        modelRefreshTask = Task { [weak self] in
            guard let self else { return }

            do {
                try await Task.sleep(for: .milliseconds(500))
                try Task.checkCancellation()
                self.refreshAvailableModels()
            } catch {
                return
            }
        }
    }

    func cancelCurrentTask() {
        activeTask?.cancel()
        minerUService.cancelCurrentRun()
        activeTask = nil
        isBusy = false
        isProgressIndeterminate = false
        statusMessage = "The current task was cancelled."
        progressValue = 0
        persistWorkspace()
    }

    func handleFileImport(_ result: Result<[URL], Error>) {
        switch result {
        case .success(let urls):
            guard let url = urls.first else { return }
            loadPDF(from: url)
        case .failure(let error):
            presentError(error.localizedDescription)
        }
    }

    @discardableResult
    func handleDroppedFiles(_ urls: [URL]) -> Bool {
        guard let pdfURL = urls.first(where: { $0.pathExtension.lowercased() == "pdf" }) else {
            presentError(ReaderError.droppedFileMustBePDF.localizedDescription)
            return false
        }

        loadPDF(from: pdfURL)
        return true
    }

    func loadPDF(from url: URL) {
        startTask(initialStatus: "Loading PDF...") {
            let paper = try await self.readPaper(from: url)
            self.applyLoadedPaper(paper)
        }
    }

    func loadTextInput() {
        startTask(initialStatus: "Preparing pasted text...") {
            let paper = try await self.readTextInput(self.manualInputText)
            self.applyLoadedPaper(paper)
        }
    }

    func translatePaper() {
        guard let paper = loadedPaper else {
            presentError(ReaderError.noPaperLoaded.localizedDescription)
            return
        }

        startTask(initialStatus: "Checking Ollama model...") {
            let settings = self.settings
            let cacheKey = self.translationCacheKey(for: paper, settings: settings)

            if let cached = self.paperTranslationCache[cacheKey] {
                self.paragraphResults = cached
                self.progressValue = 1
                self.statusMessage = "Using cached paragraph translations for this paper and settings."
                self.persistWorkspace()
                return
            }

            let currentResultsMatchPaper =
                self.paragraphResults.map(\.original) == paper.paragraphs
            var workingResults = currentResultsMatchPaper
                ? self.paragraphResults
                : Self.makeParagraphResults(for: paper)
            self.paragraphResults = workingResults

            if settings.sourceLanguage != settings.targetLanguage {
                try await self.ollamaClient.ensureModelAvailable(
                    baseURL: settings.ollamaBaseURL,
                    model: settings.translationModel
                )
            }

            for index in workingResults.indices {
                try Task.checkCancellation()

                if workingResults[index].status == .ok {
                    self.progressValue = Double(index + 1) / Double(max(workingResults.count, 1))
                    continue
                }

                self.statusMessage = "Translating paragraph \(index + 1) of \(workingResults.count)"
                let snapshot = try await self.translateParagraph(
                    workingResults[index],
                    settings: settings
                )

                workingResults[index].translation = snapshot.translation
                workingResults[index].translationMarkdown = snapshot.translationMarkdown
                workingResults[index].status = snapshot.status
                workingResults[index].errorMessage = snapshot.errorMessage
                workingResults[index].chunkCount = snapshot.chunkCount

                self.paragraphResults = workingResults
                self.progressValue = Double(index + 1) / Double(max(workingResults.count, 1))
                if index.isMultiple(of: 5) || index == workingResults.indices.last {
                    self.persistWorkspace()
                }
            }

            self.paperTranslationCache[cacheKey] = workingResults
            self.progressValue = 1

            let failures = workingResults.filter { $0.status == .failed }.count
            if failures > 0 {
                self.statusMessage = "Paragraph translation finished. \(failures) paragraph\(failures == 1 ? "" : "s") failed and can be retried individually."
            } else if settings.sourceLanguage == settings.targetLanguage {
                self.statusMessage = "Source and target languages match, so the original text was reused."
            } else {
                self.statusMessage = "Paragraph translation finished."
            }
            self.persistWorkspace()
        }
    }

    func generateConnectedTranslation() {
        guard let paper = loadedPaper else {
            presentError(ReaderError.noPaperLoaded.localizedDescription)
            return
        }

        startTask(initialStatus: "Preparing connected full translation...") {
            let settings = self.settings
            let cacheKey = self.connectedTranslationCacheKey(for: paper, settings: settings)

            if let cached = self.connectedTranslationCache[cacheKey] {
                self.connectedTranslation = cached
                self.progressValue = 1
                self.statusMessage = "Using the cached connected full translation."
                self.persistWorkspace()
                return
            }

            if let segments = paper.markdownSegments, !segments.isEmpty {
                if settings.sourceLanguage != settings.targetLanguage {
                    try await self.ollamaClient.ensureModelAvailable(
                        baseURL: settings.ollamaBaseURL,
                        model: settings.translationModel
                    )
                }

                var workingResults = self.paragraphResults.map(\.original) == paper.paragraphs
                    ? self.paragraphResults
                    : Self.makeParagraphResults(for: paper)

                for index in workingResults.indices {
                    try Task.checkCancellation()
                    self.statusMessage = "Translating structured Markdown block \(index + 1) of \(workingResults.count)"

                    if workingResults[index].status != .ok {
                        let snapshot = try await self.translateParagraph(
                            workingResults[index],
                            settings: settings
                        )
                        workingResults[index].translation = snapshot.translation
                        workingResults[index].translationMarkdown = snapshot.translationMarkdown
                        workingResults[index].status = snapshot.status
                        workingResults[index].errorMessage = snapshot.errorMessage
                        workingResults[index].chunkCount = snapshot.chunkCount
                        self.paragraphResults = workingResults
                    }
                    self.progressValue = Double(index + 1) / Double(max(workingResults.count, 1))
                }

                let failures = workingResults.filter { $0.status == .failed }.count
                let markdown = self.structuredTranslationMarkdown(
                    for: paper,
                    results: workingResults
                ) ?? paper.sourceMarkdown ?? ""
                let result = ConnectedTranslationResult(
                    sourceLanguage: settings.sourceLanguage,
                    targetLanguage: settings.targetLanguage,
                    text: markdown,
                    batchCount: workingResults.count,
                    failedBatchCount: failures,
                    isStructuredMarkdown: true
                )
                self.paragraphResults = workingResults
                self.paperTranslationCache[
                    self.translationCacheKey(for: paper, settings: settings)
                ] = workingResults
                self.connectedTranslation = result
                if failures == 0 {
                    self.connectedTranslationCache[cacheKey] = result
                }
                self.progressValue = 1
                self.statusMessage = failures == 0
                    ? "Structure-preserving full translation finished. Formulas, images, tables, and references were retained."
                    : "Structure-preserving translation finished with \(failures) failed block(s); original blocks were retained in those positions."
                self.persistWorkspace()
                return
            }

            if settings.sourceLanguage == settings.targetLanguage {
                let body = paper.paragraphs.joined(separator: "\n\n")
                let result = ConnectedTranslationResult(
                    sourceLanguage: settings.sourceLanguage,
                    targetLanguage: settings.targetLanguage,
                    text: paper.hasFacsimileMarkdown && paper.sourceMarkdown != nil
                        ? self.facsimileTranslationMarkdown(
                            facsimile: paper.sourceMarkdown ?? "",
                            translatedBody: body
                        )
                        : body,
                    batchCount: 1,
                    failedBatchCount: 0,
                    isStructuredMarkdown: paper.hasFacsimileMarkdown
                )
                self.connectedTranslation = result
                self.connectedTranslationCache[cacheKey] = result
                self.progressValue = 1
                self.statusMessage = "Source and target languages match, so the original text was reused."
                self.persistWorkspace()
                return
            }

            try await self.ollamaClient.ensureModelAvailable(
                baseURL: settings.ollamaBaseURL,
                model: settings.translationModel
            )

            let batches = TextProcessing.buildTextBatches(
                paper.paragraphs,
                maxChars: TextProcessing.connectedTranslationBatchChars
            )
            var completedBatches = 0
            let translatedResult = try await self.translateConnectedPaper(
                paper,
                settings: settings,
                batches: batches
            ) { status in
                self.statusMessage = status
            } onBatchFinished: {
                completedBatches += 1
                self.progressValue = Double(completedBatches) / Double(max(batches.count, 1))
            }

            let result: ConnectedTranslationResult
            if paper.hasFacsimileMarkdown, let facsimile = paper.sourceMarkdown {
                result = ConnectedTranslationResult(
                    sourceLanguage: translatedResult.sourceLanguage,
                    targetLanguage: translatedResult.targetLanguage,
                    text: self.facsimileTranslationMarkdown(
                        facsimile: facsimile,
                        translatedBody: translatedResult.text
                    ),
                    batchCount: translatedResult.batchCount,
                    failedBatchCount: translatedResult.failedBatchCount,
                    isStructuredMarkdown: true
                )
            } else {
                result = translatedResult
            }

            self.connectedTranslation = result
            if result.failedBatchCount == 0 {
                self.connectedTranslationCache[cacheKey] = result
            }
            self.progressValue = 1

            if result.failedBatchCount > 0 {
                self.statusMessage = "Connected translation finished with \(result.failedBatchCount) failed batch\(result.failedBatchCount == 1 ? "" : "es")."
            } else {
                self.statusMessage = "Connected full translation finished."
            }
            self.persistWorkspace()
        }
    }

    func retryTranslation(for paragraphID: Int) {
        guard let paper = loadedPaper,
              let index = paragraphResults.firstIndex(where: { $0.id == paragraphID }) else {
            return
        }

        startTask(initialStatus: "Retrying paragraph \(paragraphID)...") {
            let settings = self.settings
            if settings.sourceLanguage != settings.targetLanguage {
                try await self.ollamaClient.ensureModelAvailable(
                    baseURL: settings.ollamaBaseURL,
                    model: settings.translationModel
                )
            }

            let snapshot = try await self.translateParagraph(
                self.paragraphResults[index],
                settings: settings
            )
            self.paragraphResults[index].translation = snapshot.translation
            self.paragraphResults[index].translationMarkdown = snapshot.translationMarkdown
            self.paragraphResults[index].status = snapshot.status
            self.paragraphResults[index].errorMessage = snapshot.errorMessage
            self.paragraphResults[index].chunkCount = snapshot.chunkCount
            self.paperTranslationCache[
                self.translationCacheKey(for: paper, settings: settings)
            ] = self.paragraphResults
            self.progressValue = 1

            if snapshot.status == .ok {
                self.statusMessage = "Paragraph \(paragraphID) translated successfully."
            } else {
                self.statusMessage = "Paragraph \(paragraphID) still failed. Other paragraphs were not affected."
            }
            self.persistWorkspace()
        }
    }

    func generateSummaries() {
        guard let paper = loadedPaper else {
            presentError(ReaderError.noPaperLoaded.localizedDescription)
            return
        }

        startTask(initialStatus: "Checking summary model...") {
            let settings = self.settings
            let cacheKey = Hashing.sha256(
                "\(paper.checksum)|\(settings.ollamaBaseURL)|\(settings.summaryModel)|\(settings.translationModel)|\(settings.sourceLanguage.rawValue)|\(settings.targetLanguage.rawValue)"
            )

            if let cached = self.summaryCache[cacheKey] {
                self.summaries = cached
                self.progressValue = 1
                self.statusMessage = "Using cached summaries for this paper and settings."
                self.persistWorkspace()
                return
            }

            try await self.ollamaClient.ensureModelAvailable(
                baseURL: settings.ollamaBaseURL,
                model: settings.summaryModel
            )
            if settings.sourceLanguage != settings.targetLanguage {
                try await self.ollamaClient.ensureModelAvailable(
                    baseURL: settings.ollamaBaseURL,
                    model: settings.translationModel
                )
            }

            let batches = TextProcessing.buildTextBatches(paper.paragraphs)
            var partials: [String] = []
            let totalSteps = max(batches.count + 1, 1)

            for (index, batch) in batches.enumerated() {
                try Task.checkCancellation()
                self.statusMessage = "Summarizing batch \(index + 1) of \(batches.count)"

                let partial = try await self.ollamaClient.generate(
                    baseURL: settings.ollamaBaseURL,
                    model: settings.summaryModel,
                    prompt: PromptLibrary.summaryPrompt(for: batch, language: settings.sourceLanguage),
                    systemPrompt: PromptLibrary.summarySystemPrompt
                )

                partials.append(partial)
                self.progressValue = Double(index + 1) / Double(totalSteps)
            }

            let sourceSummary: String
            if partials.count == 1, let single = partials.first {
                sourceSummary = single
            } else {
                self.statusMessage = "Merging partial summaries"
                sourceSummary = try await self.ollamaClient.generate(
                    baseURL: settings.ollamaBaseURL,
                    model: settings.summaryModel,
                    prompt: PromptLibrary.mergedSummaryPrompt(partials: partials, language: settings.sourceLanguage),
                    systemPrompt: PromptLibrary.summarySystemPrompt
                )
            }

            let targetSummary: String
            if settings.sourceLanguage == settings.targetLanguage {
                targetSummary = sourceSummary
            } else {
                self.statusMessage = "Translating the summary into \(settings.targetLanguage.displayName)"
                targetSummary = try await self.translateChunk(sourceSummary, settings: settings)
            }

            let result = SummaryResult(
                sourceLanguage: settings.sourceLanguage,
                targetLanguage: settings.targetLanguage,
                sourceSummary: sourceSummary,
                targetSummary: targetSummary
            )
            self.summaries = result
            self.summaryCache[cacheKey] = result
            self.progressValue = 1
            self.statusMessage = "Summary finished."
            self.persistWorkspace()
        }
    }

    func explainSelectedParagraph() {
        guard let paper = loadedPaper else {
            presentError(ReaderError.noPaperLoaded.localizedDescription)
            return
        }

        guard let selectedParagraph else {
            presentError(ReaderError.noSelectedParagraph.localizedDescription)
            return
        }

        startTask(initialStatus: "Checking explanation model...") {
            let settings = self.settings
            let cacheKey = Hashing.sha256(
                "\(paper.checksum)|\(settings.ollamaBaseURL)|\(settings.explainModel)|\(selectedParagraph.id)|\(self.explanationLanguage.rawValue)"
            )

            if let cached = self.explanationCache[cacheKey] {
                self.explanationText = cached
                self.progressValue = 1
                self.statusMessage = "Using cached explanation for paragraph \(selectedParagraph.id)."
                self.persistWorkspace()
                return
            }

            try await self.ollamaClient.ensureModelAvailable(baseURL: settings.ollamaBaseURL, model: settings.explainModel)

            self.statusMessage = "Explaining paragraph \(selectedParagraph.id)"
            let explanation = try await self.ollamaClient.generate(
                baseURL: settings.ollamaBaseURL,
                model: settings.explainModel,
                prompt: PromptLibrary.explanationPrompt(for: selectedParagraph.original, language: self.explanationLanguage),
                systemPrompt: PromptLibrary.explainSystemPrompt
            )

            self.explanationText = explanation
            self.explanationCache[cacheKey] = explanation
            self.progressValue = 1
            self.statusMessage = "Explanation finished."
            self.persistWorkspace()
        }
    }

    func beginEditingParagraph(_ paragraphID: Int) {
        guard !isBusy,
              let paragraph = paragraphResults.first(where: { $0.id == paragraphID }) else {
            return
        }

        selectedParagraphID = paragraphID
        editingParagraphID = paragraphID
        paragraphEditorText = paragraph.original
        isParagraphEditorPresented = true
    }

    func cancelParagraphEdit() {
        isParagraphEditorPresented = false
        editingParagraphID = nil
        paragraphEditorText = ""
    }

    func saveParagraphEdit() {
        guard let paragraphID = editingParagraphID,
              let index = paragraphResults.firstIndex(where: { $0.id == paragraphID }) else {
            cancelParagraphEdit()
            return
        }

        let editedParagraphs = normalizedManualParagraphs(from: paragraphEditorText)
        guard !editedParagraphs.isEmpty else {
            presentError(ReaderError.emptyParagraphEdit.localizedDescription)
            return
        }

        var paragraphs = paragraphResults.map(\.original)
        paragraphs.replaceSubrange(index...index, with: editedParagraphs)
        applyParagraphMutation(
            paragraphs,
            selectedIndex: index,
            message: editedParagraphs.count == 1
                ? "Paragraph \(paragraphID) updated."
                : "Paragraph \(paragraphID) split into \(editedParagraphs.count) paragraphs."
        )
        cancelParagraphEdit()
    }

    func mergeParagraphWithPrevious(_ paragraphID: Int) {
        guard !isBusy,
              let index = paragraphResults.firstIndex(where: { $0.id == paragraphID }),
              index > 0 else {
            return
        }

        var paragraphs = paragraphResults.map(\.original)
        paragraphs[index - 1] = TextProcessing.mergeForReading(paragraphs[index - 1], paragraphs[index])
        paragraphs.remove(at: index)
        applyParagraphMutation(
            paragraphs,
            selectedIndex: index - 1,
            message: "Merged paragraph \(paragraphID) with the previous paragraph."
        )
    }

    func mergeParagraphWithNext(_ paragraphID: Int) {
        guard !isBusy,
              let index = paragraphResults.firstIndex(where: { $0.id == paragraphID }),
              index + 1 < paragraphResults.count else {
            return
        }

        var paragraphs = paragraphResults.map(\.original)
        paragraphs[index] = TextProcessing.mergeForReading(paragraphs[index], paragraphs[index + 1])
        paragraphs.remove(at: index + 1)
        applyParagraphMutation(
            paragraphs,
            selectedIndex: index,
            message: "Merged paragraph \(paragraphID) with the next paragraph."
        )
    }

    func reflowParagraph(_ paragraphID: Int) {
        guard !isBusy,
              let index = paragraphResults.firstIndex(where: { $0.id == paragraphID }) else {
            return
        }

        let pieces = TextProcessing.splitForReading(paragraphResults[index].original)
        guard pieces.count > 1 else {
            statusMessage = "Paragraph \(paragraphID) is already short enough or has no safe sentence boundary."
            return
        }

        var paragraphs = paragraphResults.map(\.original)
        paragraphs.replaceSubrange(index...index, with: pieces)
        applyParagraphMutation(
            paragraphs,
            selectedIndex: index,
            message: "Reflowed paragraph \(paragraphID) into \(pieces.count) complete-sentence paragraphs."
        )
    }

    func undoParagraphEdit() {
        guard !isBusy, let snapshot = paragraphUndoStack.popLast() else { return }

        applyParagraphMutation(
            snapshot.paragraphs,
            selectedIndex: snapshot.selectedIndex,
            recordUndo: false,
            message: "Undid the last paragraph edit."
        )
        canUndoParagraphEdit = !paragraphUndoStack.isEmpty
    }

    func prepareMarkdownExport() {
        guard let paper = loadedPaper else {
            presentError(ReaderError.noPaperLoaded.localizedDescription)
            return
        }

        if paper.hasMarkdownBundle {
            let panel = NSOpenPanel()
            panel.title = "Export PaperBridge Markdown Bundle"
            panel.message = "Choose a folder. PaperBridge will create a bundle containing original, translated, bilingual, and analysis Markdown plus every preserved local asset."
            panel.prompt = "Export Here"
            panel.canChooseFiles = false
            panel.canChooseDirectories = true
            panel.allowsMultipleSelection = false
            panel.canCreateDirectories = true
            panel.begin { [weak self] response in
                guard response == .OK, let destination = panel.url else { return }
                Task { @MainActor [weak self] in
                    self?.exportStructuredMarkdownBundle(to: destination, paper: paper)
                }
            }
            return
        }

        exportDocument = MarkdownDocument(text: buildMarkdownExport(for: paper))
        isExporterPresented = true
    }

    private func exportStructuredMarkdownBundle(to destination: URL, paper: PaperDocument) {
        startTask(initialStatus: "Exporting Markdown and referenced assets...") {
            self.isProgressIndeterminate = true
            let hasAccess = destination.startAccessingSecurityScopedResource()
            defer {
                if hasAccess {
                    destination.stopAccessingSecurityScopedResource()
                }
            }

            guard let sourceMarkdown = paper.sourceMarkdown,
                  paper.markdownResourceURL != nil else {
                throw MarkdownBundleExporterError.noDocuments
            }
            let translationMarkdown: String
            let bilingualMarkdown: String
            if let segments = paper.markdownSegments {
                translationMarkdown = self.structuredTranslationMarkdown(
                    for: paper,
                    results: self.paragraphResults
                ) ?? sourceMarkdown
                bilingualMarkdown = AcademicMarkdownProcessor.bilingualMarkdown(
                    segments: segments,
                    results: self.paragraphResults,
                    targetLanguage: self.settings.targetLanguage
                )
            } else if paper.hasFacsimileMarkdown {
                let translatedBody = self.paragraphResults.map { result in
                    result.status == .ok ? result.translation : result.original
                }.joined(separator: "\n\n")
                let bilingualBody = self.paragraphResults.map { result in
                    let translation = result.status == .ok
                        ? result.translation
                        : "[Translation unavailable]"
                    return result.original + "\n\n> **\(self.settings.targetLanguage.displayName) translation**\n> " + translation
                }.joined(separator: "\n\n")
                translationMarkdown = self.facsimileTranslationMarkdown(
                    facsimile: sourceMarkdown,
                    translatedBody: translatedBody
                )
                bilingualMarkdown = self.facsimileBilingualMarkdown(
                    facsimile: sourceMarkdown,
                    bilingualBody: bilingualBody
                )
            } else {
                throw MarkdownBundleExporterError.noDocuments
            }
            var documents = [
                "paper_original.md": sourceMarkdown,
                "paper_translation_\(self.settings.targetLanguage.translationCode).md": translationMarkdown,
                "paper_bilingual_\(self.settings.sourceLanguage.translationCode)_\(self.settings.targetLanguage.translationCode).md": bilingualMarkdown,
                "paper_analysis_notes.md": self.buildMarkdownExport(for: paper)
            ]
            if let connectedTranslation = self.connectedTranslation,
               connectedTranslation.isStructuredMarkdown == true,
               !connectedTranslation.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                documents[
                    "paper_full_translation_\(self.settings.targetLanguage.translationCode).md"
                ] = paper.hasStructuredMarkdown
                    ? translationMarkdown
                    : connectedTranslation.text
            }
            let result = try self.markdownBundleExporter.export(
                paperName: paper.name,
                documents: documents,
                assetSourceDirectory: paper.markdownResourceURL,
                to: destination
            )
            self.isProgressIndeterminate = false
            self.progressValue = 1

            if result.missingAssetPaths.isEmpty {
                self.statusMessage = "Exported Markdown bundle with \(result.copiedAssetCount) referenced asset(s) to \(result.directoryURL.lastPathComponent)."
            } else {
                self.statusMessage = "Exported Markdown bundle, but \(result.missingAssetPaths.count) referenced asset(s) could not be found."
            }
            NSWorkspace.shared.activateFileViewerSelecting([result.directoryURL])
        }
    }

    func handleExportCompletion(_ result: Result<URL, Error>) {
        switch result {
        case .success(let url):
            statusMessage = "Exported Markdown to \(url.lastPathComponent)."
        case .failure(let error):
            presentError(error.localizedDescription)
        }
    }

    private func startTask(initialStatus: String, operation: @escaping @MainActor () async throws -> Void) {
        activeTask?.cancel()
        errorMessage = nil
        isBusy = true
        statusMessage = initialStatus
        progressValue = 0
        isProgressIndeterminate = false

        activeTask = Task { [weak self] in
            guard let self else { return }
            do {
                try await operation()
                self.isBusy = false
                self.isProgressIndeterminate = false
            } catch is CancellationError {
                self.isBusy = false
                self.progressValue = 0
                self.isProgressIndeterminate = false
                self.statusMessage = "The current task was cancelled."
                self.persistWorkspace()
            } catch {
                self.isBusy = false
                self.progressValue = 0
                self.isProgressIndeterminate = false
                self.presentError(error.localizedDescription)
                self.persistWorkspace()
            }
        }
    }

    private func applyLoadedPaper(_ paper: PaperDocument) {
        isRestoringWorkspace = true
        defer {
            isRestoringWorkspace = false
            persistWorkspace()
        }

        paragraphUndoStack.removeAll()
        canUndoParagraphEdit = false
        editingParagraphID = nil
        paragraphEditorText = ""
        isParagraphEditorPresented = false
        paragraphSearchText = ""
        loadedPaper = paper
        activeTextSelection = nil
        selectionTranslation = ""
        selectionExplanation = ""
        selectionLookupStatus = ""
        selectionLookupError = nil
        progressValue = 0

        if let saved = workspaceStore.loadWorkspace(checksum: paper.checksum) {
            annotations = saved.annotations
            bookmarkedParagraphIDs = saved.bookmarkedParagraphIDs
            selectedParagraphID = saved.selectedParagraphID ?? paper.paragraphs.indices.first.map { $0 + 1 }
            displayMode = saved.displayMode
            workspaceMode = saved.workspaceMode
            explanationLanguage = saved.explanationLanguage
            isInspectorPresented = saved.isInspectorPresented

            let canRestoreGeneratedOutput =
                saved.settings == settings &&
                saved.paragraphResults.map(\.original) == paper.paragraphs

            if canRestoreGeneratedOutput {
                paragraphResults = saved.paragraphResults
                connectedTranslation = saved.connectedTranslation
                summaries = saved.summaries
                explanationText = saved.explanationText
                paperTranslationCache[
                    translationCacheKey(for: paper, settings: settings)
                ] = saved.paragraphResults
                statusMessage = "Restored saved translation and annotations for \(paper.name)."
                return
            }
        } else {
            annotations = []
            bookmarkedParagraphIDs = []
            selectedParagraphID = paper.paragraphs.indices.first.map { $0 + 1 }
            workspaceMode = paper.sourceMarkdown?.isEmpty == false ? .preview : .reader
        }

        paragraphResults = Self.makeParagraphResults(for: paper)
        connectedTranslation = nil
        summaries = nil
        explanationText = ""
        restoreCachedOutputsIfAvailable(for: paper)

        let engine = paper.extractionEngine?.displayName ?? "local extraction"
        var status = "Loaded \(paper.name) with \(paper.paragraphs.count) analysis paragraphs using \(engine)."
        if paper.excludedReferenceCount > 0 {
            status += " Kept \(paper.excludedReferenceCount) reference blocks in the document but excluded them from AI tasks."
        }
        if let warning = paper.extractionWarning {
            status += " Note: \(warning)"
        }
        statusMessage = status
    }

    private func readPaper(from url: URL) async throws -> PaperDocument {
        let hasAccess = url.startAccessingSecurityScopedResource()
        defer {
            if hasAccess {
                url.stopAccessingSecurityScopedResource()
            }
        }

        let data: Data
        do {
            data = try await Task.detached(priority: .userInitiated) {
                try Data(contentsOf: url)
            }.value
        } catch {
            throw ReaderError.failedToReadFile(error.localizedDescription)
        }

        let checksum = Hashing.sha256(data)
        let extractionCacheKey = Hashing.sha256(
            "\(checksum)|\(settings.pdfExtractionMode.rawValue)|\(settings.minerUBackend.rawValue)|\(settings.minerUExecutablePath)"
        )
        if let cached = extractedPaperCache[extractionCacheKey] {
            return cached
        }

        let fileName = url.lastPathComponent
        if settings.pdfExtractionMode != .pdfKitOnly {
            statusMessage = "MinerU is reconstructing document layout, formulas, tables, and images..."
            isProgressIndeterminate = true

            do {
                let extraction = try await minerUService.extract(
                    pdfData: data,
                    originalFilename: fileName,
                    checksum: checksum,
                    configuredPath: settings.minerUExecutablePath,
                    backend: settings.minerUBackend
                )
                try Task.checkCancellation()
                isProgressIndeterminate = false
                let paper = try Self.buildPaper(
                    fromMinerUMarkdown: extraction.markdown,
                    resourceDirectory: extraction.resourceDirectoryURL,
                    name: fileName,
                    checksum: checksum
                )
                extractedPaperCache[extractionCacheKey] = paper
                return paper
            } catch is CancellationError {
                isProgressIndeterminate = false
                throw CancellationError()
            } catch {
                isProgressIndeterminate = false
                if settings.pdfExtractionMode == .minerUOnly {
                    throw error
                }

                statusMessage = "MinerU could not parse this PDF. Using the model-free PDFKit facsimile..."
                let paper = try await readWithPDFKit(
                    data: data,
                    fileName: fileName,
                    checksum: checksum,
                    fallbackWarning: error.localizedDescription
                )
                extractedPaperCache[extractionCacheKey] = paper
                return paper
            }
        }

        let paper = try await readWithPDFKit(
            data: data,
            fileName: fileName,
            checksum: checksum,
            fallbackWarning: nil
        )

        extractedPaperCache[extractionCacheKey] = paper
        return paper
    }

    private func readWithPDFKit(
        data: Data,
        fileName: String,
        checksum: String,
        fallbackWarning: String?
    ) async throws -> PaperDocument {
        statusMessage = "PDFKit is preserving the original pages without OCR..."
        isProgressIndeterminate = true
        defer { isProgressIndeterminate = false }

        var archive: PDFVisualArchive?
        var warnings = [fallbackWarning].compactMap { $0 }
        do {
            archive = try await Task.detached(priority: .userInitiated) {
                try PDFVisualArchiveService().archive(
                    pdfData: data,
                    checksum: checksum
                )
            }.value
            if let archive {
                let failedPageCount = archive.pageCount -
                    archive.renderedPageCount -
                    archive.omittedPageCount
                if archive.omittedPageCount > 0 {
                    warnings.append(
                        "For long-document safety, PNG previews were limited to the first \(archive.pageCount - archive.omittedPageCount) pages; the exact original PDF still contains every page."
                    )
                }
                if failedPageCount > 0 {
                    warnings.append(
                        "PDFKit could not generate preview images for \(failedPageCount) page(s); the exact original PDF is still preserved."
                    )
                }
            }
        } catch {
            warnings.append(error.localizedDescription)
        }

        statusMessage = "Extracting the PDF's selectable text layer without OCR..."
        let extractionWarning = warnings.isEmpty ? nil : warnings.joined(separator: " ")
        return try await Task.detached(priority: .userInitiated) {
            try Self.buildPaper(
                fromPDFData: data,
                name: fileName,
                checksum: checksum,
                visualArchive: archive,
                extractionWarning: extractionWarning
            )
        }.value
    }

    private func readTextInput(_ text: String) async throws -> PaperDocument {
        let trimmedInput = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedInput.isEmpty else {
            throw ReaderError.noInputText
        }

        let checksum = Hashing.sha256(trimmedInput)
        if let cached = extractedPaperCache[checksum] {
            return cached
        }

        let paper = try await Task.detached(priority: .userInitiated) {
            try Self.buildPaper(fromText: trimmedInput, name: "Pasted Text", checksum: checksum)
        }.value

        extractedPaperCache[checksum] = paper
        return paper
    }

    private func translateParagraph(_ paragraph: ParagraphResult, settings: AppSettings) async throws -> ParagraphTranslationSnapshot {
        let cacheKey = Hashing.sha256(
            "\(settings.ollamaBaseURL)|\(settings.translationModel)|\(settings.sourceLanguage.rawValue)|\(settings.targetLanguage.rawValue)|\(settings.maxParagraphChars)|\(paragraph.sourceMarkdown ?? paragraph.original)"
        )
        if let cached = paragraphTranslationCache[cacheKey] {
            return cached
        }

        if settings.sourceLanguage == settings.targetLanguage {
            let snapshot = ParagraphTranslationSnapshot(
                translation: paragraph.original,
                translationMarkdown: paragraph.sourceMarkdown,
                status: .ok,
                errorMessage: nil,
                chunkCount: 1
            )
            paragraphTranslationCache[cacheKey] = snapshot
            return snapshot
        }

        if let sourceMarkdown = paragraph.sourceMarkdown {
            let payload = AcademicMarkdownProcessor.protectForTranslation(sourceMarkdown)
            let chunks = TextProcessing.chunkParagraph(
                payload.text,
                maxChars: settings.maxParagraphChars
            )
            var translatedChunks: [String] = []

            do {
                for chunk in chunks {
                    try Task.checkCancellation()
                    translatedChunks.append(
                        try await ollamaClient.generate(
                            baseURL: settings.ollamaBaseURL,
                            model: settings.translationModel,
                            prompt: PromptLibrary.markdownTranslationPrompt(
                                for: chunk,
                                from: settings.sourceLanguage,
                                to: settings.targetLanguage
                            ),
                            systemPrompt: PromptLibrary.translationSystemPrompt(
                                targetLanguage: settings.targetLanguage
                            )
                        )
                    )
                }
            } catch is CancellationError {
                throw CancellationError()
            } catch {
                return ParagraphTranslationSnapshot(
                    translation: "",
                    translationMarkdown: nil,
                    status: .failed,
                    errorMessage: error.localizedDescription,
                    chunkCount: chunks.count
                )
            }

            do {
                let joined = translatedChunks.joined(
                    separator: sourceMarkdown.contains("\n") ? "\n" : " "
                )
                let restored = try AcademicMarkdownProcessor.restoreProtectedTokens(
                    in: joined,
                    from: payload
                )
                let snapshot = ParagraphTranslationSnapshot(
                    translation: AcademicMarkdownProcessor.plainText(from: restored),
                    translationMarkdown: restored,
                    status: .ok,
                    errorMessage: nil,
                    chunkCount: chunks.count
                )
                paragraphTranslationCache[cacheKey] = snapshot
                return snapshot
            } catch {
                return ParagraphTranslationSnapshot(
                    translation: "",
                    translationMarkdown: nil,
                    status: .failed,
                    errorMessage: error.localizedDescription,
                    chunkCount: chunks.count
                )
            }
        }

        let chunks = TextProcessing.chunkParagraph(paragraph.original, maxChars: settings.maxParagraphChars)
        var translatedChunks: [String] = []

        do {
            for chunk in chunks {
                try Task.checkCancellation()
                translatedChunks.append(try await translateChunk(chunk, settings: settings))
            }
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            return ParagraphTranslationSnapshot(
                translation: "",
                translationMarkdown: nil,
                status: .failed,
                errorMessage: error.localizedDescription,
                chunkCount: chunks.count
            )
        }

        let snapshot = ParagraphTranslationSnapshot(
            translation: translatedChunks.joined(separator: " "),
            translationMarkdown: nil,
            status: .ok,
            errorMessage: nil,
            chunkCount: chunks.count
        )

        paragraphTranslationCache[cacheKey] = snapshot
        return snapshot
    }

    private func translateChunk(_ chunk: String, settings: AppSettings) async throws -> String {
        if settings.sourceLanguage == settings.targetLanguage {
            return chunk
        }

        let cacheKey = Hashing.sha256(
            "\(settings.ollamaBaseURL)|\(settings.translationModel)|\(settings.sourceLanguage.rawValue)|\(settings.targetLanguage.rawValue)|\(chunk)"
        )
        if let cached = chunkTranslationCache[cacheKey] {
            return cached
        }

        let translation = try await ollamaClient.generate(
            baseURL: settings.ollamaBaseURL,
            model: settings.translationModel,
            prompt: PromptLibrary.translationPrompt(
                for: chunk,
                from: settings.sourceLanguage,
                to: settings.targetLanguage
            ),
            systemPrompt: PromptLibrary.translationSystemPrompt(targetLanguage: settings.targetLanguage)
        )

        chunkTranslationCache[cacheKey] = translation
        return translation
    }

    private func translateConnectedPaper(
        _ paper: PaperDocument,
        settings: AppSettings,
        batches: [String],
        onStatusChange: @escaping @MainActor (String) -> Void,
        onBatchFinished: @escaping @MainActor () -> Void
    ) async throws -> ConnectedTranslationResult {
        let effectiveBatches = batches.isEmpty
            ? TextProcessing.buildTextBatches(paper.paragraphs, maxChars: TextProcessing.connectedTranslationBatchChars)
            : batches

        guard !effectiveBatches.isEmpty else {
            return ConnectedTranslationResult(
                sourceLanguage: settings.sourceLanguage,
                targetLanguage: settings.targetLanguage,
                text: "",
                batchCount: 0,
                failedBatchCount: 0
            )
        }

        var translatedBatches: [String] = []
        var failedBatchCount = 0

        for (index, batch) in effectiveBatches.enumerated() {
            try Task.checkCancellation()
            onStatusChange("Generating connected full translation \(index + 1) of \(effectiveBatches.count)")

            do {
                let translation = try await self.ollamaClient.generate(
                    baseURL: settings.ollamaBaseURL,
                    model: settings.translationModel,
                    prompt: PromptLibrary.connectedTranslationPrompt(
                        for: batch,
                        from: settings.sourceLanguage,
                        to: settings.targetLanguage
                    ),
                    systemPrompt: PromptLibrary.translationSystemPrompt(targetLanguage: settings.targetLanguage)
                )
                translatedBatches.append(translation)
            } catch is CancellationError {
                throw CancellationError()
            } catch {
                failedBatchCount += 1
                translatedBatches.append("[Connected translation failed for batch \(index + 1)] \(error.localizedDescription)")
            }

            onBatchFinished()
        }

        return ConnectedTranslationResult(
            sourceLanguage: settings.sourceLanguage,
            targetLanguage: settings.targetLanguage,
            text: translatedBatches.joined(separator: "\n\n"),
            batchCount: effectiveBatches.count,
            failedBatchCount: failedBatchCount
        )
    }

    nonisolated private static func buildPaper(
        fromPDFData data: Data,
        name: String,
        checksum: String,
        visualArchive: PDFVisualArchive?,
        extractionWarning: String?
    ) throws -> PaperDocument {
        let rawText: String
        do {
            rawText = try PDFTextExtractor().extractText(from: data)
        } catch {
            guard let visualArchive else { throw error }
            return visualOnlyPaper(
                name: name,
                checksum: checksum,
                visualArchive: visualArchive,
                extractionWarning: joinedWarnings(
                    extractionWarning,
                    "No selectable text layer was found. The original pages are available, but translation requires selectable text or an OCR parser."
                )
            )
        }

        let cleanedText = TextProcessing.cleanExtractedText(rawText)
        let paragraphs = TextProcessing.splitIntoParagraphs(cleanedText)
        do {
            return try buildPaper(
                name: name,
                checksum: checksum,
                paragraphs: paragraphs,
                extractionEngine: .pdfKit,
                extractionWarning: extractionWarning,
                sourceMarkdown: visualArchive?.markdown,
                markdownResourceDirectory: visualArchive?.resourceDirectoryURL.path
            )
        } catch {
            guard let visualArchive else { throw error }
            return visualOnlyPaper(
                name: name,
                checksum: checksum,
                visualArchive: visualArchive,
                extractionWarning: joinedWarnings(
                    extractionWarning,
                    "No reliable body paragraphs were found in the selectable text layer. Visual preview and export remain available."
                )
            )
        }
    }

    nonisolated private static func buildPaper(
        fromMinerUMarkdown markdown: String,
        resourceDirectory: URL,
        name: String,
        checksum: String
    ) throws -> PaperDocument {
        let parsed = AcademicMarkdownProcessor.parse(markdown)
        let structured = AcademicMarkdownProcessor.assignParagraphs(in: parsed)
        guard !structured.paragraphs.isEmpty else {
            throw ReaderError.noParagraphsDetected
        }

        return PaperDocument(
            name: name,
            checksum: checksum,
            cleanedText: structured.paragraphs.joined(separator: "\n\n"),
            paragraphs: structured.paragraphs,
            excludedReferenceParagraphs: structured.referenceParagraphs,
            referenceSectionTitle: structured.referenceHeading,
            sourceMarkdown: markdown,
            markdownResourceDirectory: resourceDirectory.path,
            markdownSegments: structured.segments,
            extractionEngine: .minerU,
            extractionWarning: nil
        )
    }

    nonisolated private static func buildPaper(
        fromText text: String,
        name: String,
        checksum: String
    ) throws -> PaperDocument {
        let normalizedInput = text.replacingOccurrences(of: "\r", with: "\n")
        let paragraphs: [String]

        if normalizedInput.contains("\n\n") {
            let cleanedText = TextProcessing.cleanExtractedText(normalizedInput)
            paragraphs = TextProcessing.postProcessParagraphs(
                TextProcessing.splitIntoParagraphs(cleanedText)
            )
        } else if normalizedInput.contains("\n") {
            paragraphs = TextProcessing.rebuildParagraphs(fromPageText: normalizedInput)
        } else {
            paragraphs = TextProcessing.postProcessParagraphs([normalizedInput])
        }

        return try buildPaper(
            name: name,
            checksum: checksum,
            paragraphs: paragraphs,
            extractionEngine: .pastedText,
            extractionWarning: nil
        )
    }

    nonisolated private static func buildPaper(
        name: String,
        checksum: String,
        paragraphs: [String],
        extractionEngine: DocumentExtractionEngine,
        extractionWarning: String?,
        sourceMarkdown: String? = nil,
        markdownResourceDirectory: String? = nil
    ) throws -> PaperDocument {
        guard !paragraphs.isEmpty else {
            throw ReaderError.noParagraphsDetected
        }

        let trimmedPaper = TextProcessing.excludeReferenceSection(from: paragraphs)
        guard !trimmedPaper.bodyParagraphs.isEmpty else {
            throw ReaderError.noParagraphsDetected
        }

        let bodyText = trimmedPaper.bodyParagraphs.joined(separator: "\n\n")
        return PaperDocument(
            name: name,
            checksum: checksum,
            cleanedText: bodyText,
            paragraphs: trimmedPaper.bodyParagraphs,
            excludedReferenceParagraphs: trimmedPaper.referenceParagraphs,
            referenceSectionTitle: trimmedPaper.heading,
            sourceMarkdown: sourceMarkdown,
            markdownResourceDirectory: markdownResourceDirectory,
            extractionEngine: extractionEngine,
            extractionWarning: extractionWarning
        )
    }

    nonisolated private static func visualOnlyPaper(
        name: String,
        checksum: String,
        visualArchive: PDFVisualArchive,
        extractionWarning: String?
    ) -> PaperDocument {
        PaperDocument(
            name: name,
            checksum: checksum,
            cleanedText: "",
            paragraphs: [],
            excludedReferenceParagraphs: [],
            referenceSectionTitle: nil,
            sourceMarkdown: visualArchive.markdown,
            markdownResourceDirectory: visualArchive.resourceDirectoryURL.path,
            extractionEngine: .pdfKit,
            extractionWarning: extractionWarning
        )
    }

    nonisolated private static func joinedWarnings(
        _ first: String?,
        _ second: String
    ) -> String {
        [first, second]
            .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .joined(separator: " ")
    }

    nonisolated private static func makeParagraphResults(for paper: PaperDocument) -> [ParagraphResult] {
        let sourceMarkdownByParagraphID = Dictionary(
            uniqueKeysWithValues: (paper.markdownSegments ?? []).compactMap { segment -> (Int, String)? in
                guard let paragraphID = segment.paragraphID else { return nil }
                return (paragraphID, segment.source)
            }
        )

        return paper.paragraphs.enumerated().map { index, paragraph in
            let paragraphID = index + 1
            return ParagraphResult(
                id: paragraphID,
                original: paragraph,
                sourceMarkdown: sourceMarkdownByParagraphID[paragraphID]
            )
        }
    }

    private func normalizedManualParagraphs(from text: String) -> [String] {
        let normalized = text
            .replacingOccurrences(of: "\r", with: "\n")
            .replacingOccurrences(of: #"\n{3,}"#, with: "\n\n", options: .regularExpression)

        return normalized
            .components(separatedBy: "\n\n")
            .compactMap { block in
                let flattened = block
                    .replacingOccurrences(of: #"\s*\n\s*"#, with: " ", options: .regularExpression)
                    .replacingOccurrences(of: #"[ \t]{2,}"#, with: " ", options: .regularExpression)
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                return flattened.isEmpty ? nil : flattened
            }
    }

    private func applyParagraphMutation(
        _ paragraphs: [String],
        selectedIndex: Int?,
        recordUndo: Bool = true,
        message: String
    ) {
        guard let paper = loadedPaper, !paragraphs.isEmpty else { return }
        guard !paper.hasStructuredMarkdown else {
            statusMessage = "MinerU Markdown controls this document's layout. Edit the exported Markdown instead of reflowing analysis blocks."
            return
        }

        if recordUndo {
            let oldSelectedIndex = selectedParagraphID.flatMap { selectedID in
                paragraphResults.firstIndex(where: { $0.id == selectedID })
            }
            paragraphUndoStack.append(
                ParagraphEditSnapshot(
                    paragraphs: paragraphResults.map(\.original),
                    selectedIndex: oldSelectedIndex
                )
            )
            if paragraphUndoStack.count > 20 {
                paragraphUndoStack.removeFirst()
            }
        }
        canUndoParagraphEdit = !paragraphUndoStack.isEmpty

        let previousResults = paragraphResults
        let updatedResults = paragraphs.enumerated().map { index, paragraph -> ParagraphResult in
            guard let reusable = previousResults.first(where: { $0.original == paragraph }) else {
                return ParagraphResult(id: index + 1, original: paragraph)
            }

            return ParagraphResult(
                id: index + 1,
                original: paragraph,
                sourceMarkdown: reusable.sourceMarkdown,
                translation: reusable.translation,
                translationMarkdown: reusable.translationMarkdown,
                status: reusable.status,
                errorMessage: reusable.errorMessage,
                chunkCount: reusable.chunkCount
            )
        }

        let bodyText = paragraphs.joined(separator: "\n\n")
        let updatedPaper = PaperDocument(
            name: paper.name,
            checksum: Hashing.sha256("\(paper.name)|\(bodyText)"),
            cleanedText: bodyText,
            paragraphs: paragraphs,
            excludedReferenceParagraphs: paper.excludedReferenceParagraphs,
            referenceSectionTitle: paper.referenceSectionTitle
        )

        loadedPaper = updatedPaper
        paragraphResults = updatedResults
        if let selectedIndex, paragraphs.indices.contains(selectedIndex) {
            selectedParagraphID = selectedIndex + 1
        } else {
            selectedParagraphID = paragraphResults.first?.id
        }
        connectedTranslation = nil
        summaries = nil
        explanationText = ""
        progressValue = 0
        restoreCachedOutputsIfAvailable(for: updatedPaper)
        statusMessage = message + " Re-run translation for changed paragraphs."
        persistWorkspace()
    }

    private func handleSettingsChange(from oldSettings: AppSettings) {
        guard let paper = loadedPaper else { return }

        let endpointChanged = settings.ollamaBaseURL != oldSettings.ollamaBaseURL
        let directionChanged =
            settings.sourceLanguage != oldSettings.sourceLanguage ||
            settings.targetLanguage != oldSettings.targetLanguage
        let paragraphTranslationChanged =
            endpointChanged ||
            directionChanged ||
            settings.translationModel != oldSettings.translationModel ||
            settings.maxParagraphChars != oldSettings.maxParagraphChars
        let connectedTranslationChanged =
            endpointChanged ||
            directionChanged ||
            settings.translationModel != oldSettings.translationModel

        if paragraphTranslationChanged {
            paragraphResults = Self.makeParagraphResults(for: paper)
        }

        if connectedTranslationChanged {
            connectedTranslation = nil
        }

        if connectedTranslationChanged || settings.summaryModel != oldSettings.summaryModel {
            summaries = nil
        }

        if endpointChanged || settings.explainModel != oldSettings.explainModel {
            explanationText = ""
        }

        if endpointChanged ||
            directionChanged ||
            settings.quickLookupModel != oldSettings.quickLookupModel {
            selectionTask?.cancel()
            selectionTranslation = ""
            selectionExplanation = ""
            selectionLookupStatus = ""
            selectionLookupError = nil
            isSelectionLookupBusy = false
        }

        restoreCachedOutputsIfAvailable(for: paper)
    }

    private func translationCacheKey(for paper: PaperDocument, settings: AppSettings) -> String {
        Hashing.sha256(
            "\(paper.checksum)|\(settings.ollamaBaseURL)|\(settings.translationModel)|\(settings.sourceLanguage.rawValue)|\(settings.targetLanguage.rawValue)|\(settings.maxParagraphChars)"
        )
    }

    private func connectedTranslationCacheKey(for paper: PaperDocument, settings: AppSettings) -> String {
        Hashing.sha256(
            "\(paper.checksum)|\(settings.ollamaBaseURL)|\(settings.translationModel)|\(settings.sourceLanguage.rawValue)|\(settings.targetLanguage.rawValue)|connected|rich-v2:\(paper.hasStructuredMarkdown):\(paper.hasFacsimileMarkdown)"
        )
    }

    private func restoreCachedOutputsIfAvailable(for paper: PaperDocument) {
        let translationKey = translationCacheKey(for: paper, settings: settings)
        if let cachedTranslations = paperTranslationCache[translationKey] {
            paragraphResults = cachedTranslations
        }

        let connectedKey = connectedTranslationCacheKey(for: paper, settings: settings)
        connectedTranslation = connectedTranslationCache[connectedKey]

        let summaryKey = Hashing.sha256(
            "\(paper.checksum)|\(settings.ollamaBaseURL)|\(settings.summaryModel)|\(settings.translationModel)|\(settings.sourceLanguage.rawValue)|\(settings.targetLanguage.rawValue)"
        )
        summaries = summaryCache[summaryKey]

        restoreCachedExplanationIfAvailable(for: paper)
    }

    private func restoreCachedExplanationIfAvailable(for paper: PaperDocument) {
        guard let selectedParagraphID else { return }
        let cacheKey = Hashing.sha256(
            "\(paper.checksum)|\(settings.ollamaBaseURL)|\(settings.explainModel)|\(selectedParagraphID)|\(explanationLanguage.rawValue)"
        )
        if let cachedExplanation = explanationCache[cacheKey] {
            explanationText = cachedExplanation
        }
    }

    private func buildMarkdownExport(for paper: PaperDocument) -> String {
        var lines: [String] = ["# \(paper.name)", ""]

        if paper.excludedReferenceCount > 0 {
            lines.append("> The reference section was excluded from translation.")
            lines.append("")
        }

        if let summaries {
            lines.append("## Whole-paper summary (\(summaries.sourceLanguage.displayName))")
            lines.append("")
            lines.append(summaries.sourceSummary)
            lines.append("")
            lines.append("## Whole-paper summary (\(summaries.targetLanguage.displayName))")
            lines.append("")
            lines.append(summaries.targetSummary)
            lines.append("")
        }

        if let connectedTranslation, !connectedTranslation.text.isEmpty {
            lines.append("## Connected Full Translation (\(connectedTranslation.targetLanguage.displayName))")
            lines.append("")

            if connectedTranslation.failedBatchCount > 0 {
                lines.append("> \(connectedTranslation.failedBatchCount) connected-translation batch(es) failed and were marked inline below.")
                lines.append("")
            }

            lines.append(connectedTranslation.text)
            lines.append("")
        }

        for paragraph in paragraphResults {
            lines.append("## Paragraph \(paragraph.id)")
            lines.append("")
            if bookmarkedParagraphIDs.contains(paragraph.id) {
                lines.append("> Bookmarked in PaperBridge")
                lines.append("")
            }
            lines.append("### Original \(settings.sourceLanguage.displayName)")
            lines.append("")
            lines.append(paragraph.original)
            lines.append("")
            lines.append("### Translation (\(settings.targetLanguage.displayName))")
            lines.append("")

            if paragraph.status == .ok {
                lines.append(paragraph.translation)
            } else if let errorMessage = paragraph.errorMessage {
                lines.append("[Translation failed] \(errorMessage)")
            } else {
                lines.append("[Translation unavailable]")
            }

            lines.append("")

            let paragraphAnnotations = annotations
                .filter { $0.paragraphID == paragraph.id }
                .sorted { $0.createdAt < $1.createdAt }
            if !paragraphAnnotations.isEmpty {
                lines.append("### Highlights and Notes")
                lines.append("")
                for annotation in paragraphAnnotations {
                    let quote = annotation.quote
                        .replacingOccurrences(of: "\n", with: " ")
                        .trimmingCharacters(in: .whitespacesAndNewlines)
                    lines.append("- **\(annotation.side.displayName):** “\(quote)”")
                    let note = annotation.note.trimmingCharacters(in: .whitespacesAndNewlines)
                    if !note.isEmpty {
                        lines.append("  - Note: \(note)")
                    }
                }
                lines.append("")
            }
        }

        return lines.joined(separator: "\n")
    }

    func persistWorkspace() {
        guard !isRestoringWorkspace, let paper = loadedPaper else { return }

        let workspace = PersistedWorkspace(
            settings: settings,
            paper: paper,
            paragraphResults: paragraphResults,
            connectedTranslation: connectedTranslation,
            summaries: summaries,
            selectedParagraphID: selectedParagraphID,
            displayMode: displayMode,
            workspaceMode: workspaceMode,
            explanationLanguage: explanationLanguage,
            explanationText: explanationText,
            annotations: annotations,
            bookmarkedParagraphIDs: bookmarkedParagraphIDs,
            isInspectorPresented: isInspectorPresented
        )
        workspaceStore.saveWorkspace(workspace)
    }

    private func presentError(_ message: String?) {
        guard let message, !message.isEmpty else { return }
        errorMessage = message
        statusMessage = message
    }

    private func syncModelSelections(with models: [String]) {
        guard !models.isEmpty else { return }

        let preferredTranslation = models.contains("translategemma:12b") ? "translategemma:12b" : models[0]
        var updatedSettings = settings
        updatedSettings.translationModel = selectModel(
            current: updatedSettings.translationModel,
            preferred: preferredTranslation,
            available: models
        )
        updatedSettings.summaryModel = selectModel(
            current: updatedSettings.summaryModel,
            preferred: updatedSettings.translationModel,
            available: models
        )
        updatedSettings.explainModel = selectModel(
            current: updatedSettings.explainModel,
            preferred: updatedSettings.translationModel,
            available: models
        )
        updatedSettings.quickLookupModel = selectModel(
            current: updatedSettings.quickLookupModel,
            preferred: updatedSettings.explainModel,
            available: models
        )
        settings = updatedSettings
    }

    private func selectModel(current: String, preferred: String, available: [String]) -> String {
        if available.contains(current) {
            return current
        }

        if available.contains(preferred) {
            return preferred
        }

        return available[0]
    }
}
