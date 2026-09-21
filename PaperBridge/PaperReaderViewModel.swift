import AppKit
import Foundation
import SwiftUI

@MainActor
final class PaperReaderViewModel: ObservableObject {
    @Published var settings = AppSettings() {
        didSet {
            guard settings != oldValue else { return }
            guard !isRestoringWorkspace else { return }
            handleSettingsChange(from: oldValue)
            if !isRestoringWorkspace {
                workspaceStore.saveSettings(settings)
                persistWorkspace()
            }
        }
    }
    @Published var loadedPaper: PaperDocument? {
        didSet {
            readingGuide = loadedPaper.map(ReadingGuideBuilder.build) ?? []
            paperSections = loadedPaper.map(PaperReadingAnalysis.sections) ?? []
            qualityIssues = loadedPaper.map(PaperReadingAnalysis.qualityIssues) ?? []
        }
    }
    @Published private(set) var readingGuide: [ReadingGuideEntry] = []
    @Published private(set) var paperSections: [PaperSection] = []
    @Published private(set) var qualityIssues: [ParagraphQualityIssue] = []
    @Published var libraryEntries: [LibraryEntry] = []
    @Published var glossary: [SavedTerm] = []
    @Published var isLibraryPresented = false
    @Published var isGlossaryPresented = false
    @Published var isQuickLookupPresented = false
    @Published private(set) var translationQueue: [Int] = []
    @Published private(set) var isTranslatingParagraphs = false
    private var translationRunID: UUID?
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
    @Published var isOllamaReachable = false
    @Published var ollamaInstallation = OllamaInstallationStatus(applicationURL: nil)
    @Published var isInstallingOllama = false
    @Published var ollamaInstallProgress: Double?
    @Published var ollamaInstallStatus = "Check whether Ollama is installed on this Mac."
    @Published var ollamaInstallError: String?
    @Published var activeModelDownloadID: String?
    @Published var lastModelDownloadID: String?
    @Published var modelDownloadProgress: Double?
    @Published var modelDownloadStatus = "Choose a local model to download."
    @Published var modelDownloadError: String?
    @Published var minerUStatus = MinerUToolStatus(
        executablePath: nil,
        message: "MinerU status has not been checked yet."
    )
    @Published var isRefreshingMinerU = false
    @Published var isInstallingMinerU = false
    @Published var minerUInstallProgress: Double?
    @Published var minerUInstallStatus = "Install MinerU in an isolated environment managed by PaperBridge."
    @Published var minerUInstallError: String?
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
    @Published var annotationNavigationRequest: AnnotationNavigationRequest?
    @Published var annotationUndoStack: [[PaperAnnotation]] = []
    @Published var searchFocusRequest: UUID?
    @Published var workspaceSaveError: String?
    @Published var isWorkspaceSaving = false
    @Published var isNoteSavePending = false
    var noteSaveTask: Task<Void, Never>?
    var noteEditingIdentity: String?
    private var workspaceSaveRequestID = UUID()
    @Published var readingBackHistory: [ReadingLocation] = []
    @Published var readingForwardHistory: [ReadingLocation] = []
    @Published var readingRestorationID = UUID()
    var readingPositions: [String: ReadingPosition] = [:]
    private var positionSaveTask: Task<Void, Never>?

    let ollamaClient: OllamaClient
    let minerUService = MinerUService()
    let localToolInstaller = LocalToolInstaller()
    let workspaceStore: WorkspaceStore
    private let markdownBundleExporter = MarkdownBundleExporter()
    private var activeTask: Task<Void, Never>?
    private var activeTaskID: UUID?
    private var modelRefreshTask: Task<Void, Never>?
    private var minerUStatusTask: Task<Void, Never>?
    var ollamaInstallTask: Task<Void, Never>?
    var modelPullTask: Task<Void, Never>?
    var minerUInstallTask: Task<Void, Never>?
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

    init(workspaceStore: WorkspaceStore = WorkspaceStore(), ollamaClient: OllamaClient = OllamaClient()) {
        self.workspaceStore = workspaceStore
        self.ollamaClient = ollamaClient
        workspaceStore.onSaveStatus = { [weak self] error in
            Task { @MainActor [weak self] in self?.workspaceSaveError = error }
        }
        isRestoringWorkspace = true
        defer { isRestoringWorkspace = false }

        if let savedSettings = workspaceStore.loadSettings() {
            settings = savedSettings
        }
        libraryEntries = workspaceStore.loadLibrary()
        glossary = workspaceStore.loadGlossary()

        guard let workspace = workspaceStore.loadLastWorkspace() else { return }

        loadedPaper = workspace.paper
        readingGuide = ReadingGuideBuilder.build(for: workspace.paper)
        paperSections = PaperReadingAnalysis.sections(in: workspace.paper)
        qualityIssues = PaperReadingAnalysis.qualityIssues(in: workspace.paper)
        readingPositions = workspace.readingPositions ?? [:]
        annotations = workspace.annotations
        bookmarkedParagraphIDs = workspace.bookmarkedParagraphIDs
        selectedParagraphID = workspace.selectedParagraphID
        displayMode = workspace.displayMode
        workspaceMode = workspace.workspaceMode
        explanationLanguage = workspace.explanationLanguage
        isInspectorPresented = workspace.isInspectorPresented

        paragraphResults = Self.makeParagraphResults(for: workspace.paper)
        seedOutputCaches(from: workspace, for: workspace.paper)
        restoreCachedOutputsIfAvailable(for: workspace.paper)

        statusMessage = "Restored \(workspace.paper.name) from local PaperBridge storage."
    }

    deinit {
        noteSaveTask?.cancel()
        positionSaveTask?.cancel()
        activeTask?.cancel()
        modelRefreshTask?.cancel()
        minerUStatusTask?.cancel()
        ollamaInstallTask?.cancel()
        modelPullTask?.cancel()
        minerUInstallTask?.cancel()
        selectionTask?.cancel()
        minerUService.cancelCurrentRun()
        localToolInstaller.cancelAll()
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

    var translationSetupMessage: String? {
        if settings.sourceLanguage == settings.targetLanguage { return nil }
        if !isOllamaReachable { return "Open Ollama to translate. Source reading, highlights, and notes work without AI." }
        if !isModelInstalled(settings.translationModel) { return "Install or select \(settings.translationModel) in Local AI settings to translate." }
        return nil
    }

    var primarySetupMessage: String? {
        guard canPerformPrimaryWorkspaceAction else { return nil }
        if workspaceMode == .summary {
            if !isOllamaReachable { return "AI summaries are optional. Open Ollama and choose a summary model, or use the source reading map now." }
            if !isModelInstalled(settings.summaryModel) { return "Install or select a summary model. The reading map below needs no model." }
        }
        return translationSetupMessage
    }

    func openReadingPassage(_ entry: ReadingGuideEntry) {
        guard let paragraph = paragraphResults.first(where: { $0.id == entry.paragraphID }),
              paragraph.original == entry.excerpt else { return }
        navigateToParagraph(entry.paragraphID, revealSource: true)
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

    var isPullingModel: Bool {
        activeModelDownloadID != nil
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
        let paper: PaperDocument
        let results: [ParagraphResult]
        let selectedIndex: Int?
        let mapping: ParagraphMutationMapping
        let annotations: [PaperAnnotation]
        let bookmarks: Set<Int>
        let positions: [String: ReadingPosition]
        let summaries: SummaryResult?
        let connectedTranslation: ConnectedTranslationResult?
    }

    func showImporter() {
        guard !isBusy else { return }
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

    func navigateToParagraph(_ paragraphID: Int, revealSource: Bool = false) {
        guard paragraphResults.contains(where: { $0.id == paragraphID }) else { return }
        if workspaceMode != .reader || !paragraphSearchText.isEmpty ||
            readingPositions["reader"]?.readerItemID != "paragraph-\(paragraphID)" ||
            (revealSource && displayMode == .translationOnly) {
            recordReadingJump()
        }
        workspaceMode = .reader
        if revealSource && displayMode == .translationOnly { displayMode = .bilingual }
        paragraphSearchText = ""
        selectedParagraphID = paragraphID
        readingPositions["reader"] = ReadingPosition(paragraphID: paragraphID, readerItemID: "paragraph-\(paragraphID)")
        navigationRequest = ParagraphNavigationRequest(paragraphID: paragraphID)
        persistWorkspace()
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
        noteSaveTask?.cancel()
        noteSaveTask = nil
        isNoteSavePending = false
        noteEditingIdentity = nil
        resetReadingHistory()
        workspaceSaveRequestID = UUID()
        isWorkspaceSaving = false
        activeTask?.cancel()
        activeTaskID = nil
        translationRunID = nil
        translationQueue = []
        isTranslatingParagraphs = false
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
        libraryEntries = []
        glossary = []
        isLibraryPresented = false
        isGlossaryPresented = false
        isQuickLookupPresented = false
        readingPositions = [:]
        positionSaveTask?.cancel()
        annotationUndoStack = []
        annotationNavigationRequest = nil
        navigationRequest = nil
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
                self.isOllamaReachable = true
                self.ollamaInstallation = self.localToolInstaller.ollamaInstallationStatus()
                self.ollamaInstallStatus = "Ollama is installed and its local API is ready."
                if !self.isPullingModel {
                    self.modelDownloadError = nil
                    self.modelDownloadStatus = sortedModels.isEmpty
                        ? "No local models are installed yet."
                        : "\(sortedModels.count) local model\(sortedModels.count == 1 ? "" : "s") ready."
                }
                self.syncModelSelections(with: sortedModels)
            } catch is CancellationError {
                self.isRefreshingModels = false
                return
            } catch {
                self.availableModels = []
                self.isOllamaReachable = false
                self.ollamaInstallation = self.localToolInstaller.ollamaInstallationStatus()
                if self.ollamaInstallation.isInstalled && !self.isInstallingOllama {
                    self.ollamaInstallStatus = "Ollama is installed but its local service is not connected."
                }
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
            let status = self.minerUService.status(configuredPath: configuredPath)
            guard !Task.isCancelled else {
                self.isRefreshingMinerU = false
                return
            }
            self.minerUStatus = status
            if status.isAvailable && !self.isInstallingMinerU {
                self.minerUInstallStatus = status.message
            }
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
        activeTaskID = nil
        translationRunID = nil
        translationQueue = []
        isTranslatingParagraphs = false
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

    func reextractPDFAsNewCopy() {
        guard !isBusy else { return }
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.pdf]
        panel.allowsMultipleSelection = false
        panel.message = "Choose the original PDF to parse with the current parser settings. A separate library copy will be created; saved edits, translations, and notes will not be replaced."
        panel.prompt = "Extract New Copy"
        panel.begin { [weak self] response in
            guard response == .OK, let url = panel.url else { return }
            self?.loadPDF(from: url, asNewCopy: true)
        }
    }

    func loadPDF(from url: URL, asNewCopy: Bool = false) {
        startTask(initialStatus: "Loading PDF...") {
            let paper = try await self.readPaper(from: url, asNewCopy: asNewCopy)
            try Task.checkCancellation()
            self.applyLoadedPaper(paper)
        }
    }

    func loadTextInput() {
        startTask(initialStatus: "Preparing pasted text...") {
            let paper = try await self.readTextInput(self.manualInputText)
            try Task.checkCancellation()
            self.applyLoadedPaper(paper)
        }
    }

    func loadSamplePaper() {
        guard loadedPaper == nil, !isBusy else { return }
        let paragraphs = ReadingGuideBuilder.sampleParagraphs
        let text = paragraphs.joined(separator: "\n\n")
        applyLoadedPaper(PaperDocument(name: "Welcome to PaperBridge (practice sample)",
            checksum: Hashing.sha256(text), cleanedText: text, paragraphs: paragraphs,
            excludedReferenceParagraphs: [], referenceSectionTitle: nil))
        statusMessage = "Practice sample loaded. This is fictional tutorial text, not a published study. No model has been called."
    }

    func translatePaper(paragraphIDs: [Int]? = nil) {
        guard let paper = loadedPaper else {
            presentError(ReaderError.noPaperLoaded.localizedDescription)
            return
        }

        let requestedIDs = Set(paragraphIDs ?? paragraphResults.map(\.id))
        guard !requestedIDs.isEmpty, !isBusy else { return }
        startTask(initialStatus: "Checking Ollama model...") {
            let runID = UUID()
            self.translationRunID = runID
            self.isTranslatingParagraphs = true
            defer {
                if self.translationRunID == runID {
                    self.isTranslatingParagraphs = false
                    self.translationQueue = []
                    self.translationRunID = nil
                }
            }
            let settings = self.settings
            let cacheKey = self.translationCacheKey(for: paper, settings: settings)

            if let cached = self.paperTranslationCache[cacheKey], cached.allSatisfy({ $0.status == .ok }) {
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
            self.translationQueue = workingResults.filter { requestedIDs.contains($0.id) && $0.status != .ok }.map(\.id)
            let total = self.translationQueue.count
            var completed = 0
            guard total > 0 else {
                self.statusMessage = "This translation range is already complete."
                self.progressValue = 1
                return
            }

            if settings.sourceLanguage != settings.targetLanguage {
                try await self.ollamaClient.ensureModelAvailable(
                    baseURL: settings.ollamaBaseURL,
                    model: settings.translationModel
                )
            }

            while !self.translationQueue.isEmpty {
                try Task.checkCancellation()
                let id = self.translationQueue.removeFirst()
                guard let index = workingResults.firstIndex(where: { $0.id == id }) else { continue }
                self.statusMessage = "Translating paragraph \(id) · \(completed + 1) of \(total) in this range"
                let snapshot = try await self.translateParagraph(
                    workingResults[index],
                    settings: settings
                )
                try Task.checkCancellation()

                workingResults[index].translation = snapshot.translation
                workingResults[index].translationMarkdown = snapshot.translationMarkdown
                workingResults[index].status = snapshot.status
                workingResults[index].errorMessage = snapshot.errorMessage
                workingResults[index].chunkCount = snapshot.chunkCount

                self.paragraphResults = workingResults
                self.paperTranslationCache[cacheKey] = workingResults
                completed += 1
                self.progressValue = Double(completed) / Double(total)
                if completed.isMultiple(of: 5) || self.translationQueue.isEmpty {
                    self.persistWorkspace()
                }
            }

            self.paperTranslationCache[cacheKey] = workingResults
            self.progressValue = 1

            let failures = workingResults.filter { requestedIDs.contains($0.id) && $0.status == .failed }.count
            if failures > 0 {
                self.statusMessage = "Paragraph translation finished. \(failures) paragraph\(failures == 1 ? "" : "s") failed and can be retried individually."
            } else if settings.sourceLanguage == settings.targetLanguage {
                self.statusMessage = "Source and target languages match, so the original text was reused."
            } else {
                self.statusMessage = "Translation range finished. \(self.translatedCount) of \(workingResults.count) paper blocks are translated."
            }
            self.persistWorkspace()
        }
    }

    func prioritizeSection(_ section: PaperSection) {
        guard isTranslatingParagraphs else { return }
        let ids = Set(section.paragraphIDs)
        translationQueue = translationQueue.filter { ids.contains($0) } + translationQueue.filter { !ids.contains($0) }
        statusMessage = "\(section.title) will be translated next after the current paragraph. Only queued blocks are reordered."
    }

    func generateConnectedTranslation() {
        guard let paper = loadedPaper else {
            presentError(ReaderError.noPaperLoaded.localizedDescription)
            return
        }

        startTask(initialStatus: "Preparing connected full translation...") {
            let settings = self.settings
            let cacheKey = self.connectedTranslationCacheKey(for: paper, settings: settings)

            if let cached = self.connectedTranslationCache[cacheKey], cached.failedBatchCount == 0 {
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
                        try Task.checkCancellation()
                        workingResults[index].translation = snapshot.translation
                        workingResults[index].translationMarkdown = snapshot.translationMarkdown
                        workingResults[index].status = snapshot.status
                        workingResults[index].errorMessage = snapshot.errorMessage
                        workingResults[index].chunkCount = snapshot.chunkCount
                        self.paragraphResults = workingResults
                        self.paperTranslationCache[self.translationCacheKey(for: paper, settings: settings)] = workingResults
                        if index.isMultiple(of: 5) { self.persistWorkspace() }
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
                guard !Task.isCancelled else { return }
                self.statusMessage = status
            } onBatchFinished: {
                guard !Task.isCancelled else { return }
                completedBatches += 1
                self.progressValue = Double(completedBatches) / Double(max(batches.count, 1))
            }
            try Task.checkCancellation()

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
            try Task.checkCancellation()
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

            if let cached = self.summaryCache[cacheKey], cached.claims != nil {
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

            let batches = SummaryEvidence.sourceBatches(paper.paragraphs)
            var claims: [SummaryClaim] = []
            let totalSteps = max(batches.count + 1, 1)

            for (index, batch) in batches.enumerated() {
                try Task.checkCancellation()
                self.statusMessage = "Summarizing batch \(index + 1) of \(batches.count)"

                let partial = try await self.ollamaClient.generate(
                    baseURL: settings.ollamaBaseURL,
                    model: settings.summaryModel,
                    prompt: SummaryEvidence.prompt(batch, language: settings.sourceLanguage),
                    systemPrompt: PromptLibrary.summarySystemPrompt
                )

                try Task.checkCancellation()
                claims += SummaryEvidence.parse(partial, paper: paper, providedText: batch)
                // Bound the rolling summary instead of sending a whole long paper back to the model.
                if claims.count > 6 {
                    let candidates = claims
                    let merged = try await self.ollamaClient.generate(
                        baseURL: settings.ollamaBaseURL, model: settings.summaryModel,
                        prompt: SummaryEvidence.prompt(SummaryEvidence.serialized(candidates),
                                                       language: settings.sourceLanguage, merging: true),
                        systemPrompt: PromptLibrary.summarySystemPrompt)
                    try Task.checkCancellation()
                    claims = SummaryEvidence.parse(merged, paper: paper, allowedSources: candidates.flatMap(\.sources))
                }
                self.progressValue = Double(index + 1) / Double(totalSteps)
            }

            guard !claims.isEmpty else { throw SummaryEvidenceError.noClaims }
            let sourceSummary = SummaryEvidence.markdown(claims)

            let targetSummary: String
            if settings.sourceLanguage == settings.targetLanguage {
                targetSummary = sourceSummary
            } else {
                self.statusMessage = "Translating the summary into \(settings.targetLanguage.displayName)"
                var translatedClaims: [String] = []
                for (index, claim) in claims.enumerated() {
                    try Task.checkCancellation()
                    let translated = try await self.translateChunk(claim.text, settings: settings)
                    translatedClaims.append("\(index + 1). \(translated)")
                }
                targetSummary = translatedClaims.joined(separator: "\n\n")
            }

            let result = SummaryResult(
                sourceLanguage: settings.sourceLanguage,
                targetLanguage: settings.targetLanguage,
                sourceSummary: sourceSummary,
                targetSummary: targetSummary,
                claims: claims
            )
            try Task.checkCancellation()
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
            let language = self.explanationLanguage
            let cacheKey = Hashing.sha256(
                "\(paper.checksum)|\(settings.ollamaBaseURL)|\(settings.explainModel)|\(selectedParagraph.id)|\(language.rawValue)"
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
                prompt: PromptLibrary.explanationPrompt(for: selectedParagraph.original, language: language),
                systemPrompt: PromptLibrary.explainSystemPrompt
            )

            try Task.checkCancellation()
            if self.selectedParagraphID == selectedParagraph.id && self.explanationLanguage == language {
                self.explanationText = explanation
            }
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
            mapping: ParagraphMutationMapping(oldRange: index..<(index + 1), replacementCount: editedParagraphs.count),
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
            mapping: ParagraphMutationMapping(oldRange: (index - 1)..<(index + 1), replacementCount: 1),
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
            mapping: ParagraphMutationMapping(oldRange: index..<(index + 2), replacementCount: 1),
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
            mapping: ParagraphMutationMapping(oldRange: index..<(index + 1), replacementCount: pieces.count),
            selectedIndex: index,
            message: "Reflowed paragraph \(paragraphID) into \(pieces.count) complete-sentence paragraphs."
        )
    }

    func undoParagraphEdit() {
        guard !isBusy, let snapshot = paragraphUndoStack.popLast() else { return }
        let savedAnnotations = Dictionary(uniqueKeysWithValues: snapshot.annotations.map { ($0.id, $0) })
        applyParagraphMutation(
            snapshot.paper.paragraphs,
            mapping: ParagraphMutationMapping(oldRange: snapshot.mapping.newRange, replacementCount: snapshot.mapping.oldRange.count),
            selectedIndex: snapshot.selectedIndex,
            recordUndo: false,
            message: "Undid the last paragraph edit."
        )
        isRestoringWorkspace = true
        loadedPaper = snapshot.paper
        for index in paragraphResults.indices where paragraphResults[index].status != .ok {
            paragraphResults[index] = snapshot.results[index]
        }
        // Keep notes added/edited after the structural edit, while restoring exact old anchors.
        annotations = annotations.map { current in
            guard var original = savedAnnotations[current.id] else { return current }
            original.note = current.note
            original.highlightColor = current.highlightColor
            return original
        }
        bookmarkedParagraphIDs.formUnion(snapshot.bookmarks)
        readingPositions = snapshot.positions
        summaries = snapshot.summaries
        connectedTranslation = snapshot.connectedTranslation
        isRestoringWorkspace = false
        persistWorkspace()
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
        guard !isBusy else { return }
        let taskID = UUID()
        activeTaskID = taskID
        errorMessage = nil
        isBusy = true
        statusMessage = initialStatus
        progressValue = 0
        isProgressIndeterminate = false

        activeTask = Task { [weak self] in
            guard let self else { return }
            defer {
                if self.activeTaskID == taskID {
                    self.activeTask = nil
                    self.activeTaskID = nil
                }
            }
            do {
                try Task.checkCancellation()
                try await operation()
                guard self.activeTaskID == taskID else { return }
                self.isBusy = false
                self.isProgressIndeterminate = false
            } catch is CancellationError {
                guard self.activeTaskID == taskID else { return }
                self.isBusy = false
                self.progressValue = 0
                self.isProgressIndeterminate = false
                self.statusMessage = "The current task was cancelled."
                self.persistWorkspace()
            } catch {
                guard self.activeTaskID == taskID else { return }
                self.isBusy = false
                self.progressValue = 0
                self.isProgressIndeterminate = false
                self.presentError(error.localizedDescription)
                self.persistWorkspace()
            }
        }
    }

    func applyLoadedPaper(_ incomingPaper: PaperDocument) {
        persistWorkspace()
        noteEditingIdentity = nil
        resetReadingHistory()
        // The source checksum is a stable library identity, not permission to
        // overwrite a manually corrected revision when the same PDF is dropped again.
        let saved = workspaceStore.loadWorkspace(checksum: incomingPaper.libraryStorageID)
        let paper = saved?.paper ?? incomingPaper
        isRestoringWorkspace = true
        defer {
            isRestoringWorkspace = false
            workspaceStore.saveSettings(settings)
            persistWorkspace()
        }

        paragraphUndoStack.removeAll()
        annotationUndoStack = []
        annotationNavigationRequest = nil
        navigationRequest = nil
        canUndoParagraphEdit = false
        editingParagraphID = nil
        paragraphEditorText = ""
        isParagraphEditorPresented = false
        paragraphSearchText = ""
        loadedPaper = paper
        positionSaveTask?.cancel()
        readingPositions = [:]
        activeTextSelection = nil
        selectionTask?.cancel()
        isSelectionLookupBusy = false
        isQuickLookupPresented = false
        selectionTranslation = ""
        selectionExplanation = ""
        selectionLookupStatus = ""
        selectionLookupError = nil
        progressValue = 0

        if let saved {
            let appearance = settings.readingAppearance
            settings = saved.settings
            settings.readingAppearance = appearance
            readingPositions = saved.readingPositions ?? [:]
            annotations = saved.annotations
            bookmarkedParagraphIDs = saved.bookmarkedParagraphIDs
            selectedParagraphID = saved.selectedParagraphID ?? paper.paragraphs.indices.first.map { $0 + 1 }
            displayMode = saved.displayMode
            workspaceMode = saved.workspaceMode
            explanationLanguage = saved.explanationLanguage
            isInspectorPresented = saved.isInspectorPresented

            seedOutputCaches(from: saved, for: paper)
        } else {
            annotations = []
            bookmarkedParagraphIDs = []
            selectedParagraphID = paper.paragraphs.indices.first.map { $0 + 1 }
            workspaceMode = paper.paragraphs.isEmpty ? .preview : .summary
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

    private func readPaper(from url: URL, asNewCopy: Bool = false) async throws -> PaperDocument {
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

        let checksum = asNewCopy ? Hashing.sha256(Hashing.sha256(data) + UUID().uuidString) : Hashing.sha256(data)
        if let saved = workspaceStore.loadWorkspace(checksum: checksum) {
            return saved.paper
        }
        let extractionCacheKey = Hashing.sha256(
            "\(checksum)|\(settings.pdfExtractionMode.rawValue)|\(settings.minerUBackend.rawValue)|\(settings.minerUExecutablePath)"
        )
        if let cached = extractedPaperCache[extractionCacheKey] {
            return cached
        }

        let fileName = url.lastPathComponent + (asNewCopy ? " (new extraction)" : "")
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
        try Task.checkCancellation()
        let terms = terminologyPrompt(for: paragraph.original, from: settings.sourceLanguage, to: settings.targetLanguage)
        let cacheKey = Hashing.sha256(
            "\(settings.ollamaBaseURL)|\(settings.translationModel)|\(settings.sourceLanguage.rawValue)|\(settings.targetLanguage.rawValue)|\(settings.maxParagraphChars)|\(paragraph.sourceMarkdown ?? paragraph.original)|\(terms)"
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
                            ) + terms
                        )
                    )
                }
            } catch is CancellationError {
                throw CancellationError()
            } catch {
                try Task.checkCancellation()
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
            try Task.checkCancellation()
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

        let terms = terminologyPrompt(for: chunk, from: settings.sourceLanguage, to: settings.targetLanguage)
        let cacheKey = Hashing.sha256(
            "\(settings.ollamaBaseURL)|\(settings.translationModel)|\(settings.sourceLanguage.rawValue)|\(settings.targetLanguage.rawValue)|\(chunk)|\(terms)"
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
            systemPrompt: PromptLibrary.translationSystemPrompt(targetLanguage: settings.targetLanguage) + terms
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
                        + self.terminologyPrompt(for: batch, from: settings.sourceLanguage, to: settings.targetLanguage)
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
        mapping: ParagraphMutationMapping,
        selectedIndex: Int?,
        recordUndo: Bool = true,
        message: String
    ) {
        guard let paper = loadedPaper, !paragraphs.isEmpty else { return }
        guard !paper.hasStructuredMarkdown else {
            statusMessage = "MinerU Markdown controls this document's layout. Edit the exported Markdown instead of reflowing analysis blocks."
            return
        }
        isRestoringWorkspace = true
        defer {
            isRestoringWorkspace = false
            persistWorkspace()
        }

        if recordUndo {
            let oldSelectedIndex = selectedParagraphID.flatMap { selectedID in
                paragraphResults.firstIndex(where: { $0.id == selectedID })
            }
            paragraphUndoStack.append(
                ParagraphEditSnapshot(
                    paper: paper, results: paragraphResults, selectedIndex: oldSelectedIndex,
                    mapping: mapping, annotations: annotations, bookmarks: bookmarkedParagraphIDs,
                    positions: readingPositions, summaries: summaries, connectedTranslation: connectedTranslation
                )
            )
            if paragraphUndoStack.count > 20 {
                paragraphUndoStack.removeFirst()
            }
        }
        canUndoParagraphEdit = !paragraphUndoStack.isEmpty

        let previousResults = paragraphResults
        let updatedResults = paragraphs.enumerated().map { index, paragraph -> ParagraphResult in
            guard let sourceIndex = mapping.sourceIndex(for: index),
                  previousResults.indices.contains(sourceIndex),
                  previousResults[sourceIndex].original == paragraph else {
                return ParagraphResult(id: index + 1, original: paragraph)
            }
            let reusable = previousResults[sourceIndex]

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
            checksum: Hashing.sha256("\(paper.libraryStorageID)|\(paper.name)|\(bodyText)"),
            cleanedText: bodyText,
            paragraphs: paragraphs,
            excludedReferenceParagraphs: paper.excludedReferenceParagraphs,
            referenceSectionTitle: paper.referenceSectionTitle,
            sourceMarkdown: paper.hasFacsimileMarkdown ? paper.sourceMarkdown : nil,
            markdownResourceDirectory: paper.markdownResourceDirectory,
            extractionEngine: paper.extractionEngine,
            extractionWarning: paper.extractionWarning,
            libraryID: paper.libraryStorageID
        )

        annotations = annotations.map { mapping.remap($0, old: previousResults, new: updatedResults) }
        bookmarkedParagraphIDs = Set(bookmarkedParagraphIDs.flatMap { mapping.destinations(for: $0 - 1).map { $0 + 1 } })
        loadedPaper = updatedPaper
        // Structural edits invalidate positional navigation and its transient undo history.
        resetReadingHistory()
        annotationUndoStack = []
        annotationNavigationRequest = nil
        navigationRequest = nil
        clearTextSelection()
        readingPositions = readingPositions.filter { $0.key.hasPrefix("paper.") || $0.key == "reader" }
        if var position = readingPositions["reader"], let id = position.paragraphID,
           let newIndex = mapping.destinations(for: id - 1).first {
            position.paragraphID = newIndex + 1
            position.readerItemID = "paragraph-\(newIndex + 1)"
            readingPositions["reader"] = position
        }
        positionSaveTask?.cancel()
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

    // Seed every output under its original task settings before selecting the current variant.
    // Parser paths and lookup models do not invalidate a valid translation or summary.
    private func seedOutputCaches(from workspace: PersistedWorkspace, for paper: PaperDocument) {
        guard workspace.paragraphResults.map(\.original) == paper.paragraphs,
              workspace.paper.sourceMarkdown == paper.sourceMarkdown else { return }
        let saved = workspace.settings
        paperTranslationCache[translationCacheKey(for: paper, settings: saved)] = workspace.paragraphResults
        if let result = workspace.connectedTranslation {
            connectedTranslationCache[connectedTranslationCacheKey(for: paper, settings: saved)] = result
        }
        if let result = workspace.summaries {
            let key = Hashing.sha256(
                "\(paper.checksum)|\(saved.ollamaBaseURL)|\(saved.summaryModel)|\(saved.translationModel)|\(saved.sourceLanguage.rawValue)|\(saved.targetLanguage.rawValue)"
            )
            summaryCache[key] = result
        }
        if let paragraphID = workspace.selectedParagraphID, !workspace.explanationText.isEmpty {
            let key = Hashing.sha256(
                "\(paper.checksum)|\(saved.ollamaBaseURL)|\(saved.explainModel)|\(paragraphID)|\(workspace.explanationLanguage.rawValue)"
            )
            explanationCache[key] = workspace.explanationText
        }
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
            if let claims = summaries.claims {
                lines.append("### Summary source passages")
                lines.append("> AI interpretation is unverified. Matching a quotation confirms its location, not whether it supports the claim.")
                for (index, claim) in claims.enumerated() {
                    lines.append("\n**Claim \(index + 1)**: \(claim.text)")
                    if claim.sources.isEmpty { lines.append("\nNo source link validated.") }
                    for source in claim.sources {
                        lines.append("\nOriginal paragraph \(source.paragraphID):")
                        lines.append(source.quote.components(separatedBy: "\n").map { "> " + $0 }.joined(separator: "\n"))
                    }
                }
                lines.append("")
            }
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
                .filter { $0.resolvedScope == .reader && $0.needsReview != true && $0.paragraphID == paragraph.id }
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

        let paragraphIDs = Set(paragraphResults.map(\.id))
        let otherAnnotations = annotations.filter {
            $0.resolvedScope != .reader || $0.needsReview == true || !paragraphIDs.contains($0.paragraphID)
        }
        if !otherAnnotations.isEmpty {
            lines.append("## Other Saved Highlights and Notes")
            for annotation in otherAnnotations.sorted(by: { $0.createdAt < $1.createdAt }) {
                lines.append("\n### \(annotation.resolvedScope.displayName) - \(annotation.side.displayName)")
                if annotation.needsReview == true {
                    lines.append("\n> Source changed: this note was preserved, but its location could not be verified.")
                }
                lines.append("\n" + annotation.quote.components(separatedBy: "\n").map { "> " + $0 }.joined(separator: "\n"))
                if !annotation.note.isEmpty { lines.append("\nNote: " + annotation.note) }
            }
        }
        return lines.joined(separator: "\n")
    }

    func persistWorkspace() {
        guard !isRestoringWorkspace, let paper = loadedPaper else { return }
        noteSaveTask?.cancel()
        noteSaveTask = nil
        isNoteSavePending = false

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
            isInspectorPresented: isInspectorPresented,
            readingPositions: readingPositions
        )
        let requestID = UUID()
        workspaceSaveRequestID = requestID
        isWorkspaceSaving = true
        workspaceStore.saveWorkspace(workspace) { [weak self] error in
            Task { @MainActor [weak self] in
                guard let self, self.workspaceSaveRequestID == requestID else { return }
                self.isWorkspaceSaving = false
                self.workspaceSaveError = error
            }
        }
    }

    func flushPendingSaves() {
        positionSaveTask?.cancel()
        positionSaveTask = nil
        persistWorkspace()
        workspaceStore.flush()
    }

    func updateReadingPosition(_ position: ReadingPosition, key: String, paperChecksum: String?) {
        guard loadedPaper?.checksum == paperChecksum, paperChecksum != nil,
              position.x.isFinite, position.y.isFinite, position.offset?.isFinite != false,
              readingPositions[key] != position else { return }
        readingPositions[key] = position
        positionSaveTask?.cancel()
        positionSaveTask = Task { [weak self] in
            do {
                try await Task.sleep(for: .milliseconds(500))
                self?.persistWorkspace()
            } catch {}
        }
    }

    func focusReaderSearch() {
        workspaceMode = .reader
        searchFocusRequest = UUID()
    }

    private func presentError(_ message: String?) {
        guard let message, !message.isEmpty else { return }
        errorMessage = message
        statusMessage = message
    }

    func syncModelSelections(with models: [String]) {
        guard !models.isEmpty, !isBusy else { return }

        let preferredTranslation: String
        if models.contains(AppSettings.recommendedLocalModel) {
            preferredTranslation = AppSettings.recommendedLocalModel
        } else if models.contains("translategemma:12b") {
            preferredTranslation = "translategemma:12b"
        } else {
            preferredTranslation = models[0]
        }
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
