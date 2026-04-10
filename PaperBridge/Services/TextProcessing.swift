import Foundation
import NaturalLanguage
import CoreGraphics

struct ExtractedTextLine {
    let text: String
    let bounds: CGRect
}

enum TextProcessing {
    static let summaryBatchChars = 6000
    static let connectedTranslationBatchChars = 4800
    private static let referenceHeadings = [
        "references",
        "bibliography",
        "works cited",
        "literature cited",
        "reference list"
    ]
    private static let majorSectionHeadings = [
        "abstract",
        "introduction",
        "background",
        "related work",
        "method",
        "methods",
        "methodology",
        "materials and methods",
        "experimental setup",
        "experiments",
        "evaluation",
        "results",
        "discussion",
        "conclusion",
        "conclusions",
        "appendix",
        "acknowledgements",
        "acknowledgments"
    ]
    private static let captionPrefixes = [
        "fig",
        "figure",
        "table",
        "equation",
        "eq",
        "algorithm"
    ]
    private static let frontMatterSignals = [
        "@",
        "arxiv",
        "www",
        "home page",
        "data set provided by",
        "department",
        "university",
        "institute",
        "laboratory",
        "centre",
        "center",
        "medical center"
    ]

    static func normalizeExtractedLine(_ text: String) -> String {
        let noTabs = text.replacingOccurrences(of: "\t", with: " ")
        let singleLine = replaceMatches(in: noTabs, pattern: "\\s*\\n\\s*", template: " ")
        return replaceMatches(in: singleLine, pattern: "\\s{2,}", template: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    static func cleanExtractedText(_ text: String) -> String {
        var cleaned = text
            .replacingOccurrences(of: "\r", with: "\n")
            .replacingOccurrences(of: "\u{00AD}", with: "")

        cleaned = replaceMatches(in: cleaned, pattern: "(\\w)-\\n(\\w)", template: "$1$2")
        cleaned = replaceMatches(in: cleaned, pattern: "[ \\t]+\\n", template: "\n")
        cleaned = replaceMatches(in: cleaned, pattern: "\\n{3,}", template: "\n\n")

        let paragraphs = cleaned
            .components(separatedBy: "\n\n")
            .compactMap { rawParagraph -> String? in
                let trimmed = rawParagraph.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !trimmed.isEmpty else { return nil }

                let flattened = replaceMatches(in: trimmed, pattern: "\\s*\\n\\s*", template: " ")
                let normalized = replaceMatches(in: flattened, pattern: "\\s{2,}", template: " ")
                    .trimmingCharacters(in: .whitespacesAndNewlines)

                return normalized.isEmpty ? nil : normalized
            }

        return paragraphs.joined(separator: "\n\n")
    }

    static func rebuildParagraphs(fromPageText text: String) -> [String] {
        let normalized = text
            .replacingOccurrences(of: "\r", with: "\n")
            .replacingOccurrences(of: "\u{00AD}", with: "")

        let lines = normalized
            .components(separatedBy: .newlines)
            .map(normalizeExtractedLine)
            .filter { !$0.isEmpty }

        guard !lines.isEmpty else { return [] }

        let medianLength = median(lines.map { Double($0.count) }) ?? 90
        var paragraphs: [String] = []
        var currentLines: [String] = []

        func flush() {
            let paragraph = joinParagraphLines(currentLines)
            if !paragraph.isEmpty {
                paragraphs.append(paragraph)
            }
            currentLines.removeAll()
        }

        for line in lines {
            if shouldSkipStandaloneLine(line) {
                flush()
                continue
            }

            if isLikelySectionHeading(line) {
                flush()
                paragraphs.append(line)
                continue
            }

            guard let previousLine = currentLines.last else {
                currentLines = [line]
                continue
            }

            if shouldBreakParagraph(
                after: previousLine,
                before: line,
                previousLineLength: Double(previousLine.count),
                referenceLineLength: medianLength,
                previousIndent: 0,
                currentIndent: 0,
                verticalGap: 0
            ) {
                flush()
                currentLines = [line]
            } else {
                currentLines.append(line)
            }
        }

        flush()
        return postProcessParagraphs(paragraphs)
    }

    static func rebuildParagraphs(from lines: [ExtractedTextLine], pageBounds: CGRect) -> [String] {
        let normalizedLines = lines.map {
            ExtractedTextLine(
                text: normalizeExtractedLine($0.text),
                bounds: $0.bounds
            )
        }
        .filter { !$0.text.isEmpty }

        guard !normalizedLines.isEmpty else { return [] }

        let nonZeroHeights = normalizedLines.map(\.bounds.height).filter { $0 > 0 }
        let medianLineHeight = median(nonZeroHeights.map(Double.init)).map { CGFloat($0) } ?? 12
        let referenceLineLength = median(normalizedLines.map { Double($0.text.count) }) ?? 90
        let baseIndent = normalizedLines.map(\.bounds.minX).min() ?? pageBounds.minX

        var paragraphs: [String] = []
        var currentLines: [ExtractedTextLine] = []

        func flush() {
            let paragraph = joinParagraphLines(currentLines.map(\.text))
            if !paragraph.isEmpty {
                paragraphs.append(paragraph)
            }
            currentLines.removeAll()
        }

        for line in normalizedLines {
            if shouldSkipStandaloneLine(line.text) && isLikelyFooterOrPageNumber(line, in: pageBounds) {
                flush()
                continue
            }

            if isLikelySectionHeading(line.text) {
                flush()
                paragraphs.append(line.text)
                continue
            }

            guard let previous = currentLines.last else {
                currentLines = [line]
                continue
            }

            let verticalGap = max(0, previous.bounds.minY - line.bounds.maxY)
            let previousIndent = previous.bounds.minX - baseIndent
            let currentIndent = line.bounds.minX - baseIndent

            if shouldBreakParagraph(
                after: previous.text,
                before: line.text,
                previousLineLength: Double(previous.text.count),
                referenceLineLength: referenceLineLength,
                previousIndent: previousIndent,
                currentIndent: currentIndent,
                verticalGap: verticalGap,
                medianLineHeight: medianLineHeight
            ) {
                flush()
                currentLines = [line]
            } else {
                currentLines.append(line)
            }
        }

        flush()
        return postProcessParagraphs(paragraphs)
    }

    static func splitIntoParagraphs(_ text: String) -> [String] {
        text.components(separatedBy: "\n\n")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
    }

    static func excludeReferenceSection(from paragraphs: [String]) -> (
        bodyParagraphs: [String],
        referenceParagraphs: [String],
        heading: String?
    ) {
        guard paragraphs.count >= 5 else {
            return (paragraphs, [], nil)
        }

        let searchStartIndex = max(Int(Double(paragraphs.count) * 0.45), 3)

        if let explicitReferenceStart = detectExplicitReferenceHeading(in: paragraphs, searchStartIndex: searchStartIndex) {
            return (
                Array(paragraphs.prefix(explicitReferenceStart.index)),
                Array(paragraphs.suffix(from: explicitReferenceStart.index)),
                explicitReferenceStart.heading
            )
        }

        if let inferredReferenceStart = detectImplicitReferenceSectionStart(in: paragraphs, searchStartIndex: searchStartIndex) {
            return (
                Array(paragraphs.prefix(inferredReferenceStart)),
                Array(paragraphs.suffix(from: inferredReferenceStart)),
                nil
            )
        }

        return (paragraphs, [], nil)
    }

    static func splitIntoSentences(_ paragraph: String) -> [String] {
        let trimmed = paragraph.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return [] }

        let tokenizer = NLTokenizer(unit: .sentence)
        tokenizer.string = trimmed

        var sentences: [String] = []
        tokenizer.enumerateTokens(in: trimmed.startIndex..<trimmed.endIndex) { range, _ in
            let sentence = trimmed[range].trimmingCharacters(in: .whitespacesAndNewlines)
            if !sentence.isEmpty {
                sentences.append(sentence)
            }
            return true
        }

        let normalizedSentences = mergeSentenceFragments(sentences)
        return normalizedSentences.isEmpty ? [trimmed] : normalizedSentences
    }

    static func forceSplitText(_ text: String, maxChars: Int) -> [String] {
        let words = text.split(whereSeparator: \.isWhitespace).map(String.init)
        guard !words.isEmpty else {
            var pieces: [String] = []
            var current = text.startIndex

            while current < text.endIndex {
                let end = text.index(current, offsetBy: maxChars, limitedBy: text.endIndex) ?? text.endIndex
                let piece = String(text[current..<end]).trimmingCharacters(in: .whitespacesAndNewlines)
                if !piece.isEmpty {
                    pieces.append(piece)
                }
                current = end
            }

            return pieces
        }

        var pieces: [String] = []
        var currentWords: [String] = []
        var currentLength = 0

        for word in words {
            if word.count > maxChars {
                if !currentWords.isEmpty {
                    pieces.append(currentWords.joined(separator: " "))
                    currentWords.removeAll()
                    currentLength = 0
                }

                var wordStart = word.startIndex
                while wordStart < word.endIndex {
                    let wordEnd = word.index(wordStart, offsetBy: maxChars, limitedBy: word.endIndex) ?? word.endIndex
                    pieces.append(String(word[wordStart..<wordEnd]))
                    wordStart = wordEnd
                }
                continue
            }

            let projectedLength = currentLength + word.count + (currentWords.isEmpty ? 0 : 1)
            if !currentWords.isEmpty && projectedLength > maxChars {
                pieces.append(currentWords.joined(separator: " "))
                currentWords = [word]
                currentLength = word.count
            } else {
                currentWords.append(word)
                currentLength = projectedLength
            }
        }

        if !currentWords.isEmpty {
            pieces.append(currentWords.joined(separator: " "))
        }

        return pieces
    }

    static func chunkParagraph(_ paragraph: String, maxChars: Int) -> [String] {
        let trimmed = paragraph.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return [] }
        guard trimmed.count > maxChars else { return [trimmed] }

        var chunks: [String] = []
        var currentChunk = ""

        for sentence in splitIntoSentences(trimmed) {
            let sentencePieces = splitLongSentence(sentence, maxChars: maxChars)

            for piece in sentencePieces {
                if currentChunk.isEmpty {
                    currentChunk = piece
                    continue
                }

                let projectedLength = currentChunk.count + piece.count + 1
                if projectedLength <= maxChars {
                    currentChunk += " " + piece
                } else {
                    chunks.append(currentChunk)
                    currentChunk = piece
                }
            }
        }

        if !currentChunk.isEmpty {
            chunks.append(currentChunk)
        }

        return chunks
    }

    static func splitLongSentence(_ sentence: String, maxChars: Int) -> [String] {
        guard sentence.count > maxChars else {
            return [sentence]
        }

        let breakPatterns = [
            #"(?<=[;:])\s+"#,
            #"(?<=[,])\s+"#
        ]

        var pieces = [sentence]

        for pattern in breakPatterns {
            pieces = pieces.flatMap { piece -> [String] in
                guard piece.count > maxChars else { return [piece] }
                let candidatePieces = splitByRegexBoundary(piece, pattern: pattern)
                guard candidatePieces.count > 1 else { return [piece] }
                return packSegments(candidatePieces, maxChars: maxChars)
            }
        }

        return pieces.flatMap { piece in
            piece.count > maxChars ? forceSplitText(piece, maxChars: maxChars) : [piece]
        }
    }

    static func buildTextBatches(_ paragraphs: [String], maxChars: Int = summaryBatchChars) -> [String] {
        var batches: [String] = []
        var currentBatch: [String] = []
        var currentLength = 0

        for paragraph in paragraphs {
            let pieces = paragraph.count > maxChars ? chunkParagraph(paragraph, maxChars: maxChars) : [paragraph]

            for piece in pieces {
                let projectedLength = currentLength + piece.count + (currentBatch.isEmpty ? 0 : 2)
                if !currentBatch.isEmpty && projectedLength > maxChars {
                    batches.append(currentBatch.joined(separator: "\n\n"))
                    currentBatch = [piece]
                    currentLength = piece.count
                } else {
                    currentBatch.append(piece)
                    currentLength = projectedLength
                }
            }
        }

        if !currentBatch.isEmpty {
            batches.append(currentBatch.joined(separator: "\n\n"))
        }

        return batches
    }

    static func postProcessParagraphs(_ paragraphs: [String]) -> [String] {
        guard !paragraphs.isEmpty else { return [] }

        var expanded: [String] = []
        for paragraph in paragraphs {
            expanded.append(contentsOf: splitParagraphAroundInlineSectionMarkers(paragraph))
        }

        let mergedOpening = mergeOpeningFragments(expanded)
        let withoutFrontMatter = removeLeadingMetadataParagraphs(from: mergedOpening)
        let mergedHeadings = mergeSectionLabelsWithFollowingBody(withoutFrontMatter)
        let withoutRunningHeaders = stripRepeatedRunningHeaders(from: mergedHeadings)

        var normalized: [String] = []
        var index = 0

        while index < withoutRunningHeaders.count {
            let current = withoutRunningHeaders[index].trimmingCharacters(in: .whitespacesAndNewlines)
            let next = index + 1 < withoutRunningHeaders.count ? withoutRunningHeaders[index + 1] : nil
            let previous = normalized.last

            guard !current.isEmpty else {
                index += 1
                continue
            }

            if let previous,
               shouldMergeParagraph(current, intoPrevious: previous, next: next) {
                normalized[normalized.count - 1] = mergeParagraphs(previous, current)
                index += 1
                continue
            }

            if let next, shouldMergeParagraph(current, withNext: next) {
                normalized.append(mergeParagraphs(current, next))
                index += 2
                continue
            }

            if shouldDropStructuralArtifact(current, previous: previous, next: next) {
                index += 1
                continue
            }

            normalized.append(current)
            index += 1
        }

        let sentenceClosed = ensureSentenceClosedParagraphs(normalized)
        let readable = splitLongReadableParagraphs(sentenceClosed)
        return readable.filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    }

    private static func replaceMatches(in text: String, pattern: String, template: String) -> String {
        guard let regex = try? NSRegularExpression(pattern: pattern) else {
            return text
        }

        let range = NSRange(text.startIndex..<text.endIndex, in: text)
        return regex.stringByReplacingMatches(in: text, range: range, withTemplate: template)
    }

    private static func splitByRegexBoundary(_ text: String, pattern: String) -> [String] {
        guard let regex = try? NSRegularExpression(pattern: pattern) else {
            return [text]
        }

        let fullRange = NSRange(text.startIndex..<text.endIndex, in: text)
        let matches = regex.matches(in: text, range: fullRange)
        guard !matches.isEmpty else { return [text] }

        var segments: [String] = []
        var currentLocation = fullRange.location

        for match in matches {
            let segmentRange = NSRange(location: currentLocation, length: match.range.location - currentLocation)
            if let range = Range(segmentRange, in: text) {
                let segment = String(text[range]).trimmingCharacters(in: .whitespacesAndNewlines)
                if !segment.isEmpty {
                    segments.append(segment)
                }
            }
            currentLocation = match.range.location + match.range.length
        }

        let tailRange = NSRange(location: currentLocation, length: fullRange.location + fullRange.length - currentLocation)
        if let range = Range(tailRange, in: text) {
            let tail = String(text[range]).trimmingCharacters(in: .whitespacesAndNewlines)
            if !tail.isEmpty {
                segments.append(tail)
            }
        }

        return segments.isEmpty ? [text] : segments
    }

    private static func packSegments(_ segments: [String], maxChars: Int) -> [String] {
        var packed: [String] = []
        var current = ""

        for segment in segments {
            let trimmed = segment.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else { continue }

            if current.isEmpty {
                current = trimmed
                continue
            }

            let projectedLength = current.count + trimmed.count + 1
            if projectedLength <= maxChars {
                current += " " + trimmed
            } else {
                packed.append(current)
                current = trimmed
            }
        }

        if !current.isEmpty {
            packed.append(current)
        }

        return packed
    }

    private static func splitParagraphAroundInlineSectionMarkers(_ paragraph: String) -> [String] {
        let trimmed = paragraph.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return [] }

        if let titleAuthorSplit = titleAuthorBoundarySplit(in: trimmed) {
            return titleAuthorSplit.flatMap(splitParagraphAroundInlineSectionMarkers)
        }

        if let leadingReferenceSplit = leadingReferenceHeadingSplit(in: trimmed) {
            return leadingReferenceSplit
        }

        guard let splitRange = inlineSectionBoundaryRange(in: trimmed) else {
            return [trimmed]
        }
        guard splitRange.lowerBound > trimmed.startIndex else {
            return [trimmed]
        }

        let leading = String(trimmed[..<splitRange.lowerBound]).trimmingCharacters(in: .whitespacesAndNewlines)
        let trailing = String(trimmed[splitRange.lowerBound...]).trimmingCharacters(in: .whitespacesAndNewlines)

        var parts: [String] = []
        if !leading.isEmpty {
            parts.append(leading)
        }
        if !trailing.isEmpty {
            parts.append(contentsOf: splitParagraphAroundInlineSectionMarkers(trailing))
        }

        return parts.isEmpty ? [trimmed] : parts
    }

    private static func leadingReferenceHeadingSplit(in text: String) -> [String]? {
        let lowered = text.lowercased()

        for heading in referenceHeadings {
            guard lowered.hasPrefix(heading) else { continue }

            let headingEnd = text.index(text.startIndex, offsetBy: heading.count)
            let trailing = text[headingEnd...].trimmingCharacters(in: .punctuationCharacters.union(.whitespacesAndNewlines))
            guard !trailing.isEmpty else { return [heading.capitalized] }
            let looksLikeInlineReference = trailing.range(of: #"^(?:\[\d+\]|\d+\.)"#, options: .regularExpression) != nil ||
                isLikelyReferenceEntry(trailing) ||
                (countMatches(in: trailing, pattern: #"\b(?:19|20)\d{2}[a-z]?\b"#) >= 1 && trailing.filter { $0 == "," }.count >= 2)

            guard looksLikeInlineReference else {
                continue
            }

            return [heading.capitalized, trailing]
        }

        return nil
    }

    private static func titleAuthorBoundarySplit(in text: String) -> [String]? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        let words = trimmed.split(whereSeparator: \.isWhitespace)

        guard words.count >= 8, words.count <= 40 else { return nil }
        guard !startsWithMajorSectionLead(trimmed), !isLikelyCaption(trimmed), !isReferenceHeading(trimmed) else {
            return nil
        }

        let minimumSplitIndex = min(max(6, 4), max(words.count - 3, 6))

        for splitIndex in minimumSplitIndex..<(words.count - 2) {
            let leading = words[..<splitIndex].joined(separator: " ")
            let trailing = words[splitIndex...].joined(separator: " ")

            guard looksLikeTitleFragment(leading),
                  startsWithStrongAuthorSignal(trailing),
                  startsWithAuthorName(trailing),
                  looksLikeAuthorLine(trailing) else {
                continue
            }
            return [leading, trailing]
        }

        for splitIndex in minimumSplitIndex..<(words.count - 2) {
            let leading = words[..<splitIndex].joined(separator: " ")
            let trailing = words[splitIndex...].joined(separator: " ")

            guard looksLikeTitleFragment(leading), startsWithAuthorName(trailing), looksLikeAuthorLine(trailing) else {
                continue
            }
            return [leading, trailing]
        }

        return nil
    }

    private static func mergeOpeningFragments(_ paragraphs: [String]) -> [String] {
        guard !paragraphs.isEmpty else { return [] }

        var merged: [String] = []
        var index = 0

        while index < paragraphs.count {
            let current = paragraphs[index].trimmingCharacters(in: .whitespacesAndNewlines)
            let next = index + 1 < paragraphs.count ? paragraphs[index + 1].trimmingCharacters(in: .whitespacesAndNewlines) : nil

            guard !current.isEmpty else {
                index += 1
                continue
            }

            if let next,
               shouldMergeOpeningFragment(current, with: next, existing: merged) {
                merged.append(mergeParagraphs(current, next))
                index += 2
                continue
            }

            merged.append(current)
            index += 1
        }

        return merged
    }

    private static func removeLeadingMetadataParagraphs(from paragraphs: [String]) -> [String] {
        guard paragraphs.count > 1 else { return paragraphs }

        var result = paragraphs

        while let first = result.first,
              let next = result.dropFirst().first,
              isLikelyFrontMatterMetadata(first),
              startsWithMajorSectionLead(next) {
            result.removeFirst()
        }

        return result
    }

    private static func mergeSectionLabelsWithFollowingBody(_ paragraphs: [String]) -> [String] {
        guard !paragraphs.isEmpty else { return [] }

        var merged: [String] = []
        var index = 0

        while index < paragraphs.count {
            let current = paragraphs[index].trimmingCharacters(in: .whitespacesAndNewlines)
            let next = index + 1 < paragraphs.count ? paragraphs[index + 1].trimmingCharacters(in: .whitespacesAndNewlines) : nil

            if let next,
               shouldPrefixNextParagraph(withSectionLabel: current, next: next) {
                let label = current.hasSuffix(".") || current.hasSuffix(":") ? current : current + "."
                merged.append(mergeParagraphs(label, next))
                index += 2
                continue
            }

            merged.append(current)
            index += 1
        }

        return merged
    }

    private static func stripRepeatedRunningHeaders(from paragraphs: [String]) -> [String] {
        guard paragraphs.count > 4 else { return paragraphs }

        guard let titleCandidate = paragraphs
            .prefix(4)
            .map({ $0.trimmingCharacters(in: .whitespacesAndNewlines) })
            .first(where: { looksLikeTitleFragment($0) && $0.count >= 18 })
        else {
            return paragraphs
        }

        var stripped: [String] = []

        for (index, paragraph) in paragraphs.enumerated() {
            let trimmed = paragraph.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else { continue }

            if index > 1 {
                if trimmed == titleCandidate {
                    continue
                }

                if trimmed.hasPrefix(titleCandidate + " ") {
                    let remainder = String(trimmed.dropFirst(titleCandidate.count))
                        .trimmingCharacters(in: .whitespacesAndNewlines)
                    if !remainder.isEmpty {
                        stripped.append(remainder)
                    }
                    continue
                }
            }

            stripped.append(trimmed)
        }

        return stripped
    }

    private static func inlineSectionBoundaryRange(in text: String) -> Range<String.Index>? {
        let patterns = [
            #"(?<=[a-z])(?=\d+(?:\.\d+)*\s+(?:Abstract|Introduction|Background|Related Work|Methods?|Methodology|Materials and Methods|Experimental Setup|Experiments?|Evaluation|Results?|Discussion|Conclusions?|Appendix|Acknowledg(?:e)?ments)(?:[.:](?=\s)|\s+[A-Z]))"#,
            #"(?<=[a-z])(?=\d+(?:\.\d+)*\.\s+(?:The\s+)?[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){1,6})"#,
            #"(?<=\S)\s+(?=\d+(?:\.\d+)*\.\s+(?:The\s+)?[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){1,6})"#,
            #"(?<=\S)\s+(?=\d+(?:\.\d+)*\s+(?:Abstract|Introduction|Background|Related Work|Methods?|Methodology|Materials and Methods|Experimental Setup|Experiments?|Evaluation|Results?|Discussion|Conclusions?|Appendix))"#,
            #"(?<=\S)\s+(?:(?:\d+(?:\.\d+)*)\s+)?(?:Abstract|Introduction|Background|Related Work|Methods?|Methodology|Materials and Methods|Experimental Setup|Experiments?|Evaluation|Results?|Discussion|Conclusions?|Appendix|Acknowledg(?:e)?ments)(?:[.:](?=\s)|(?=\s+[A-Z]))"#,
            #"(?<=\S)\s+(?:References|Bibliography|Works Cited|Literature Cited|Reference List)(?:[.:](?=\s)|(?=\s+\d))"#,
            #"(?<=\S)\s+Keywords:\s*"#
        ]

        for pattern in patterns {
            if let range = text.range(of: pattern, options: .regularExpression) {
                return range
            }
        }

        return genericInlineNumberedHeadingRange(in: text)
    }

    private static func ensureSentenceClosedParagraphs(_ paragraphs: [String]) -> [String] {
        guard !paragraphs.isEmpty else { return [] }

        var result: [String] = []
        var current = paragraphs[0].trimmingCharacters(in: .whitespacesAndNewlines)

        for nextParagraph in paragraphs.dropFirst() {
            let next = nextParagraph.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !next.isEmpty else { continue }

            if shouldExtendToSentenceBoundary(current, with: next) {
                current = mergeParagraphs(current, next)
            } else {
                result.append(current)
                current = next
            }
        }

        if !current.isEmpty {
            result.append(current)
        }

        return result
    }

    private static func splitLongReadableParagraphs(_ paragraphs: [String], targetChars: Int = 1400) -> [String] {
        paragraphs.flatMap { paragraph in
            let trimmed = paragraph.trimmingCharacters(in: .whitespacesAndNewlines)
            guard trimmed.count > targetChars else { return [trimmed] }
            guard !isLikelySectionHeading(trimmed),
                  !startsWithMajorSectionLead(trimmed),
                  !isLikelyCaption(trimmed),
                  !isLikelyEquationFragment(trimmed),
                  !isLikelyFrontMatterMetadata(trimmed) else {
                return [trimmed]
            }

            let sentences = splitIntoSentences(trimmed)
            guard sentences.count > 1 else { return [trimmed] }

            var chunks: [String] = []
            var current = ""

            for sentence in sentences {
                let candidate = sentence.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !candidate.isEmpty else { continue }

                if current.isEmpty {
                    current = candidate
                    continue
                }

                let projectedLength = current.count + candidate.count + 1
                if projectedLength <= targetChars {
                    current += " " + candidate
                } else {
                    chunks.append(current)
                    current = candidate
                }
            }

            if !current.isEmpty {
                chunks.append(current)
            }

            return chunks.isEmpty ? [trimmed] : chunks
        }
    }

    private static func joinParagraphLines(_ lines: [String]) -> String {
        var result = ""

        for line in lines {
            let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else { continue }

            if result.isEmpty {
                result = trimmed
                continue
            }

            if result.hasSuffix("-"), startsWithLetterOrDigit(trimmed) {
                result.removeLast()
                result += trimmed
                continue
            }

            if shouldInsertSpace(between: result, and: trimmed) {
                result += " " + trimmed
            } else {
                result += trimmed
            }
        }

        return replaceMatches(in: result, pattern: "\\s{2,}", template: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func shouldBreakParagraph(
        after previous: String,
        before current: String,
        previousLineLength: Double,
        referenceLineLength: Double,
        previousIndent: CGFloat,
        currentIndent: CGFloat,
        verticalGap: CGFloat,
        medianLineHeight: CGFloat = 0
    ) -> Bool {
        if startsBulletOrNumberedItem(current) {
            return true
        }

        if isLikelySectionHeading(current) {
            return true
        }

        let currentIsCaption = isLikelyCaption(current)
        let previousIsCaption = isLikelyCaption(previous)
        let currentIsEquation = isLikelyEquationFragment(current)
        let previousIsEquation = isLikelyEquationFragment(previous)
        let currentIsArtifact = isLikelyPlotArtifact(current)
        let previousIsArtifact = isLikelyPlotArtifact(previous)

        if currentIsArtifact || previousIsArtifact {
            return true
        }

        if currentIsCaption {
            return !previousIsCaption
        }

        if previousIsCaption {
            return endsSentence(previous)
        }

        if currentIsEquation || previousIsEquation {
            if medianLineHeight > 0, verticalGap > (medianLineHeight * 1.8) {
                return true
            }
            return false
        }

        let previousEndsSentence = endsSentence(previous)
        let shortPreviousLine = previousLineLength < (referenceLineLength * 0.52)
        let noticeableIndent = currentIndent - previousIndent > 16

        if medianLineHeight > 0, verticalGap > (medianLineHeight * 1.35) {
            return true
        }

        if medianLineHeight > 0,
           previousEndsSentence,
           shortPreviousLine,
           verticalGap > (medianLineHeight * 0.55) {
            return true
        }

        if medianLineHeight > 0,
           previousEndsSentence,
           noticeableIndent,
           verticalGap > (medianLineHeight * 0.25) {
            return true
        }

        return false
    }

    private static func shouldSkipStandaloneLine(_ line: String) -> Bool {
        let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return true }

        let patterns = [
            #"^\(?\d{1,4}\)?$"#,
            #"^(?i:page)\s+\d{1,4}(?:\s+of\s+\d{1,4})?$"#
        ]

        return patterns.contains {
            trimmed.range(of: $0, options: .regularExpression) != nil
        }
    }

    private static func isLikelyFooterOrPageNumber(_ line: ExtractedTextLine, in pageBounds: CGRect) -> Bool {
        let lowerFooterLimit = pageBounds.minY + (pageBounds.height * 0.12)
        return line.bounds.maxY <= lowerFooterLimit
    }

    private static func isLikelySectionHeading(_ line: String) -> Bool {
        let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed.count <= 120 else { return false }
        guard !trimmed.contains("@") else { return false }
        guard trimmed.range(of: #"[.!?]["')\]]?$"#, options: .regularExpression) == nil else { return false }

        if startsMajorSection(trimmed) {
            return true
        }

        if trimmed.range(of: #"^(?:\d+(?:\.\d+)*)\s+[A-Z].*$"#, options: .regularExpression) != nil {
            return true
        }

        let words = trimmed.split(whereSeparator: \.isWhitespace)
        guard !words.isEmpty, words.count <= 12 else { return false }

        let titleCaseWords = words.filter { word in
            guard let first = word.first else { return false }
            return first.isUppercase
        }.count

        let uppercaseLetters = trimmed.filter(\.isUppercase).count
        let letters = trimmed.filter(\.isLetter).count
        let uppercaseRatio = letters > 0 ? Double(uppercaseLetters) / Double(letters) : 0

        return uppercaseRatio > 0.6 || Double(titleCaseWords) / Double(words.count) > 0.8
    }

    private static func isReferenceHeading(_ line: String) -> Bool {
        let normalized = normalizeHeading(line)
        return referenceHeadings.contains(normalized)
    }

    private static func startsMajorSection(_ line: String) -> Bool {
        majorSectionHeadings.contains(normalizeHeading(line))
    }

    private static func startsWithMajorSectionLead(_ line: String) -> Bool {
        line.range(
            of: #"^(?:(?:\d+(?:\.\d+)*)\s+)?(?:Abstract|Introduction|Background|Related Work|Methods?|Methodology|Materials and Methods|Experimental Setup|Experiments?|Evaluation|Results?|Discussion|Conclusions?|Appendix|Acknowledg(?:e)?ments)(?:[.:](?:\s|$)|\s+[A-Z])"#,
            options: .regularExpression
        ) != nil
    }

    private static func shouldPrefixNextParagraph(withSectionLabel current: String, next: String) -> Bool {
        guard startsMajorSection(current) else { return false }
        guard !current.contains("@"), !current.contains("http") else { return false }
        guard current.range(of: #"^\d"#, options: .regularExpression) == nil else { return false }
        guard !isLikelyCaption(next), !isLikelyPlotArtifact(next), !isLikelySectionHeading(next) else { return false }
        return next.count >= 80 || endsSentence(next)
    }

    private static func shouldMergeOpeningFragment(_ current: String, with next: String, existing: [String]) -> Bool {
        guard existing.count < 4 else { return false }
        guard existing.allSatisfy({ looksLikeTitleFragment($0) || looksLikeAuthorLine($0) || isLikelyFrontMatterMetadata($0) }) else {
            return false
        }
        guard !startsWithMajorSectionLead(current), !startsWithMajorSectionLead(next) else { return false }
        guard !isReferenceHeading(current), !isReferenceHeading(next) else { return false }

        if looksLikeTitleFragment(current), looksLikeTitleFragment(next) {
            return true
        }

        if isLikelyFrontMatterMetadata(current),
           (isLikelyFrontMatterMetadata(next) || looksLikeAuthorLine(next)) {
            return true
        }

        if looksLikeAuthorLine(current), looksLikeAuthorLine(next) {
            return true
        }

        return false
    }

    private static func normalizeHeading(_ line: String) -> String {
        let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
        let withoutNumbering = replaceMatches(
            in: trimmed,
            pattern: #"^(?:\d+(?:\.\d+)*)\s+"#,
            template: ""
        )
        return withoutNumbering
            .lowercased()
            .trimmingCharacters(in: .punctuationCharacters.union(.whitespacesAndNewlines))
    }

    private static func mergeSentenceFragments(_ fragments: [String]) -> [String] {
        guard !fragments.isEmpty else { return [] }

        var merged: [String] = []
        var current = fragments[0].trimmingCharacters(in: .whitespacesAndNewlines)

        for fragment in fragments.dropFirst() {
            let next = fragment.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !next.isEmpty else { continue }

            if shouldMergeSentenceFragment(current, with: next) {
                current = mergeParagraphs(current, next)
            } else {
                if !current.isEmpty {
                    merged.append(current)
                }
                current = next
            }
        }

        if !current.isEmpty {
            merged.append(current)
        }

        return merged
    }

    private static func shouldMergeSentenceFragment(_ current: String, with next: String) -> Bool {
        guard !current.isEmpty, !next.isEmpty else { return false }
        guard !endsSentence(current) else { return false }
        guard !isReferenceHeading(current) else { return false }
        guard !(looksLikeTitleFragment(current) && looksLikeAuthorLine(next)) else { return false }
        guard !isLikelySectionHeading(current),
              !startsWithMajorSectionLead(current),
              !isLikelyCaption(current),
              !isLikelyPlotArtifact(current),
              !isReferenceHeading(current),
              !isLikelyDenseTableBlock(current),
              !isLikelyTableRow(current),
              !isLikelyIsolatedSymbolicFragment(current),
              !isLikelyAlgorithmArtifact(current) else {
            return false
        }
        guard !isLikelySectionHeading(next),
              !startsWithMajorSectionLead(next),
              !isLikelyCaption(next),
              !isReferenceHeading(next),
              !isLikelyDenseTableBlock(next),
              !isLikelyTableRow(next),
              !isLikelyAlgorithmArtifact(next),
              !isLikelyIsolatedSymbolicFragment(next),
              !isLikelyStandaloneChartLabel(next) else {
            return false
        }

        if endsWithContinuationMarker(current) {
            return true
        }

        if next.range(of: #"^[,;:\)\]\-–a-z0-9]"#, options: .regularExpression) != nil {
            return true
        }

        return current.count <= 180
    }

    private static func detectExplicitReferenceHeading(in paragraphs: [String], searchStartIndex: Int) -> (index: Int, heading: String)? {
        for index in searchStartIndex..<paragraphs.count {
            let candidate = paragraphs[index]
            guard isReferenceHeading(candidate) else { continue }

            let trailingParagraphs = Array(paragraphs.dropFirst(index + 1).prefix(12))
            let referenceLikeCount = trailingParagraphs.filter(isLikelyReferenceEntry).count
            let hasEnoughEvidence = !trailingParagraphs.isEmpty && (
                referenceLikeCount >= min(3, trailingParagraphs.count) ||
                Double(referenceLikeCount) / Double(trailingParagraphs.count) >= 0.45
            )

            guard hasEnoughEvidence || index >= Int(Double(paragraphs.count) * 0.75) else {
                continue
            }

            return (index, candidate)
        }

        return nil
    }

    private static func detectImplicitReferenceSectionStart(in paragraphs: [String], searchStartIndex: Int) -> Int? {
        let fallbackStartIndex = max(searchStartIndex, Int(Double(paragraphs.count) * 0.60))
        guard fallbackStartIndex < paragraphs.count else { return nil }

        for index in fallbackStartIndex..<paragraphs.count {
            let windowEnd = min(index + 6, paragraphs.count)
            let window = Array(paragraphs[index..<windowEnd])
            guard window.count >= 3 else { continue }

            let referenceOffsets = window.enumerated().compactMap { offset, paragraph in
                isLikelyReferenceEntry(paragraph) ? offset : nil
            }
            guard !referenceOffsets.isEmpty else { continue }

            let referenceRatio = Double(referenceOffsets.count) / Double(window.count)
            guard referenceOffsets.count >= min(3, window.count), referenceRatio >= 0.6 else { continue }

            let startIndex = index + (referenceOffsets.first ?? 0)
            let trailingParagraphs = Array(paragraphs.suffix(from: startIndex))
            let trailingReferenceCount = trailingParagraphs.filter(isLikelyReferenceEntry).count
            let trailingRatio = Double(trailingReferenceCount) / Double(max(trailingParagraphs.count, 1))

            if trailingReferenceCount >= min(3, trailingParagraphs.count) || trailingRatio >= 0.5 {
                return startIndex
            }
        }

        return nil
    }

    private static func isLikelyReferenceEntry(_ paragraph: String) -> Bool {
        let trimmed = paragraph.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count >= 20, trimmed.count <= 1200 else { return false }
        guard !isLikelySectionHeading(trimmed) else { return false }

        let patterns = [
            #"^(?i:(?:references|bibliography|works cited|literature cited|reference list))\s+\d+\."#,
            #"^\[\d+\]"#,
            #"^\d+\.\s+[A-Z]"#,
            #"^[A-Z][A-Za-z'’\-]+,\s*(?:[A-Z]\.\s*){1,4}"#,
            #"^[A-Z][A-Za-z'’\-]+(?:,\s*[A-Z][A-Za-z'’\-]+){0,4}\s+\((?:19|20)\d{2}[a-z]?\)"#,
            #"(?i)\bdoi\b"#,
            #"https?://"#,
            #"\b(?:19|20)\d{2}[a-z]?\b"#,
            #"(?i)\bet al\."#,
            #"(?i)\b(?:pp\.|vol\.|no\.|journal|proceedings|conference)\b"#
        ]

        let matchedSignals = patterns.reduce(into: 0) { count, pattern in
            if trimmed.range(of: pattern, options: .regularExpression) != nil {
                count += 1
            }
        }

        if matchedSignals >= 2 {
            return true
        }

        let commaCount = trimmed.filter { $0 == "," }.count
        let periodCount = trimmed.filter { $0 == "." }.count
        return matchedSignals >= 1 && commaCount >= 2 && periodCount >= 2
    }

    private static func isLikelyFrontMatterMetadata(_ paragraph: String) -> Bool {
        let trimmed = paragraph.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed.count <= 900 else { return false }
        guard !startsMajorSection(trimmed) else { return false }

        let lowered = trimmed.lowercased()
        let matchedSignals = frontMatterSignals.reduce(into: 0) { count, signal in
            if lowered.contains(signal) {
                count += 1
            }
        }

        return matchedSignals >= 2 || (matchedSignals >= 1 && trimmed.contains("@"))
    }

    private static func looksLikeTitleFragment(_ text: String) -> Bool {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count >= 8, trimmed.count <= 120 else { return false }
        guard !trimmed.contains("@"), !trimmed.contains("http") else { return false }
        guard trimmed.range(of: #"\d"#, options: .regularExpression) == nil else { return false }
        guard !endsSentence(trimmed) else { return false }

        let words = trimmed.split(whereSeparator: \.isWhitespace)
        guard words.count >= 2, words.count <= 12 else { return false }

        let commaCount = trimmed.filter { $0 == "," }.count
        guard commaCount <= 1 else { return false }

        let titleCaseCount = words.filter { word in
            guard let first = word.first else { return false }
            return first.isUppercase
        }.count

        return Double(titleCaseCount) / Double(words.count) >= 0.7
    }

    private static func looksLikeAuthorLine(_ text: String) -> Bool {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count >= 12, trimmed.count <= 320 else { return false }
        guard !endsSentence(trimmed) else { return false }

        if trimmed.contains("@") || trimmed.contains("†") || trimmed.contains("∗") || trimmed.contains("*") {
            return true
        }

        let patterns = [
            #"(?:[A-Z][a-z'’\-]+,\s*){1,}"#,
            #"(?:\b[A-Z][a-z'’\-]+\s+[A-Z][a-z'’\-]+(?:,\s*|\s+)){2,}"#,
            #"(?:\b[A-Z][a-z'’\-]+\s+(?:[A-Z]\.\s+)?[A-Z][a-z'’\-]+(?:\s+\d+|\s*[*†∗])?){2,}"#,
            #"\b(?:UC Berkeley|OpenAI|Google Brain|Facebook AI Research|UCLA|University|Department)\b"#
        ]

        return patterns.contains { trimmed.range(of: $0, options: .regularExpression) != nil }
    }

    private static func startsWithAuthorName(_ text: String) -> Bool {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.range(
            of: #"^(?:[A-Z][A-Za-z'’\-]+(?:\s+[A-Z]\.)?\s+){1,3}[A-Z][A-Za-z'’\-]+(?:\s*[†*∗]?\s*\d+(?:,\d+)*)?"#,
            options: .regularExpression
        ) != nil
    }

    private static func startsWithStrongAuthorSignal(_ text: String) -> Bool {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        let prefix = String(trimmed.prefix(24))
        return prefix.range(of: #"(?:[A-Z]\.|[*†∗]|\d|,)"#, options: .regularExpression) != nil
    }

    private static func isLikelyCaption(_ text: String) -> Bool {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count <= 400 else { return false }

        let normalized = normalizeHeading(trimmed)
        return captionPrefixes.contains { prefix in
            normalized.range(
                of: #"^\#(prefix)\.?\s*\d+[a-z]?(?:[:.\-]\s*|\s+)"#,
                options: .regularExpression
            ) != nil
        }
    }

    private static func isLikelyEquationFragment(_ text: String) -> Bool {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed.count <= 220 else { return false }
        guard !trimmed.contains("http"), !trimmed.contains("@") else { return false }

        let operatorMatches = [
            #"="#,
            #":="#,
            #"[+\-*/]=?"#,
            #"[≤≥≈≠∑∫∂∆→←↔⇡⇣∈∼πγθλμστωφψΩ]"#,
            #"\b[a-zA-Z]\s*=\s*[A-Za-z0-9(]"#,
            #"\([0-9]+\)$"#
        ]

        let signalCount = operatorMatches.reduce(into: 0) { count, pattern in
            if trimmed.range(of: pattern, options: .regularExpression) != nil {
                count += 1
            }
        }

        let symbolCount = trimmed.filter { "=+-*/<>≤≥≈≠∑∫∂∆→←↔⇡⇣∈∼πγθλμστωφψΩ^¯".contains($0) }.count
        let words = trimmed.split(whereSeparator: \.isWhitespace)
        let lowercaseLetters = trimmed.filter(\.isLowercase).count
        let uppercaseLetters = trimmed.filter(\.isUppercase).count

        return signalCount >= 2 ||
            (signalCount >= 1 && symbolCount >= 2) ||
            (words.count <= 8 && symbolCount >= 3) ||
            (words.count <= 4 && lowercaseLetters <= 2 && (symbolCount >= 1 || uppercaseLetters >= 1))
    }

    private static func isLikelyPlotArtifact(_ text: String) -> Bool {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed.count <= 90 else { return false }
        guard !trimmed.contains("http"), !trimmed.contains("@") else { return false }
        guard !endsSentence(trimmed) else { return false }
        guard !startsMajorSection(trimmed), !isReferenceHeading(trimmed), !isLikelyCaption(trimmed), !isLikelyEquationFragment(trimmed) else {
            return false
        }

        let words = trimmed.split(whereSeparator: \.isWhitespace)
        guard words.count <= 7 else { return false }

        let shortOrNumericWords = words.filter { word in
            word.count <= 2 || word.range(of: #"^\d+(?:\.\d+)?$"#, options: .regularExpression) != nil
        }.count
        let lowercaseWords = words.filter { word in
            let token = String(word)
            return token.range(of: #"^[a-z][a-z-]*$"#, options: .regularExpression) != nil
        }.count

        let letters = trimmed.filter(\.isLetter).count
        let digits = trimmed.filter(\.isNumber).count
        let letterRatio = Double(letters) / Double(max(trimmed.count, 1))

        if trimmed.range(of: #"^[\d.\-+×x/()]+$"#, options: .regularExpression) != nil {
            return true
        }

        return (words.count <= 4 && shortOrNumericWords >= max(words.count - 1, 1)) ||
            (digits > letters && letterRatio < 0.45) ||
            (words.count <= 3 && trimmed.range(of: #"^[A-Za-z]$"#, options: .regularExpression) != nil) ||
            (words.count >= 4 && words.count <= 8 && lowercaseWords == words.count) ||
            (trimmed.hasSuffix("...") && words.count <= 8)
    }

    private static func isLikelyTableRow(_ text: String) -> Bool {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed.count <= 260 else { return false }
        guard !trimmed.contains("@"), !trimmed.contains("http") else { return false }
        guard !endsSentence(trimmed) else { return false }
        guard !isLikelyCaption(trimmed), !startsMajorSection(trimmed), !isLikelyReferenceEntry(trimmed) else { return false }

        let digitCount = trimmed.filter(\.isNumber).count
        let numberMatches = countMatches(in: trimmed, pattern: #"\d+(?:\.\d+)?"#)
        let tokenCount = trimmed.split(whereSeparator: \.isWhitespace).count

        if trimmed.range(of: #"^(?:Name|Rank|Group|Performance)\b"#, options: .regularExpression) != nil {
            return true
        }

        if trimmed.contains("±") || trimmed.contains("IOU") || trimmed.contains("Error") {
            return true
        }

        return (digitCount >= 5 && numberMatches >= 3 && tokenCount <= 24) ||
            (digitCount >= 2 && tokenCount <= 10 && trimmed.range(of: #"^[A-Za-z0-9.\-±()%\s]+$"#, options: .regularExpression) != nil)
    }

    private static func isLikelyDenseTableBlock(_ text: String) -> Bool {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count >= 60, trimmed.count <= 1800 else { return false }
        guard !trimmed.contains("@"), !trimmed.contains("http") else { return false }
        guard !startsWithMajorSectionLead(trimmed), !isLikelyCaption(trimmed), !isLikelyReferenceEntry(trimmed) else {
            return false
        }

        let numberMatches = countMatches(in: trimmed, pattern: #"\d+(?:\.\d+)?"#)
        let datasetSignals = countMatches(
            in: trimmed,
            pattern: #"(?i)\b(?:dataset|environment|average|delayed|medium(?:-replay|-expert)?|expert|halfcheetah|hopper|walker|reacher|breakout|pong|seaquest|qbert|agnostic|dt\s*\(ours\)|cql|bear|brac-v|awr|bc)\b"#
        )

        if trimmed.range(of: #"^(?i:(?:dataset|delayed\s+\(sparse\)\s+dataset|average))\b"#, options: .regularExpression) != nil,
           numberMatches >= 6 {
            return true
        }

        return (numberMatches >= 10 && datasetSignals >= 2) || (trimmed.contains("±") && numberMatches >= 6)
    }

    private static func isLikelyAlgorithmArtifact(_ text: String) -> Bool {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count >= 20, trimmed.count <= 2200 else { return false }
        guard !trimmed.contains("@"), !trimmed.contains("http") else { return false }
        guard !endsSentence(trimmed) else { return false }

        let patterns = [
            #"(?i)\bpseudocode\b"#,
            #"(?i)\boptimizer\s*\.\s*step\b"#,
            #"(?i)\bzero_grad\b"#,
            #"(?i)\bbackward\b"#,
            #"(?i)\bwhile\s+not\b"#,
            #"(?i)\bdef\s+[A-Za-z_]"#,
            #"(?:#\s*[A-Za-z_]){2,}"#,
            #"(?:\b[A-Za-z]\s+){5,}[A-Za-z]\b"#
        ]

        let matchCount = patterns.reduce(into: 0) { count, pattern in
            if trimmed.range(of: pattern, options: .regularExpression) != nil {
                count += 1
            }
        }

        return matchCount >= 2
    }

    private static func isLikelyStandaloneChartLabel(_ text: String) -> Bool {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count >= 3, trimmed.count <= 24 else { return false }
        guard !endsSentence(trimmed) || trimmed.range(of: #"^[A-Z][A-Za-z]+\.$"#, options: .regularExpression) != nil else {
            return false
        }
        guard !trimmed.contains("@"), !trimmed.contains("http") else { return false }
        guard !startsMajorSection(trimmed), !isReferenceHeading(trimmed), !isLikelyCaption(trimmed) else { return false }

        let words = trimmed.split(whereSeparator: \.isWhitespace)
        guard words.count <= 2 else { return false }

        let letters = trimmed.filter(\.isLetter).count
        guard letters >= 3 else { return false }
        guard trimmed.range(of: #"^[A-Za-z][A-Za-z0-9+\-]*$"#, options: .regularExpression) != nil else { return false }

        return true
    }

    private static func isLikelyIsolatedSymbolicFragment(_ text: String) -> Bool {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed.count <= 60 else { return false }
        guard !endsSentence(trimmed) else { return false }
        guard !startsMajorSection(trimmed), !isReferenceHeading(trimmed), !isLikelyCaption(trimmed) else { return false }

        let words = trimmed.split(whereSeparator: \.isWhitespace)
        guard words.count <= 6 else { return false }

        let lowercaseLetters = trimmed.filter(\.isLowercase).count
        let uppercaseLetters = trimmed.filter(\.isUppercase).count
        let digits = trimmed.filter(\.isNumber).count
        let mathLikeSymbols = trimmed.filter { "=+-*/<>≤≥≈≠∑∫∂∆→←↔⇡⇣∈∼πγθλμστωφψΩ^¯|[](){}".contains($0) }.count

        return mathLikeSymbols >= 1 ||
            (lowercaseLetters == 0 && (uppercaseLetters + digits) >= 1 && trimmed.count <= 24) ||
            (trimmed.range(of: #"^[A-Za-z0-9()\[\]{}⇡⇣±+\-*/=→←∈∼^¯|]+$"#, options: .regularExpression) != nil && lowercaseLetters <= 2)
    }

    private static func isLikelyShortStructuralFragment(_ text: String) -> Bool {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed.count <= 60 else { return false }
        guard !startsMajorSection(trimmed), !isReferenceHeading(trimmed), !isLikelyCaption(trimmed) else { return false }
        guard !trimmed.contains("@"), !trimmed.contains("http") else { return false }

        let words = trimmed.split(whereSeparator: \.isWhitespace)
        guard words.count <= 4 else { return false }

        if isLikelyIsolatedSymbolicFragment(trimmed) {
            return true
        }

        let titleCaseOrUpperWords = words.filter { word in
            guard let first = word.first else { return false }
            return first.isUppercase
        }.count
        let lowercaseWords = words.filter { word in
            let token = String(word)
            return token.range(of: #"^[a-z][a-z-]*$"#, options: .regularExpression) != nil
        }.count

        return titleCaseOrUpperWords == words.count ||
            (words.count >= 4 && lowercaseWords == words.count) ||
            trimmed.range(of: #"^[A-Z0-9*+\-]+$"#, options: .regularExpression) != nil
    }

    private static func looksLikeMetadataTail(_ text: String) -> Bool {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count <= 60 else { return false }
        guard !endsSentence(trimmed), !startsMajorSection(trimmed), !isLikelyCaption(trimmed) else { return false }
        guard !trimmed.contains("@"), !trimmed.contains("http") else { return false }

        let words = trimmed.split(whereSeparator: \.isWhitespace)
        guard words.count >= 1, words.count <= 4 else { return false }

        return trimmed.range(of: #"^[A-Z][A-Za-z'’\-]+(?:\s+[A-Z][A-Za-z'’\-]+){0,3}$"#, options: .regularExpression) != nil
    }

    private static func shouldDropStructuralArtifact(_ current: String, previous: String?, next: String?) -> Bool {
        if isHyphenatedCarryoverFragment(current) {
            return false
        }

        if let previous, isLikelyFrontMatterMetadata(previous), looksLikeMetadataTail(current) {
            return false
        }

        if isLikelyAlgorithmArtifact(current) {
            return true
        }

        if isLikelyDenseTableBlock(current) {
            return true
        }

        if isLikelyPlotArtifact(current),
           !isLikelyCaption(current),
           !isLikelySectionHeading(current) {
            return true
        }

        if isLikelyTableRow(current) {
            return true
        }

        if isLikelyIsolatedSymbolicFragment(current) {
            if current.count > 25 {
                if let previous,
                   !endsSentence(previous),
                   !isLikelyCaption(previous),
                   !isLikelyTableRow(previous),
                   !isLikelyDenseTableBlock(previous) {
                    return false
                }

                if let next,
                   !startsWithMajorSectionLead(next),
                   !isLikelyCaption(next),
                   !isLikelyTableRow(next),
                   !isLikelyDenseTableBlock(next) {
                    return false
                }
            }

            return true
        }

        if isLikelyShortStructuralFragment(current) {
            if let previous, isLikelyCaption(previous) || isLikelyTableRow(previous) || isLikelyDenseTableBlock(previous) {
                return true
            }

            if let next, isLikelyCaption(next) || isLikelyTableRow(next) || isLikelyDenseTableBlock(next) || isLikelyStandaloneChartLabel(next) {
                return true
            }

            return current.count <= 18
        }

        if isLikelyStandaloneChartLabel(current) {
            if let previous,
               isLikelyTableRow(previous) || isLikelyDenseTableBlock(previous) || isLikelyStandaloneChartLabel(previous) || isLikelyCaption(previous) {
                return true
            }

            if let next,
               isLikelyTableRow(next) || isLikelyDenseTableBlock(next) || isLikelyStandaloneChartLabel(next) || isLikelyAlgorithmArtifact(next) || isLikelyCaption(next) {
                return true
            }
        }

        return false
    }

    private static func shouldMergeParagraph(_ current: String, intoPrevious previous: String, next: String?) -> Bool {
        if isLikelyFrontMatterMetadata(previous), looksLikeMetadataTail(current) {
            return true
        }

        if isLikelyFrontMatterMetadata(previous) {
            return false
        }

        guard !(looksLikeAuthorLine(current) && looksLikeTitleFragment(previous)) else { return false }
        guard !isLikelyCaption(previous) else { return false }
        guard !isReferenceHeading(previous) else { return false }
        guard !isReferenceHeading(current) else { return false }
        guard !isLikelySectionHeading(current),
              !startsWithGenericNumberedHeading(current),
              !startsWithMajorSectionLead(current),
              !isLikelyFrontMatterMetadata(current),
              !isLikelyCaption(current),
              !isLikelyPlotArtifact(current),
              !isLikelyTableRow(current),
              !isLikelyDenseTableBlock(current),
              !isLikelyIsolatedSymbolicFragment(current),
              !isLikelyAlgorithmArtifact(current),
              !isLikelyStandaloneChartLabel(current) else {
            return false
        }

        let previousEndsSentence = endsSentence(previous)

        if isHyphenatedCarryoverFragment(current) {
            return true
        }

        if isLikelyEquationFragment(current) {
            return !previousEndsSentence || isLikelyEquationFragment(previous) || previous.hasSuffix(":")
        }

        if endsWithIncompletePhrase(previous) {
            return true
        }

        if !previousEndsSentence || endsWithContinuationMarker(previous) {
            return true
        }

        if current.count <= 120,
           current.range(of: #"^[a-z0-9\(\[]"#, options: .regularExpression) != nil {
            return true
        }

        if current.count <= 90,
           let next,
           !endsSentence(current),
           !isLikelySectionHeading(next),
           !isLikelyCaption(next) {
            return true
        }

        return false
    }

    private static func shouldExtendToSentenceBoundary(_ current: String, with next: String) -> Bool {
        guard !current.isEmpty, !next.isEmpty else { return false }
        guard !endsSentence(current) else { return false }
        guard !isReferenceHeading(current) else { return false }
        guard !(looksLikeTitleFragment(current) && looksLikeAuthorLine(next)) else { return false }
        guard !looksLikeMetadataTail(current) else { return false }
        guard !isLikelyFrontMatterMetadata(current) else { return false }
        guard !isLikelySectionHeading(current),
              !startsWithGenericNumberedHeading(current),
              !startsWithMajorSectionLead(current),
              !isLikelyCaption(current),
              !isLikelyPlotArtifact(current),
              !isLikelyTableRow(current),
              !isLikelyDenseTableBlock(current),
              !isLikelyIsolatedSymbolicFragment(current),
              !isLikelyAlgorithmArtifact(current) else {
            return false
        }
        guard !isLikelySectionHeading(next),
              !startsWithGenericNumberedHeading(next),
              !startsWithMajorSectionLead(next),
              !isLikelyCaption(next),
              !isLikelyPlotArtifact(next),
              !isLikelyFrontMatterMetadata(next),
              !isLikelyTableRow(next),
              !isLikelyDenseTableBlock(next),
              !isLikelyAlgorithmArtifact(next),
              !isLikelyIsolatedSymbolicFragment(next),
              !isLikelyStandaloneChartLabel(next) else {
            return false
        }

        if isLikelyEquationFragment(current) || isLikelyEquationFragment(next) {
            return true
        }

        if isHyphenatedCarryoverFragment(current) || endsWithIncompletePhrase(current) {
            return true
        }

        if endsWithContinuationMarker(current) {
            return true
        }

        if next.range(of: #"^[a-z0-9\(\[]"#, options: .regularExpression) != nil {
            return true
        }

        if current.count >= 120 {
            return true
        }

        return true
    }

    private static func shouldMergeParagraph(_ current: String, withNext next: String) -> Bool {
        if isHyphenatedCarryoverFragment(current) {
            return true
        }

        guard !isLikelyCaption(current),
              !isLikelyPlotArtifact(current),
              !isLikelyTableRow(current),
              !isLikelyDenseTableBlock(current),
              !isLikelyIsolatedSymbolicFragment(current),
              !isLikelyAlgorithmArtifact(current),
              !isLikelyStandaloneChartLabel(current) else {
            return false
        }
        guard !isReferenceHeading(current) else { return false }
        guard !(looksLikeTitleFragment(current) && looksLikeAuthorLine(next)) else { return false }
        guard !isLikelyTableRow(next),
              !isLikelyDenseTableBlock(next),
              !isLikelyAlgorithmArtifact(next),
              !isLikelyIsolatedSymbolicFragment(next),
              !isLikelyStandaloneChartLabel(next),
              !startsWithGenericNumberedHeading(next),
              !startsWithMajorSectionLead(next) else {
            return false
        }

        if shouldPrefixNextParagraph(withSectionLabel: current, next: next) {
            return true
        }

        if isLikelyEquationFragment(current) {
            return isLikelyEquationFragment(next) || next.range(of: #"^[:=A-Za-z(]"#, options: .regularExpression) != nil
        }

        if endsWithIncompletePhrase(current) {
            return true
        }

        if endsWithContinuationMarker(current) {
            return true
        }

        if current.count <= 100,
           !endsSentence(current),
           !isLikelySectionHeading(next),
           !isLikelyCaption(next),
           !isLikelyPlotArtifact(next) {
            return true
        }

        return false
    }

    private static func mergeParagraphs(_ left: String, _ right: String) -> String {
        let merged = joinParagraphLines([left, right])
        if isLikelyFrontMatterMetadata(left), looksLikeMetadataTail(right), !endsSentence(merged) {
            return merged + "."
        }
        return merged
    }

    private static func startsBulletOrNumberedItem(_ line: String) -> Bool {
        line.range(of: #"^(?:[-•*]|\d+[\.\)])\s+"#, options: .regularExpression) != nil
    }

    private static func endsWithContinuationMarker(_ text: String) -> Bool {
        text.range(of: #"[,:;(\[\-–/]$"#, options: .regularExpression) != nil
    }

    private static func isHyphenatedCarryoverFragment(_ text: String) -> Bool {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count >= 2, trimmed.count <= 40 else { return false }
        guard trimmed.range(of: #"[A-Za-z]{1,20}-$"#, options: .regularExpression) != nil else {
            return false
        }
        guard !startsMajorSection(trimmed), !isReferenceHeading(trimmed), !isLikelyCaption(trimmed) else {
            return false
        }
        return true
    }

    private static func endsWithIncompletePhrase(_ text: String) -> Bool {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !endsSentence(trimmed) else { return false }

        let patterns = [
            #"(?i)\b(?:in case of|such as|because of|due to|instead of|as well as|rather than|compared with|compared to|with respect to|with regard to)$"#,
            #"(?i)\b(?:of|to|for|with|without|from|into|onto|upon|via|than|that|which|where|while|when|whose)$"#
        ]

        return patterns.contains { trimmed.range(of: $0, options: .regularExpression) != nil }
    }

    private static func endsSentence(_ line: String) -> Bool {
        line.range(of: #"[.!?]["')\]]?$"#, options: .regularExpression) != nil
    }

    private static func startsWithGenericNumberedHeading(_ text: String) -> Bool {
        text.range(
            of: #"^\d+(?:\.\d+)*\.\s+(?:The\s+)?[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){1,6}"#,
            options: .regularExpression
        ) != nil
    }

    private static func startsWithLetterOrDigit(_ text: String) -> Bool {
        guard let first = text.first else { return false }
        return first.isLetter || first.isNumber
    }

    private static func shouldInsertSpace(between left: String, and right: String) -> Bool {
        guard let last = left.last, let first = right.first else { return false }
        if CharacterSet.punctuationCharacters.contains(first.unicodeScalars.first!) {
            return false
        }
        if last == "/" || last == "(" || first == ")" || first == "]" {
            return false
        }
        return true
    }

    private static func countMatches(in text: String, pattern: String) -> Int {
        guard let regex = try? NSRegularExpression(pattern: pattern) else {
            return 0
        }

        let range = NSRange(text.startIndex..<text.endIndex, in: text)
        return regex.numberOfMatches(in: text, range: range)
    }

    private static func genericInlineNumberedHeadingRange(in text: String) -> Range<String.Index>? {
        guard let regex = try? NSRegularExpression(pattern: #"\d+(?:\.\d+)*\.\s+"#) else {
            return nil
        }

        let nsRange = NSRange(text.startIndex..<text.endIndex, in: text)

        for match in regex.matches(in: text, range: nsRange) {
            guard let matchRange = Range(match.range, in: text) else { continue }

            if matchRange.lowerBound > text.startIndex {
                let previousIndex = text.index(before: matchRange.lowerBound)
                let previousCharacter = text[previousIndex]
                guard previousCharacter.isWhitespace || previousCharacter.isLowercase else { continue }
            }

            let trailing = String(text[matchRange.lowerBound...])
            let words = trailing.split(whereSeparator: \.isWhitespace)
            guard words.count >= 3 else { continue }

            let headingWords = Array(words.prefix(5))
            let capitalizedWords = headingWords.filter { word in
                guard let first = word.first else { return false }
                return first.isUppercase
            }.count

            guard capitalizedWords >= min(3, headingWords.count) else { continue }
            return matchRange
        }

        return nil
    }

    private static func median(_ values: [Double]) -> Double? {
        guard !values.isEmpty else { return nil }
        let sorted = values.sorted()
        let middle = sorted.count / 2

        if sorted.count.isMultiple(of: 2) {
            return (sorted[middle - 1] + sorted[middle]) / 2
        }

        return sorted[middle]
    }
}
