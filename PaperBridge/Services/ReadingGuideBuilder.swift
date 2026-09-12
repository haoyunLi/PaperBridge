import Foundation

struct ReadingGuideEntry: Identifiable, Equatable {
    let id: String
    let title: String
    let question: String
    let sectionTitle: String
    let paragraphID: Int
    let excerpt: String
}

enum ReadingGuideBuilder {
    private struct Topic {
        let id: String
        let title: String
        let question: String
        let headings: [String]
    }

    private static let topics = [
        Topic(id: "question", title: "The research question", question: "What problem does this paper address?", headings: ["abstract", "introduction", "background", "摘要", "引言", "背景"]),
        Topic(id: "method", title: "The approach", question: "How did the authors investigate it?", headings: ["method", "methods", "methodology", "materials and methods", "approach", "model", "architecture", "方法", "材料与方法"]),
        Topic(id: "evidence", title: "The evidence", question: "Which experiments support the claims?", headings: ["results", "experiments", "evaluation", "experimental results", "结果", "实验"]),
        Topic(id: "limits", title: "Interpretation and limits", question: "Where should the conclusions be treated cautiously?", headings: ["limitations", "discussion", "limitations and discussion", "讨论", "局限性"]),
        Topic(id: "conclusion", title: "The takeaway", question: "What do the authors conclude?", headings: ["conclusion", "conclusions", "concluding remarks", "结论"]),
    ]

    static func build(for paper: PaperDocument) -> [ReadingGuideEntry] {
        guard !paper.paragraphs.isEmpty else { return [] }
        var headings: [Int: String] = [:]
        for segment in paper.markdownSegments ?? [] where segment.kind == .heading && !segment.isReference {
            if let id = segment.paragraphID, id > 0, id <= paper.paragraphs.count,
               let title = segment.analysisText { headings[id] = title }
        }
        for (index, paragraph) in paper.paragraphs.enumerated() where headings[index + 1] == nil {
            if let heading = TextProcessing.detectedSectionTitle(in: paragraph) { headings[index + 1] = heading }
        }
        let ordered = headings.sorted { $0.key < $1.key }
        var entries: [ReadingGuideEntry] = []
        for topic in topics {
            guard let match = ordered.first(where: { matches($0.value, names: topic.headings) }) else { continue }
            let end = ordered.first(where: { $0.key > match.key })?.key ?? paper.paragraphs.count + 1
            // Only quote inside the detected section; never borrow evidence from the next one.
            guard let sourceID = (match.key..<end).first(where: { id in
                let text = paper.paragraphs[id - 1].trimmingCharacters(in: .whitespacesAndNewlines)
                return text.count >= 40 && normalized(text) != normalized(headings[id] ?? "")
            }) else { continue }
            entries.append(ReadingGuideEntry(id: topic.id, title: topic.title, question: topic.question,
                sectionTitle: match.value, paragraphID: sourceID, excerpt: paper.paragraphs[sourceID - 1]))
        }
        if entries.isEmpty, let index = paper.paragraphs.firstIndex(where: { $0.count >= 40 }) {
            entries = [ReadingGuideEntry(id: "beginning", title: "Start at the beginning",
                question: "Section headings were not identified reliably. Read the source before drawing conclusions.",
                sectionTitle: "Opening passage", paragraphID: index + 1, excerpt: paper.paragraphs[index])]
        }
        return entries
    }

    private static func normalized(_ value: String) -> String {
        value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            .replacingOccurrences(of: #"^(?:\d+(?:\.\d+)*[.)]?|[ivx]+\.)\s+"#, with: "", options: .regularExpression)
            .trimmingCharacters(in: CharacterSet(charactersIn: ".:： "))
    }

    private static func matches(_ heading: String, names: [String]) -> Bool {
        let title = normalized(heading)
        return names.contains { title == $0 || title.hasPrefix($0 + ":") || title.hasPrefix($0 + " and ") }
    }

    static let sampleParagraphs = [
        "Abstract",
        "This is a fictional practice document, not a published study. Use it to explore source-linked reading, translation, highlights, and notes without importing a personal paper.",
        "1 Introduction",
        "Reading a paper across languages involves more than translating its sentences. Readers need to connect a claim to the method and evidence that support it.",
        "2 Methods",
        "Start with the reading map, then open the linked source passage. Translate one paragraph when needed, or translate the whole document with a local Ollama model.",
        "3 Results",
        "Selecting a phrase opens tools for translation, explanation, highlighting, and notes. This practice document contains no measured results or claims about model accuracy.",
        "4 Limitations",
        "A summary is a reading aid, not a substitute for evidence. PDF text extraction and local models can make mistakes; compare uncertain passages with the Original PDF when one is available.",
        "5 Conclusion",
        "Keep useful passages in bookmarks, retain your notes, and export the material you want to revisit. This sample requires no model until you choose an AI action."
    ]
}
