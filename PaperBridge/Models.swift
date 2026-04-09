import Foundation

struct AppSettings: Hashable {
    var ollamaBaseURL = "http://localhost:11434"
    var translationModel = "translategemma:12b"
    var summaryModel = "translategemma:12b"
    var explainModel = "translategemma:12b"
    var sourceLanguage: ReaderLanguage = .english
    var targetLanguage: ReaderLanguage = .simplifiedChinese
    var maxParagraphChars = 1800
}

enum ReaderLanguage: String, CaseIterable, Identifiable, Hashable {
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

enum TranslationStatus: String, Hashable {
    case pending
    case ok
    case failed
}

struct ParagraphTranslationSnapshot: Hashable {
    let translation: String
    let status: TranslationStatus
    let errorMessage: String?
    let chunkCount: Int
}

struct ParagraphResult: Identifiable, Hashable {
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

struct PaperDocument: Hashable {
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

struct SummaryResult: Hashable {
    let sourceLanguage: ReaderLanguage
    let targetLanguage: ReaderLanguage
    let sourceSummary: String
    let targetSummary: String
}

enum ReaderError: LocalizedError {
    case noPaperLoaded
    case noParagraphsDetected
    case noSelectedParagraph
    case droppedFileMustBePDF
    case failedToReadFile(String)

    var errorDescription: String? {
        switch self {
        case .noPaperLoaded:
            return "Open a PDF before starting translation, summary, or explanation."
        case .noParagraphsDetected:
            return "The PDF opened successfully, but no paragraphs were detected after cleaning the extracted text."
        case .noSelectedParagraph:
            return "Choose a paragraph before asking for an explanation."
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
}
