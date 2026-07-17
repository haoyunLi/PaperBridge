import Foundation

struct AppSettings: Hashable, Codable {
    var ollamaBaseURL = "http://localhost:11434"
    var translationModel = "translategemma:12b"
    var summaryModel = "translategemma:12b"
    var explainModel = "translategemma:12b"
    var quickLookupModel = "translategemma:12b"
    var sourceLanguage: ReaderLanguage = .english
    var targetLanguage: ReaderLanguage = .simplifiedChinese
    var maxParagraphChars = 1800
    var pdfExtractionMode: PDFExtractionMode = .minerUPreferred
    var minerUExecutablePath = ""
    var minerUBackend: MinerUBackend = .pipeline
}

extension AppSettings {
    private enum CodingKeys: String, CodingKey {
        case ollamaBaseURL
        case translationModel
        case summaryModel
        case explainModel
        case quickLookupModel
        case sourceLanguage
        case targetLanguage
        case maxParagraphChars
        case pdfExtractionMode
        case minerUExecutablePath
        case minerUBackend
    }

    init(from decoder: Decoder) throws {
        let defaults = AppSettings()
        let container = try decoder.container(keyedBy: CodingKeys.self)
        ollamaBaseURL = try container.decodeIfPresent(String.self, forKey: .ollamaBaseURL) ?? defaults.ollamaBaseURL
        translationModel = try container.decodeIfPresent(String.self, forKey: .translationModel) ?? defaults.translationModel
        summaryModel = try container.decodeIfPresent(String.self, forKey: .summaryModel) ?? defaults.summaryModel
        explainModel = try container.decodeIfPresent(String.self, forKey: .explainModel) ?? defaults.explainModel
        quickLookupModel = try container.decodeIfPresent(String.self, forKey: .quickLookupModel) ?? defaults.quickLookupModel
        sourceLanguage = try container.decodeIfPresent(ReaderLanguage.self, forKey: .sourceLanguage) ?? defaults.sourceLanguage
        targetLanguage = try container.decodeIfPresent(ReaderLanguage.self, forKey: .targetLanguage) ?? defaults.targetLanguage
        maxParagraphChars = try container.decodeIfPresent(Int.self, forKey: .maxParagraphChars) ?? defaults.maxParagraphChars
        pdfExtractionMode = try container.decodeIfPresent(PDFExtractionMode.self, forKey: .pdfExtractionMode) ?? defaults.pdfExtractionMode
        minerUExecutablePath = try container.decodeIfPresent(String.self, forKey: .minerUExecutablePath) ?? defaults.minerUExecutablePath
        minerUBackend = try container.decodeIfPresent(MinerUBackend.self, forKey: .minerUBackend) ?? defaults.minerUBackend
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(ollamaBaseURL, forKey: .ollamaBaseURL)
        try container.encode(translationModel, forKey: .translationModel)
        try container.encode(summaryModel, forKey: .summaryModel)
        try container.encode(explainModel, forKey: .explainModel)
        try container.encode(quickLookupModel, forKey: .quickLookupModel)
        try container.encode(sourceLanguage, forKey: .sourceLanguage)
        try container.encode(targetLanguage, forKey: .targetLanguage)
        try container.encode(maxParagraphChars, forKey: .maxParagraphChars)
        try container.encode(pdfExtractionMode, forKey: .pdfExtractionMode)
        try container.encode(minerUExecutablePath, forKey: .minerUExecutablePath)
        try container.encode(minerUBackend, forKey: .minerUBackend)
    }
}

enum ReaderLanguage: String, CaseIterable, Identifiable, Hashable, Codable {
    case english
    case simplifiedChinese
    case traditionalChinese
    case japanese
    case korean
    case french
    case german
    case spanish
    case italian
    case portuguese
    case russian

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .english:
            return "English"
        case .simplifiedChinese:
            return "Simplified Chinese"
        case .traditionalChinese:
            return "Traditional Chinese"
        case .japanese:
            return "Japanese"
        case .korean:
            return "Korean"
        case .french:
            return "French"
        case .german:
            return "German"
        case .spanish:
            return "Spanish"
        case .italian:
            return "Italian"
        case .portuguese:
            return "Portuguese"
        case .russian:
            return "Russian"
        }
    }

    var translationCode: String {
        switch self {
        case .english:
            return "en"
        case .simplifiedChinese:
            return "zh-Hans"
        case .traditionalChinese:
            return "zh-Hant"
        case .japanese:
            return "ja"
        case .korean:
            return "ko"
        case .french:
            return "fr"
        case .german:
            return "de"
        case .spanish:
            return "es"
        case .italian:
            return "it"
        case .portuguese:
            return "pt"
        case .russian:
            return "ru"
        }
    }

    var displayNameWithCode: String {
        "\(displayName) (\(translationCode))"
    }

    var simpleDescription: String {
        switch self {
        case .english:
            return "simple English"
        case .simplifiedChinese:
            return "simple Simplified Chinese"
        case .traditionalChinese:
            return "simple Traditional Chinese"
        case .japanese:
            return "simple Japanese"
        case .korean:
            return "simple Korean"
        case .french:
            return "simple French"
        case .german:
            return "simple German"
        case .spanish:
            return "simple Spanish"
        case .italian:
            return "simple Italian"
        case .portuguese:
            return "simple Portuguese"
        case .russian:
            return "simple Russian"
        }
    }
}

enum TranslationStatus: String, Hashable, Codable {
    case pending
    case ok
    case failed
}

enum PDFExtractionMode: String, CaseIterable, Identifiable, Hashable, Codable {
    case minerUPreferred
    case minerUOnly
    case pdfKitOnly

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .minerUPreferred:
            return "MinerU, then PDFKit facsimile"
        case .minerUOnly:
            return "MinerU only"
        case .pdfKitOnly:
            return "PDFKit facsimile (no OCR)"
        }
    }

    var detail: String {
        switch self {
        case .minerUPreferred:
            return "Use MinerU when it is installed; otherwise keep an exact visual copy with built-in PDFKit and analyze only the PDF's existing selectable text."
        case .minerUOnly:
            return "Require MinerU structured Markdown. Opening fails if MinerU is unavailable or cannot parse the PDF."
        case .pdfKitOnly:
            return "Never run a parser or OCR model. Preserve the original PDF and page images, then use only its existing selectable text layer for AI tasks."
        }
    }
}

enum MinerUBackend: String, CaseIterable, Identifiable, Hashable, Codable {
    case automatic
    case pipeline

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .automatic:
            return "MinerU default / Hybrid (higher memory)"
        case .pipeline:
            return "Pipeline / Mac compatible (recommended)"
        }
    }

    var detail: String {
        switch self {
        case .automatic:
            return "Uses MinerU's current default backend. MinerU 3.4 defaults to the hybrid engine, which can download larger models and use more memory."
        case .pipeline:
            return "Uses MinerU's local pipeline backend with formula and table recognition. This is the safer default for most Intel and Apple silicon Macs."
        }
    }

    var commandLineValue: String? {
        switch self {
        case .automatic:
            return nil
        case .pipeline:
            return "pipeline"
        }
    }
}

enum DocumentExtractionEngine: String, Hashable, Codable {
    case minerU
    case pdfKit
    case pastedText

    var displayName: String {
        switch self {
        case .minerU:
            return "MinerU"
        case .pdfKit:
            return "PDFKit facsimile"
        case .pastedText:
            return "Pasted text"
        }
    }
}

enum ReaderDisplayMode: String, CaseIterable, Identifiable, Codable {
    case bilingual
    case sourceOnly
    case translationOnly

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .bilingual:
            return "Bilingual"
        case .sourceOnly:
            return "Original"
        case .translationOnly:
            return "Translation"
        }
    }
}

enum ReaderWorkspaceMode: String, CaseIterable, Identifiable, Codable {
    case preview
    case reader
    case summary
    case fullTranslation

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .preview:
            return "Paper"
        case .reader:
            return "Reader"
        case .summary:
            return "Summary"
        case .fullTranslation:
            return "Full Translation"
        }
    }

    var systemImage: String {
        switch self {
        case .preview:
            return "doc.richtext"
        case .reader:
            return "text.book.closed"
        case .summary:
            return "list.bullet.rectangle"
        case .fullTranslation:
            return "text.append"
        }
    }
}

enum ReaderTextSide: String, Hashable, Codable {
    case original
    case translation

    var displayName: String {
        switch self {
        case .original:
            return "Original"
        case .translation:
            return "Translation"
        }
    }
}

enum TextSelectionScope: String, Hashable, Codable {
    case reader
    case paper
    case summarySource
    case summaryTarget
    case fullTranslation

    var displayName: String {
        switch self {
        case .reader:
            return "Reader"
        case .paper:
            return "Paper"
        case .summarySource:
            return "Source Summary"
        case .summaryTarget:
            return "Target Summary"
        case .fullTranslation:
            return "Full Translation"
        }
    }

    var workspaceMode: ReaderWorkspaceMode {
        switch self {
        case .reader:
            return .reader
        case .paper:
            return .preview
        case .summarySource, .summaryTarget:
            return .summary
        case .fullTranslation:
            return .fullTranslation
        }
    }
}

struct ReaderTextSelection: Hashable {
    let scope: TextSelectionScope
    let paragraphID: Int
    let side: ReaderTextSide
    let text: String
    let context: String
    let rangeLocation: Int
    let rangeLength: Int
    let locator: String?

    init(
        scope: TextSelectionScope = .reader,
        paragraphID: Int,
        side: ReaderTextSide,
        text: String,
        context: String,
        rangeLocation: Int,
        rangeLength: Int,
        locator: String? = nil
    ) {
        self.scope = scope
        self.paragraphID = paragraphID
        self.side = side
        self.text = text
        self.context = context
        self.rangeLocation = rangeLocation
        self.rangeLength = rangeLength
        self.locator = locator
    }

    var identity: String {
        "\(scope.rawValue)|\(paragraphID)|\(side.rawValue)|\(locator ?? "")|\(rangeLocation)|\(rangeLength)|\(text)"
    }
}

enum PaperHighlightColor: String, CaseIterable, Identifiable, Codable {
    case amber
    case teal
    case coral

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .amber:
            return "Amber"
        case .teal:
            return "Teal"
        case .coral:
            return "Coral"
        }
    }
}

struct PaperAnnotation: Identifiable, Hashable, Codable {
    let id: UUID
    let paragraphID: Int
    let side: ReaderTextSide
    let quote: String
    let rangeLocation: Int
    let rangeLength: Int
    let scope: TextSelectionScope?
    let context: String?
    let locator: String?
    var highlightColor: PaperHighlightColor?
    var note: String
    let createdAt: Date

    init(
        id: UUID = UUID(),
        paragraphID: Int,
        side: ReaderTextSide,
        quote: String,
        rangeLocation: Int,
        rangeLength: Int,
        scope: TextSelectionScope = .reader,
        context: String? = nil,
        locator: String? = nil,
        highlightColor: PaperHighlightColor? = nil,
        note: String = "",
        createdAt: Date = Date()
    ) {
        self.id = id
        self.paragraphID = paragraphID
        self.side = side
        self.quote = quote
        self.rangeLocation = rangeLocation
        self.rangeLength = rangeLength
        self.scope = scope
        self.context = context
        self.locator = locator
        self.highlightColor = highlightColor
        self.note = note
        self.createdAt = createdAt
    }

    var resolvedScope: TextSelectionScope {
        scope ?? .reader
    }

    func resolvedRange(in text: String) -> NSRange? {
        let nsText = text as NSString
        let savedRange = NSRange(location: rangeLocation, length: rangeLength)
        if savedRange.location != NSNotFound,
           savedRange.location >= 0,
           savedRange.length > 0,
           NSMaxRange(savedRange) <= nsText.length,
           nsText.substring(with: savedRange) == quote {
            return savedRange
        }

        let recoveredRange = nsText.range(of: quote)
        return recoveredRange.location == NSNotFound ? nil : recoveredRange
    }
}

struct DocumentSection: Identifiable, Hashable {
    let paragraphID: Int
    let title: String

    var id: Int { paragraphID }
}

struct ParagraphNavigationRequest: Equatable {
    let id = UUID()
    let paragraphID: Int
}

struct ParagraphTranslationSnapshot: Hashable, Codable {
    let translation: String
    let translationMarkdown: String?
    let status: TranslationStatus
    let errorMessage: String?
    let chunkCount: Int
}

struct ParagraphResult: Identifiable, Hashable, Codable {
    let id: Int
    let original: String
    let sourceMarkdown: String?
    var translation: String = ""
    var translationMarkdown: String?
    var status: TranslationStatus = .pending
    var errorMessage: String?
    var chunkCount: Int = 0

    init(
        id: Int,
        original: String,
        sourceMarkdown: String? = nil,
        translation: String = "",
        translationMarkdown: String? = nil,
        status: TranslationStatus = .pending,
        errorMessage: String? = nil,
        chunkCount: Int = 0
    ) {
        self.id = id
        self.original = original
        self.sourceMarkdown = sourceMarkdown
        self.translation = translation
        self.translationMarkdown = translationMarkdown
        self.status = status
        self.errorMessage = errorMessage
        self.chunkCount = chunkCount
    }

    var previewText: String {
        let flattened = original.replacingOccurrences(of: "\n", with: " ")
        guard flattened.count > 96 else { return flattened }
        return String(flattened.prefix(93)) + "..."
    }
}

enum MarkdownSegmentKind: String, Hashable, Codable {
    case heading
    case paragraph
    case listItem
    case quote
    case image
    case formula
    case table
    case code
    case rawHTML
    case separator

    var isTranslatable: Bool {
        switch self {
        case .heading, .paragraph, .listItem, .quote:
            return true
        case .image, .formula, .table, .code, .rawHTML, .separator:
            return false
        }
    }
}

struct PaperMarkdownSegment: Identifiable, Hashable, Codable {
    let id: Int
    let kind: MarkdownSegmentKind
    let source: String
    let analysisText: String?
    var paragraphID: Int?
    var isReference: Bool
}

struct ReaderResourceBlock: Identifiable, Hashable {
    let id: Int
    let kind: MarkdownSegmentKind
    let markdown: String
}

enum ReaderFlowItem: Identifiable, Hashable {
    case paragraph(ParagraphResult)
    case resource(ReaderResourceBlock)

    var id: String {
        switch self {
        case .paragraph(let paragraph):
            return "paragraph-\(paragraph.id)"
        case .resource(let resource):
            return "resource-\(resource.id)"
        }
    }
}

enum MarkdownPreviewPresentation: String, Hashable {
    case document
    case embedded
}

struct PaperDocument: Hashable, Codable {
    let name: String
    let checksum: String
    let cleanedText: String
    let paragraphs: [String]
    let excludedReferenceParagraphs: [String]
    let referenceSectionTitle: String?
    let sourceMarkdown: String?
    let markdownResourceDirectory: String?
    let markdownSegments: [PaperMarkdownSegment]?
    let extractionEngine: DocumentExtractionEngine?
    let extractionWarning: String?

    init(
        name: String,
        checksum: String,
        cleanedText: String,
        paragraphs: [String],
        excludedReferenceParagraphs: [String],
        referenceSectionTitle: String?,
        sourceMarkdown: String? = nil,
        markdownResourceDirectory: String? = nil,
        markdownSegments: [PaperMarkdownSegment]? = nil,
        extractionEngine: DocumentExtractionEngine? = nil,
        extractionWarning: String? = nil
    ) {
        self.name = name
        self.checksum = checksum
        self.cleanedText = cleanedText
        self.paragraphs = paragraphs
        self.excludedReferenceParagraphs = excludedReferenceParagraphs
        self.referenceSectionTitle = referenceSectionTitle
        self.sourceMarkdown = sourceMarkdown
        self.markdownResourceDirectory = markdownResourceDirectory
        self.markdownSegments = markdownSegments
        self.extractionEngine = extractionEngine
        self.extractionWarning = extractionWarning
    }

    var excludedReferenceCount: Int {
        excludedReferenceParagraphs.count
    }

    var hasStructuredMarkdown: Bool {
        sourceMarkdown?.isEmpty == false && markdownSegments?.isEmpty == false
    }

    var hasFacsimileMarkdown: Bool {
        extractionEngine == .pdfKit &&
            sourceMarkdown?.isEmpty == false &&
            (markdownSegments?.isEmpty ?? true)
    }

    var hasMarkdownBundle: Bool {
        sourceMarkdown?.isEmpty == false && markdownResourceDirectory?.isEmpty == false
    }

    var markdownResourceURL: URL? {
        markdownResourceDirectory.map { URL(fileURLWithPath: $0, isDirectory: true) }
    }

    var originalPDFURL: URL? {
        guard let markdownResourceURL else { return nil }
        let candidate = markdownResourceURL.appendingPathComponent("original.pdf")
        guard FileManager.default.fileExists(atPath: candidate.path) else { return nil }
        return candidate
    }
}

struct SummaryResult: Hashable, Codable {
    let sourceLanguage: ReaderLanguage
    let targetLanguage: ReaderLanguage
    let sourceSummary: String
    let targetSummary: String
}

struct ConnectedTranslationResult: Hashable, Codable {
    let sourceLanguage: ReaderLanguage
    let targetLanguage: ReaderLanguage
    let text: String
    let batchCount: Int
    let failedBatchCount: Int
    let isStructuredMarkdown: Bool?

    init(
        sourceLanguage: ReaderLanguage,
        targetLanguage: ReaderLanguage,
        text: String,
        batchCount: Int,
        failedBatchCount: Int,
        isStructuredMarkdown: Bool = false
    ) {
        self.sourceLanguage = sourceLanguage
        self.targetLanguage = targetLanguage
        self.text = text
        self.batchCount = batchCount
        self.failedBatchCount = failedBatchCount
        self.isStructuredMarkdown = isStructuredMarkdown
    }
}

enum ReaderError: LocalizedError {
    case noPaperLoaded
    case noInputText
    case noParagraphsDetected
    case noSelectedParagraph
    case emptyParagraphEdit
    case droppedFileMustBePDF
    case failedToReadFile(String)

    var errorDescription: String? {
        switch self {
        case .noPaperLoaded:
            return "Open a PDF before starting translation, summary, or explanation."
        case .noInputText:
            return "Paste some text before loading it into the reader."
        case .noParagraphsDetected:
            return "The PDF opened successfully, but no paragraphs were detected after cleaning the extracted text."
        case .noSelectedParagraph:
            return "Choose a paragraph before asking for an explanation."
        case .emptyParagraphEdit:
            return "A paragraph cannot be empty. Enter text or cancel the edit."
        case .droppedFileMustBePDF:
            return "Drop a PDF file to load it into the reader."
        case .failedToReadFile(let details):
            return "The file could not be read. \(details)"
        }
    }
}

enum PromptLibrary {
    static let summarySystemPrompt = """
    You are a careful academic paper assistant.
    Summarize faithfully, stay concise, and never invent details that are not supported by the source text.
    """

    static let explainSystemPrompt = """
    You are a patient academic explainer.
    Explain difficult research writing accurately in simpler language without losing the core meaning.
    """

    static func translationSystemPrompt(targetLanguage: ReaderLanguage) -> String {
        """
        You are an expert scientific translator.
        Preserve scientific meaning exactly.
        Preserve named entities, gene symbols, protein names, units, equations, citations, and reference markers.
        Keep the output natural, clear, and readable for academic readers.
        Return only the \(targetLanguage.displayName) translation text.
        """
    }

    static func translationPrompt(for chunk: String, from sourceLanguage: ReaderLanguage, to targetLanguage: ReaderLanguage) -> String {
        """
        You are a professional \(sourceLanguage.displayName) (\(sourceLanguage.translationCode)) to \(targetLanguage.displayName) (\(targetLanguage.translationCode)) translator. Your goal is to accurately convey the meaning and nuances of the original \(sourceLanguage.displayName) text while adhering to \(targetLanguage.displayName) grammar, vocabulary, and cultural sensitivities for scientific writing.
        Preserve scientific meaning exactly. Preserve named entities, gene symbols, protein names, units, equations, citations, and reference markers. Keep the translation natural and readable.
        Produce only the \(targetLanguage.displayName) translation, without any additional explanations or commentary. Please translate the following \(sourceLanguage.displayName) text into \(targetLanguage.displayName):

        \(chunk)
        """
    }

    static func markdownTranslationPrompt(
        for chunk: String,
        from sourceLanguage: ReaderLanguage,
        to targetLanguage: ReaderLanguage
    ) -> String {
        """
        Translate the natural-language content in this academic Markdown block from \(sourceLanguage.displayName) into \(targetLanguage.displayName).
        Preserve the Markdown structure and line prefixes exactly.
        Tokens beginning with __PAPERBRIDGE_TOKEN_ and ending with __ represent formulas, image links, URLs, code, or HTML and must be copied exactly, character for character, in the same position.
        Preserve scientific meaning, named entities, symbols, units, citations, and reference markers.
        Return only the translated Markdown block, without commentary or code fences around it.

        Markdown block:
        \(chunk)
        """
    }

    static func connectedTranslationPrompt(for batch: String, from sourceLanguage: ReaderLanguage, to targetLanguage: ReaderLanguage) -> String {
        """
        Translate the following academic paper excerpt from \(sourceLanguage.displayName) (\(sourceLanguage.translationCode)) into \(targetLanguage.displayName) (\(targetLanguage.translationCode)).
        Use the larger passage context to keep terminology and phrasing consistent across the excerpt.
        Preserve scientific meaning, named entities, gene symbols, protein names, units, equations, citations, and reference markers.
        Preserve paragraph breaks when they appear in the source.
        Return only the translated excerpt text.

        Paper excerpt:
        \(batch)
        """
    }

    static func summaryPrompt(for batch: String, language: ReaderLanguage) -> String {
        """
        Summarize the following academic paper content in \(language.displayName).
        Focus on:
        - the main research question or problem
        - the approach or methods
        - the most important findings or claims
        - notable limitations or caveats when present

        Keep the summary concise and faithful to the text.

        Paper content:
        \(batch)
        """
    }

    static func mergedSummaryPrompt(partials: [String], language: ReaderLanguage) -> String {
        let bulletList = partials.map { "- \($0)" }.joined(separator: "\n")
        return """
        You are given several partial summaries of the same academic paper.
        Merge them into one clean \(language.displayName) summary.
        Keep it concise, accurate, and non-redundant.

        Partial summaries:
        \(bulletList)
        """
    }

    static func explanationPrompt(for paragraph: String, language: ReaderLanguage) -> String {
        """
        Explain the following academic paragraph in \(language.simpleDescription).
        Keep the explanation accurate, simple, and concise.
        Do not invent claims that are not in the paragraph.

        Paragraph:
        \(paragraph)
        """
    }

    static func selectionTranslationPrompt(
        selection: String,
        context: String,
        from sourceLanguage: ReaderLanguage,
        to targetLanguage: ReaderLanguage
    ) -> String {
        """
        Translate the selected academic text from \(sourceLanguage.displayName) into \(targetLanguage.displayName).
        Use the surrounding paragraph only to resolve terminology, pronouns, abbreviations, and ambiguity.
        Preserve scientific meaning, symbols, units, named entities, and citation markers.
        Return only the translation of the selected text.

        Selected text:
        \(selection)

        Surrounding paragraph:
        \(context)
        """
    }

    static func selectionExplanationPrompt(
        selection: String,
        context: String,
        language: ReaderLanguage
    ) -> String {
        """
        Explain the selected academic text in \(language.simpleDescription).
        Use the surrounding paragraph for context.
        Be concise and accurate, and do not invent claims.

        Selected text:
        \(selection)

        Surrounding paragraph:
        \(context)
        """
    }
}
