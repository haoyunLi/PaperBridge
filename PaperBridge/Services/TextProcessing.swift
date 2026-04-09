import Foundation
import NaturalLanguage
import CoreGraphics

struct ExtractedTextLine {
    let text: String
    let bounds: CGRect
}

enum TextProcessing {
    static let summaryBatchChars = 6000
    private static let referenceHeadings = [
        "references",
        "bibliography",
        "works cited",
        "literature cited",
        "reference list"
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
        return paragraphs
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
        return paragraphs
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
        guard paragraphs.count >= 8 else {
            return (paragraphs, [], nil)
        }

        let searchStartIndex = max(Int(Double(paragraphs.count) * 0.45), 3)

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

            return (
                Array(paragraphs.prefix(index)),
                Array(paragraphs.suffix(from: index)),
                candidate
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

        return sentences.isEmpty ? [trimmed] : sentences
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
            let pieces = paragraph.count > maxChars ? forceSplitText(paragraph, maxChars: maxChars) : [paragraph]

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

    private static func isLikelyReferenceEntry(_ paragraph: String) -> Bool {
        let trimmed = paragraph.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count >= 20, trimmed.count <= 1200 else { return false }
        guard !isLikelySectionHeading(trimmed) else { return false }

        let patterns = [
            #"^\[\d+\]"#,
            #"^\d+\.\s+[A-Z]"#,
            #"(?i)\bdoi\b"#,
            #"https?://"#,
            #"\b(?:19|20)\d{2}[a-z]?\b"#,
            #"(?i)\bet al\."#
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

    private static func startsBulletOrNumberedItem(_ line: String) -> Bool {
        line.range(of: #"^(?:[-•*]|\d+[\.\)])\s+"#, options: .regularExpression) != nil
    }

    private static func endsSentence(_ line: String) -> Bool {
        line.range(of: #"[.!?]["')\]]?$"#, options: .regularExpression) != nil
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
