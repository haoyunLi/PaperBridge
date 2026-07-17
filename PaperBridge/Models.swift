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
    case reader
    case summary
    case fullTranslation

    var id: String { rawValue }

    var displayName: String {
        switch self {
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

struct ReaderTextSelection: Hashable {
    let paragraphID: Int
    let side: ReaderTextSide
    let text: String
    let context: String
    let rangeLocation: Int
    let rangeLength: Int

    var identity: String {
        "\(paragraphID)|\(side.rawValue)|\(rangeLocation)|\(rangeLength)|\(text)"
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
        self.highlightColor = highlightColor
        self.note = note
        self.createdAt = createdAt
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
    let status: TranslationStatus
    let errorMessage: String?
    let chunkCount: Int
}

struct ParagraphResult: Identifiable, Hashable, Codable {
    let id: Int
    let original: String
    var translation: String = ""
    var status: TranslationStatus = .pending
    var errorMessage: String?
    var chunkCount: Int = 0

    var previewText: String {
        let flattened = original.replacingOccurrences(of: "\n", with: " ")
        guard flattened.count > 96 else { return flattened }
        return String(flattened.prefix(93)) + "..."
    }
}

struct PaperDocument: Hashable, Codable {
    let name: String
    let checksum: String
    let cleanedText: String
    let paragraphs: [String]
    let excludedReferenceParagraphs: [String]
    let referenceSectionTitle: String?

    var excludedReferenceCount: Int {
        excludedReferenceParagraphs.count
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
