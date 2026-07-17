import Foundation

enum AcademicMarkdownError: LocalizedError {
    case protectedTokenChanged(String)

    var errorDescription: String? {
        switch self {
        case .protectedTokenChanged(let token):
            return "The translation model changed a protected formula, image, URL, or code token (\(token)). The paragraph was left unchanged."
        }
    }
}

struct ProtectedMarkdownPayload {
    let text: String
    let replacements: [String: String]
}

enum AcademicMarkdownProcessor {
    static func parse(_ markdown: String) -> [PaperMarkdownSegment] {
        let normalized = markdown
            .replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
        let lines = normalized.components(separatedBy: "\n")
        var segments: [PaperMarkdownSegment] = []
        var index = 0

        func append(kind: MarkdownSegmentKind, source: String, analysisText: String? = nil) {
            let cleanedAnalysis = analysisText?
                .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
                .trimmingCharacters(in: .whitespacesAndNewlines)
            segments.append(
                PaperMarkdownSegment(
                    id: segments.count + 1,
                    kind: kind,
                    source: source,
                    analysisText: cleanedAnalysis?.isEmpty == false ? cleanedAnalysis : nil,
                    paragraphID: nil,
                    isReference: false
                )
            )
        }

        while index < lines.count {
            let line = lines[index]
            let trimmed = line.trimmingCharacters(in: .whitespaces)

            if trimmed.isEmpty {
                var blankCount = 0
                while index < lines.count,
                      lines[index].trimmingCharacters(in: .whitespaces).isEmpty {
                    blankCount += 1
                    index += 1
                }
                append(kind: .separator, source: String(repeating: "\n", count: max(blankCount + 1, 2)))
                continue
            }

            if isFenceStart(trimmed) {
                let marker = trimmed.hasPrefix("~~~") ? "~~~" : "```"
                let start = index
                index += 1
                while index < lines.count {
                    let candidate = lines[index].trimmingCharacters(in: .whitespaces)
                    index += 1
                    if candidate.hasPrefix(marker) { break }
                }
                append(kind: .code, source: lines[start..<index].joined(separator: "\n"))
                continue
            }

            if isDisplayFormulaStart(trimmed) {
                let start = index
                let terminator = trimmed.hasPrefix("\\[") ? "\\]" : "$$"
                index += 1
                if !containsFormulaTerminator(trimmed, terminator: terminator) {
                    while index < lines.count {
                        let candidate = lines[index].trimmingCharacters(in: .whitespaces)
                        index += 1
                        if candidate.contains(terminator) { break }
                    }
                }
                append(kind: .formula, source: lines[start..<index].joined(separator: "\n"))
                continue
            }

            if let htmlTerminator = htmlBlockTerminator(for: trimmed) {
                let start = index
                index += 1
                if trimmed.range(of: htmlTerminator, options: .caseInsensitive) == nil {
                    while index < lines.count {
                        let candidate = lines[index]
                        index += 1
                        if candidate.range(of: htmlTerminator, options: .caseInsensitive) != nil { break }
                    }
                }
                let source = lines[start..<index].joined(separator: "\n")
                append(
                    kind: trimmed.lowercased().hasPrefix("<table") ? .table : .rawHTML,
                    source: source
                )
                continue
            }

            if isImageOnlyLine(trimmed) {
                append(kind: .image, source: line)
                index += 1
                continue
            }

            if isMarkdownTableStart(lines: lines, index: index) {
                let start = index
                index += 2
                while index < lines.count,
                      !lines[index].trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                      lines[index].contains("|") {
                    index += 1
                }
                append(kind: .table, source: lines[start..<index].joined(separator: "\n"))
                continue
            }

            if trimmed.range(of: #"^#{1,6}\s+"#, options: .regularExpression) != nil {
                append(kind: .heading, source: line, analysisText: plainText(from: line))
                index += 1
                continue
            }

            if trimmed.range(of: #"^(?:[-+*]|\d+[.)])\s+"#, options: .regularExpression) != nil {
                let start = index
                index += 1
                while index < lines.count {
                    let continuation = lines[index]
                    let continuationTrimmed = continuation.trimmingCharacters(in: .whitespaces)
                    if continuationTrimmed.isEmpty || startsNewBlock(lines: lines, index: index) { break }
                    guard continuation.first?.isWhitespace == true else { break }
                    index += 1
                }
                let source = lines[start..<index].joined(separator: "\n")
                append(kind: .listItem, source: source, analysisText: plainText(from: source))
                continue
            }

            if trimmed.hasPrefix(">") {
                let start = index
                index += 1
                while index < lines.count,
                      lines[index].trimmingCharacters(in: .whitespaces).hasPrefix(">") {
                    index += 1
                }
                let source = lines[start..<index].joined(separator: "\n")
                append(kind: .quote, source: source, analysisText: plainText(from: source))
                continue
            }

            let start = index
            index += 1
            while index < lines.count {
                if lines[index].trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ||
                    startsNewBlock(lines: lines, index: index) {
                    break
                }
                index += 1
            }
            let source = lines[start..<index].joined(separator: "\n")
            append(kind: .paragraph, source: source, analysisText: plainText(from: source))
        }

        return segments
    }

    static func assignParagraphs(
        in parsedSegments: [PaperMarkdownSegment]
    ) -> (
        segments: [PaperMarkdownSegment],
        paragraphs: [String],
        referenceParagraphs: [String],
        referenceHeading: String?
    ) {
        var segments = parsedSegments
        let candidateIndices = segments.indices.filter { index in
            segments[index].kind.isTranslatable && segments[index].analysisText?.isEmpty == false
        }
        let candidateTexts = candidateIndices.compactMap { segments[$0].analysisText }
        let trimmed = TextProcessing.excludeReferenceSection(from: candidateTexts)
        let referenceRange = contiguousRange(of: trimmed.referenceParagraphs, in: candidateTexts)
        var paragraphID = 1

        // Mark the complete Markdown span as references so figures, formulas, and
        // tables inside the bibliography are omitted from the translated reader too.
        if let referenceRange, let firstOffset = referenceRange.first {
            let firstSegmentIndex = candidateIndices[firstOffset]
            let endSegmentIndex = referenceRange.upperBound < candidateIndices.count
                ? candidateIndices[referenceRange.upperBound]
                : segments.endIndex
            for segmentIndex in firstSegmentIndex..<endSegmentIndex {
                segments[segmentIndex].isReference = true
            }
        }

        for (candidateOffset, segmentIndex) in candidateIndices.enumerated() {
            if let referenceRange, referenceRange.contains(candidateOffset) {
                continue
            }

            segments[segmentIndex].paragraphID = paragraphID
            paragraphID += 1
        }

        let bodyParagraphs = segments.compactMap { segment -> String? in
            guard segment.paragraphID != nil else { return nil }
            return segment.analysisText
        }
        let referenceParagraphs = segments.compactMap { segment -> String? in
            guard segment.isReference else { return nil }
            return segment.analysisText
        }

        return (segments, bodyParagraphs, referenceParagraphs, trimmed.heading)
    }

    static func readerFlowItems(
        segments: [PaperMarkdownSegment],
        results: [ParagraphResult]
    ) -> [ReaderFlowItem] {
        let resultByID = Dictionary(uniqueKeysWithValues: results.map { ($0.id, $0) })

        return segments.compactMap { segment in
            guard !segment.isReference else { return nil }

            if let paragraphID = segment.paragraphID,
               let result = resultByID[paragraphID] {
                return .paragraph(result)
            }

            switch segment.kind {
            case .image, .formula, .table, .code, .rawHTML:
                return .resource(
                    ReaderResourceBlock(
                        id: segment.id,
                        kind: segment.kind,
                        markdown: segment.source
                    )
                )
            case .heading, .paragraph, .listItem, .quote, .separator:
                return nil
            }
        }
    }

    static func plainText(from markdown: String) -> String {
        var text = markdown
        text = replacingMatches(in: text, pattern: #"(?s)!\[[^\]]*\]\([^)]+\)"#, template: " ")
        text = replacingMatches(in: text, pattern: #"(?m)^\s*#{1,6}\s+"#, template: "")
        text = replacingMatches(in: text, pattern: #"(?m)^\s*(?:[-+*]|\d+[.)])\s+"#, template: "")
        text = replacingMatches(in: text, pattern: #"(?m)^\s*>\s?"#, template: "")
        text = replacingMatches(in: text, pattern: #"\[([^\]]+)\]\([^)]+\)"#, template: "$1")
        text = replacingMatches(in: text, pattern: #"</?[^>]+>"#, template: " ")
        text = text
            .replacingOccurrences(of: "`", with: "")
            .replacingOccurrences(of: "**", with: "")
            .replacingOccurrences(of: "__", with: "")
            .replacingOccurrences(of: "~~", with: "")
            .replacingOccurrences(of: "&nbsp;", with: " ")
            .replacingOccurrences(of: "&amp;", with: "&")
            .replacingOccurrences(of: "&lt;", with: "<")
            .replacingOccurrences(of: "&gt;", with: ">")
            .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return text
    }

    static func protectForTranslation(_ markdown: String) -> ProtectedMarkdownPayload {
        let patterns = [
            #"(?s)!\[[^\]]*\]\([^)]+\)"#,
            #"(?s)\$\$.*?\$\$"#,
            #"(?s)\\\[.*?\\\]"#,
            #"(?s)\\\(.*?\\\)"#,
            #"`[^`\n]+`"#,
            #"https?://[^\s)>]+"#,
            #"<[^>]+>"#,
            #"(?<!\\)\$(?!\$)(?:\\.|[^$\n])+\$"#
        ]
        var protectedText = markdown
        var replacements: [String: String] = [:]
        var tokenIndex = 1

        for pattern in patterns {
            guard let regex = try? NSRegularExpression(pattern: pattern) else { continue }
            let range = NSRange(protectedText.startIndex..<protectedText.endIndex, in: protectedText)
            let matches = regex.matches(in: protectedText, range: range)
            for match in matches.reversed() {
                guard let swiftRange = Range(match.range, in: protectedText) else { continue }
                let token = String(format: "__PAPERBRIDGE_TOKEN_%04d__", tokenIndex)
                replacements[token] = String(protectedText[swiftRange])
                protectedText.replaceSubrange(swiftRange, with: token)
                tokenIndex += 1
            }
        }

        return ProtectedMarkdownPayload(text: protectedText, replacements: replacements)
    }

    static func restoreProtectedTokens(
        in translatedText: String,
        from payload: ProtectedMarkdownPayload
    ) throws -> String {
        var restored = translatedText
        for token in payload.replacements.keys.sorted() {
            guard restored.contains(token), let original = payload.replacements[token] else {
                throw AcademicMarkdownError.protectedTokenChanged(token)
            }
            restored = restored.replacingOccurrences(of: token, with: original)
        }
        return restored.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    static func translatedMarkdown(
        segments: [PaperMarkdownSegment],
        results: [ParagraphResult]
    ) -> String {
        let resultByID = Dictionary(uniqueKeysWithValues: results.map { ($0.id, $0) })
        return render(segments: segments) { segment in
            guard let paragraphID = segment.paragraphID,
                  let result = resultByID[paragraphID],
                  result.status == .ok else {
                return segment.source
            }
            return result.translationMarkdown ?? applyStructure(of: segment, to: result.translation)
        }
    }

    static func bilingualMarkdown(
        segments: [PaperMarkdownSegment],
        results: [ParagraphResult],
        targetLanguage: ReaderLanguage
    ) -> String {
        let resultByID = Dictionary(uniqueKeysWithValues: results.map { ($0.id, $0) })
        return render(segments: segments) { segment in
            guard let paragraphID = segment.paragraphID,
                  let result = resultByID[paragraphID],
                  result.status == .ok else {
                return segment.source
            }

            let translation = result.translationMarkdown ?? applyStructure(of: segment, to: result.translation)
            if segment.kind == .heading {
                return segment.source + "\n\n" + translation
            }

            let quotedTranslation = translation
                .components(separatedBy: "\n")
                .map { $0.isEmpty ? ">" : "> \($0)" }
                .joined(separator: "\n")
            return """
            \(segment.source)

            > **\(targetLanguage.displayName) translation**
            >
            \(quotedTranslation)
            """
        }
    }

    static func localAssetPaths(in markdown: String) -> Set<String> {
        let patterns = [
            #"!\[[^\]]*\]\((?:<)?([^)>\s]+)(?:>)?(?:\s+[^)]*)?\)"#,
            #"(?<!!)\[[^\]]+\]\((?:<)?([^)>\s]+)(?:>)?(?:\s+[^)]*)?\)"#,
            #"(?i)<img\b[^>]*\bsrc\s*=\s*[\"']([^\"']+)[\"']"#
        ]
        var paths: Set<String> = []

        for pattern in patterns {
            guard let regex = try? NSRegularExpression(pattern: pattern) else { continue }
            let range = NSRange(markdown.startIndex..<markdown.endIndex, in: markdown)
            for match in regex.matches(in: markdown, range: range) {
                guard match.numberOfRanges > 1,
                      let swiftRange = Range(match.range(at: 1), in: markdown) else { continue }
                let rawPath = String(markdown[swiftRange])
                    .removingPercentEncoding ?? String(markdown[swiftRange])
                let lowercased = rawPath.lowercased()
                guard !rawPath.hasPrefix("/"),
                      !rawPath.hasPrefix("#"),
                      !lowercased.hasPrefix("http://"),
                      !lowercased.hasPrefix("https://"),
                      !lowercased.hasPrefix("data:"),
                      lowercased.range(
                        of: #"^[a-z][a-z0-9+.-]*:"#,
                        options: .regularExpression
                      ) == nil else { continue }
                paths.insert(rawPath)
            }
        }

        return paths
    }

    private static func render(
        segments: [PaperMarkdownSegment],
        transform: (PaperMarkdownSegment) -> String
    ) -> String {
        var output = ""
        for segment in segments {
            if segment.kind == .separator {
                if !output.hasSuffix("\n") { output.append("\n") }
                output.append(segment.source)
                continue
            }

            if !output.isEmpty, !output.hasSuffix("\n") {
                output.append("\n")
            }
            output.append(transform(segment))
        }
        return output
            .replacingOccurrences(of: #"\n{4,}"#, with: "\n\n\n", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
            + "\n"
    }

    private static func applyStructure(of segment: PaperMarkdownSegment, to translation: String) -> String {
        let trimmedTranslation = translation.trimmingCharacters(in: .whitespacesAndNewlines)
        switch segment.kind {
        case .heading:
            let prefix = segment.source.prefix { $0 == "#" }
            return "\(prefix) \(trimmedTranslation)"
        case .listItem:
            if let match = segment.source.range(
                of: #"^\s*(?:[-+*]|\d+[.)])\s+"#,
                options: .regularExpression
            ) {
                return String(segment.source[match]) + trimmedTranslation
            }
            return trimmedTranslation
        case .quote:
            return trimmedTranslation
                .components(separatedBy: "\n")
                .map { "> \($0)" }
                .joined(separator: "\n")
        default:
            return trimmedTranslation
        }
    }

    private static func contiguousRange<T: Equatable>(of needle: [T], in haystack: [T]) -> Range<Int>? {
        guard !needle.isEmpty, needle.count <= haystack.count else { return nil }
        for start in 0...(haystack.count - needle.count) {
            let end = start + needle.count
            if Array(haystack[start..<end]) == needle {
                return start..<end
            }
        }
        return nil
    }

    private static func startsNewBlock(lines: [String], index: Int) -> Bool {
        guard lines.indices.contains(index) else { return false }
        let trimmed = lines[index].trimmingCharacters(in: .whitespaces)
        return isFenceStart(trimmed) ||
            isDisplayFormulaStart(trimmed) ||
            htmlBlockTerminator(for: trimmed) != nil ||
            isImageOnlyLine(trimmed) ||
            isMarkdownTableStart(lines: lines, index: index) ||
            trimmed.range(of: #"^#{1,6}\s+"#, options: .regularExpression) != nil ||
            trimmed.range(of: #"^(?:[-+*]|\d+[.)])\s+"#, options: .regularExpression) != nil ||
            trimmed.hasPrefix(">")
    }

    private static func isFenceStart(_ line: String) -> Bool {
        line.hasPrefix("```") || line.hasPrefix("~~~")
    }

    private static func isDisplayFormulaStart(_ line: String) -> Bool {
        line.hasPrefix("$$") || line.hasPrefix("\\[")
    }

    private static func containsFormulaTerminator(_ line: String, terminator: String) -> Bool {
        if terminator == "$$" {
            return line.components(separatedBy: "$$").count > 2
        }
        return line.dropFirst(2).contains(terminator)
    }

    private static func htmlBlockTerminator(for line: String) -> String? {
        let lowercased = line.lowercased()
        if lowercased.hasPrefix("<table") { return "</table>" }
        if lowercased.hasPrefix("<details") { return "</details>" }
        if lowercased.hasPrefix("<figure") { return "</figure>" }
        return nil
    }

    private static func isImageOnlyLine(_ line: String) -> Bool {
        line.range(
            of: #"^(?:!\[[^\]]*\]\([^)]+\)\s*)+$"#,
            options: .regularExpression
        ) != nil || line.lowercased().hasPrefix("<img ")
    }

    private static func isMarkdownTableStart(lines: [String], index: Int) -> Bool {
        guard lines.indices.contains(index), lines.indices.contains(index + 1), lines[index].contains("|") else {
            return false
        }
        let delimiter = lines[index + 1].trimmingCharacters(in: .whitespaces)
        return delimiter.range(
            of: #"^\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?$"#,
            options: .regularExpression
        ) != nil
    }

    private static func replacingMatches(in text: String, pattern: String, template: String) -> String {
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return text }
        let range = NSRange(text.startIndex..<text.endIndex, in: text)
        return regex.stringByReplacingMatches(in: text, range: range, withTemplate: template)
    }
}
