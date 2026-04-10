import Foundation
import SwiftUI

@MainActor
final class PaperReaderViewModel: ObservableObject {
    @Published var settings = AppSettings()
    @Published var loadedPaper: PaperDocument?
    @Published var paragraphResults: [ParagraphResult] = []
    @Published var connectedTranslation: ConnectedTranslationResult?
    @Published var summaries: SummaryResult?
    @Published var explanationLanguage: ReaderLanguage = .english
    @Published var explanationText = ""
    @Published var manualInputText = ""
    @Published var selectedParagraphID: Int?
    @Published var statusMessage = "Open a PDF, paste text, or drag one into the window."
    @Published var progressValue = 0.0
    @Published var isBusy = false
    @Published var errorMessage: String?
    @Published var isImporterPresented = false
    @Published var isExporterPresented = false
    @Published var exportDocument = MarkdownDocument()
    @Published var availableModels: [String] = []
    @Published var isRefreshingModels = false
    @Published var modelRefreshError: String?

    private let pdfExtractor = PDFTextExtractor()
    private let ollamaClient = OllamaClient()
    private var activeTask: Task<Void, Never>?
    private var modelRefreshTask: Task<Void, Never>?

    private var extractedPaperCache: [String: PaperDocument] = [:]
    private var chunkTranslationCache: [String: String] = [:]
    private var paragraphTranslationCache: [String: ParagraphTranslationSnapshot] = [:]
    private var paperTranslationCache: [String: [ParagraphResult]] = [:]
    private var connectedTranslationCache: [String: ConnectedTranslationResult] = [:]
    private var summaryCache: [String: SummaryResult] = [:]
    private var explanationCache: [String: String] = [:]

    deinit {
        activeTask?.cancel()
        modelRefreshTask?.cancel()
    }

    var translatedCount: Int {
        paragraphResults.filter { $0.status == .ok }.count
    }

    var failedCount: Int {
        paragraphResults.filter { $0.status == .failed }.count
    }

    var canTranslate: Bool {
        loadedPaper != nil && !isBusy
    }

    var canLoadInputText: Bool {
        !manualInputText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !isBusy
    }

    var canSummarize: Bool {
        loadedPaper != nil && !isBusy
    }

    var canExplain: Bool {
        selectedParagraph != nil && !isBusy
    }

    var canExport: Bool {
        !paragraphResults.isEmpty && !isBusy
    }

    var selectedParagraph: ParagraphResult? {
        paragraphResults.first(where: { $0.id == selectedParagraphID })
    }

    var defaultExportFilename: String {
        guard let loadedPaper else { return "paper_bilingual.md" }
        let stem = loadedPaper.name.replacingOccurrences(of: ".pdf", with: "")
        return stem + "_bilingual.md"
    }

    var hasAvailableModels: Bool {
        !availableModels.isEmpty
    }

    func showImporter() {
        isImporterPresented = true
    }

    func clearError() {
        errorMessage = nil
    }

    func swapTranslationLanguages() {
        let previousSource = settings.sourceLanguage
        settings.sourceLanguage = settings.targetLanguage
        settings.targetLanguage = previousSource
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
        activeTask = nil
        isBusy = false
        statusMessage = "The current task was cancelled."
        progressValue = 0
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
            let paper = try self.readTextInput(self.manualInputText)
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
            let cacheKey = Hashing.sha256(
                "\(paper.checksum)|\(settings.ollamaBaseURL)|\(settings.translationModel)|\(settings.sourceLanguage.rawValue)|\(settings.targetLanguage.rawValue)|\(settings.maxParagraphChars)"
            )
            let connectedCacheKey = Hashing.sha256("\(cacheKey)|connected")
            let cachedParagraphs = self.paperTranslationCache[cacheKey]
            let cachedConnected = self.connectedTranslationCache[connectedCacheKey]

            try await self.ollamaClient.ensureModelAvailable(baseURL: settings.ollamaBaseURL, model: settings.translationModel)

            var workingResults = cachedParagraphs ?? paper.paragraphs.enumerated().map { index, paragraph in
                ParagraphResult(id: index + 1, original: paragraph)
            }
            let connectedBatches = cachedConnected == nil
                ? TextProcessing.buildTextBatches(paper.paragraphs, maxChars: TextProcessing.connectedTranslationBatchChars)
                : []
            let totalSteps = max(
                (cachedParagraphs == nil ? workingResults.count : 0) + connectedBatches.count,
                1
            )
            var completedSteps = 0

            self.paragraphResults = workingResults

            if cachedParagraphs == nil {
                for index in workingResults.indices {
                    try Task.checkCancellation()

                    self.statusMessage = "Translating paragraph \(index + 1) of \(workingResults.count)"
                    let snapshot = try await self.translateParagraph(workingResults[index].original, settings: settings)

                    workingResults[index].translation = snapshot.translation
                    workingResults[index].status = snapshot.status
                    workingResults[index].errorMessage = snapshot.errorMessage
                    workingResults[index].chunkCount = snapshot.chunkCount

                    self.paragraphResults = workingResults
                    completedSteps += 1
                    self.progressValue = Double(completedSteps) / Double(totalSteps)
                }

                self.paperTranslationCache[cacheKey] = workingResults
            } else {
                self.progressValue = connectedBatches.isEmpty ? 1 : 0
            }

            if let cachedConnected {
                self.connectedTranslation = cachedConnected
            } else {
                let connectedResult = try await self.translateConnectedPaper(
                    paper,
                    settings: settings,
                    batches: connectedBatches
                ) { status in
                    self.statusMessage = status
                } onBatchFinished: {
                    completedSteps += 1
                    self.progressValue = Double(completedSteps) / Double(totalSteps)
                }

                self.connectedTranslation = connectedResult
                self.connectedTranslationCache[connectedCacheKey] = connectedResult
            }

            let usedCaches = cachedParagraphs != nil || cachedConnected != nil
            if usedCaches, cachedParagraphs != nil, cachedConnected != nil {
                self.progressValue = 1
                self.statusMessage = "Using cached translations for this paper and settings."
            } else if let connectedTranslation = self.connectedTranslation, connectedTranslation.failedBatchCount > 0 {
                self.progressValue = 1
                self.statusMessage = "Translation finished with \(connectedTranslation.failedBatchCount) connected-translation batch failures."
            } else {
                self.progressValue = 1
                self.statusMessage = "Translation finished."
            }
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
                return
            }

            try await self.ollamaClient.ensureModelAvailable(baseURL: settings.ollamaBaseURL, model: settings.summaryModel)
            try await self.ollamaClient.ensureModelAvailable(baseURL: settings.ollamaBaseURL, model: settings.translationModel)

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
        }
    }

    func prepareMarkdownExport() {
        guard let paper = loadedPaper else {
            presentError(ReaderError.noPaperLoaded.localizedDescription)
            return
        }

        exportDocument = MarkdownDocument(text: buildMarkdownExport(for: paper))
        isExporterPresented = true
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

        activeTask = Task { [weak self] in
            guard let self else { return }
            do {
                try await operation()
                self.isBusy = false
            } catch is CancellationError {
                self.isBusy = false
                self.progressValue = 0
                self.statusMessage = "The current task was cancelled."
            } catch {
                self.isBusy = false
                self.progressValue = 0
                self.presentError(error.localizedDescription)
            }
        }
    }

    private func applyLoadedPaper(_ paper: PaperDocument) {
        loadedPaper = paper
        paragraphResults = paper.paragraphs.enumerated().map { index, paragraph in
            ParagraphResult(id: index + 1, original: paragraph)
        }
        selectedParagraphID = paragraphResults.first?.id
        connectedTranslation = nil
        summaries = nil
        explanationText = ""
        progressValue = 0
        restoreCachedOutputsIfAvailable(for: paper)

        if paper.excludedReferenceCount > 0 {
            statusMessage = "Loaded \(paper.name) with \(paper.paragraphs.count) paragraphs. Skipped \(paper.excludedReferenceCount) reference paragraphs."
        } else {
            statusMessage = "Loaded \(paper.name) with \(paper.paragraphs.count) paragraphs."
        }
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
            data = try Data(contentsOf: url)
        } catch {
            throw ReaderError.failedToReadFile(error.localizedDescription)
        }

        let checksum = Hashing.sha256(data)
        if let cached = extractedPaperCache[checksum] {
            return cached
        }

        let rawText = try pdfExtractor.extractText(from: data)

        let cleanedText = TextProcessing.cleanExtractedText(rawText)
        let extractedParagraphs = TextProcessing.splitIntoParagraphs(cleanedText)
        guard !extractedParagraphs.isEmpty else {
            throw ReaderError.noParagraphsDetected
        }

        let trimmedPaper = TextProcessing.excludeReferenceSection(from: extractedParagraphs)
        guard !trimmedPaper.bodyParagraphs.isEmpty else {
            throw ReaderError.noParagraphsDetected
        }

        let bodyText = trimmedPaper.bodyParagraphs.joined(separator: "\n\n")

        let paper = PaperDocument(
            name: url.lastPathComponent,
            checksum: checksum,
            cleanedText: bodyText,
            paragraphs: trimmedPaper.bodyParagraphs,
            excludedReferenceParagraphs: trimmedPaper.referenceParagraphs,
            referenceSectionTitle: trimmedPaper.heading
        )

        extractedPaperCache[checksum] = paper
        return paper
    }

    private func readTextInput(_ text: String) throws -> PaperDocument {
        let trimmedInput = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedInput.isEmpty else {
            throw ReaderError.noInputText
        }

        let checksum = Hashing.sha256(trimmedInput)
        if let cached = extractedPaperCache[checksum] {
            return cached
        }

        let normalizedInput = trimmedInput.replacingOccurrences(of: "\r", with: "\n")
        let extractedParagraphs: [String]

        if normalizedInput.contains("\n\n") {
            let cleanedText = TextProcessing.cleanExtractedText(normalizedInput)
            extractedParagraphs = TextProcessing.postProcessParagraphs(
                TextProcessing.splitIntoParagraphs(cleanedText)
            )
        } else if normalizedInput.contains("\n") {
            extractedParagraphs = TextProcessing.rebuildParagraphs(fromPageText: normalizedInput)
        } else {
            extractedParagraphs = TextProcessing.postProcessParagraphs([normalizedInput])
        }

        guard !extractedParagraphs.isEmpty else {
            throw ReaderError.noParagraphsDetected
        }

        let trimmedPaper = TextProcessing.excludeReferenceSection(from: extractedParagraphs)
        guard !trimmedPaper.bodyParagraphs.isEmpty else {
            throw ReaderError.noParagraphsDetected
        }

        let bodyText = trimmedPaper.bodyParagraphs.joined(separator: "\n\n")

        let paper = PaperDocument(
            name: "Pasted Text",
            checksum: checksum,
            cleanedText: bodyText,
            paragraphs: trimmedPaper.bodyParagraphs,
            excludedReferenceParagraphs: trimmedPaper.referenceParagraphs,
            referenceSectionTitle: trimmedPaper.heading
        )

        extractedPaperCache[checksum] = paper
        return paper
    }

    private func translateParagraph(_ paragraph: String, settings: AppSettings) async throws -> ParagraphTranslationSnapshot {
        let cacheKey = Hashing.sha256(
            "\(settings.ollamaBaseURL)|\(settings.translationModel)|\(settings.sourceLanguage.rawValue)|\(settings.targetLanguage.rawValue)|\(settings.maxParagraphChars)|\(paragraph)"
        )
        if let cached = paragraphTranslationCache[cacheKey] {
            return cached
        }

        let chunks = TextProcessing.chunkParagraph(paragraph, maxChars: settings.maxParagraphChars)
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
                status: .failed,
                errorMessage: error.localizedDescription,
                chunkCount: chunks.count
            )
        }

        let snapshot = ParagraphTranslationSnapshot(
            translation: translatedChunks.joined(separator: " "),
            status: .ok,
            errorMessage: nil,
            chunkCount: chunks.count
        )

        paragraphTranslationCache[cacheKey] = snapshot
        return snapshot
    }

    private func translateChunk(_ chunk: String, settings: AppSettings) async throws -> String {
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

    private func restoreCachedOutputsIfAvailable(for paper: PaperDocument) {
        let translationKey = Hashing.sha256(
            "\(paper.checksum)|\(settings.ollamaBaseURL)|\(settings.translationModel)|\(settings.sourceLanguage.rawValue)|\(settings.targetLanguage.rawValue)|\(settings.maxParagraphChars)"
        )
        if let cachedTranslations = paperTranslationCache[translationKey] {
            paragraphResults = cachedTranslations
        }

        let connectedKey = Hashing.sha256("\(translationKey)|connected")
        connectedTranslation = connectedTranslationCache[connectedKey]

        let summaryKey = Hashing.sha256(
            "\(paper.checksum)|\(settings.ollamaBaseURL)|\(settings.summaryModel)|\(settings.translationModel)|\(settings.sourceLanguage.rawValue)|\(settings.targetLanguage.rawValue)"
        )
        summaries = summaryCache[summaryKey]

        if let selectedParagraphID,
           let cachedExplanation = explanationCache[Hashing.sha256(
            "\(paper.checksum)|\(settings.ollamaBaseURL)|\(settings.explainModel)|\(selectedParagraphID)|\(explanationLanguage.rawValue)"
           )] {
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
        }

        return lines.joined(separator: "\n")
    }

    private func presentError(_ message: String?) {
        guard let message, !message.isEmpty else { return }
        errorMessage = message
        statusMessage = message
    }

    private func syncModelSelections(with models: [String]) {
        guard !models.isEmpty else { return }

        let preferredTranslation = models.contains("translategemma:12b") ? "translategemma:12b" : models[0]
        settings.translationModel = selectModel(
            current: settings.translationModel,
            preferred: preferredTranslation,
            available: models
        )
        settings.summaryModel = selectModel(
            current: settings.summaryModel,
            preferred: settings.translationModel,
            available: models
        )
        settings.explainModel = selectModel(
            current: settings.explainModel,
            preferred: settings.translationModel,
            available: models
        )
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
