import Foundation

// Edits provide their exact range; identical paragraphs elsewhere must never be
// used to guess the identity of a bookmark, translation, or highlighted quote.
struct ParagraphMutationMapping {
    let oldRange: Range<Int>
    let replacementCount: Int

    var newRange: Range<Int> { oldRange.lowerBound..<(oldRange.lowerBound + replacementCount) }

    func destinations(for index: Int) -> [Int] {
        if index < oldRange.lowerBound { return [index] }
        if index >= oldRange.upperBound { return [index + replacementCount - oldRange.count] }
        return Array(newRange)
    }

    func sourceIndex(for index: Int) -> Int? {
        if index < newRange.lowerBound { return index }
        if index >= newRange.upperBound { return index - replacementCount + oldRange.count }
        return oldRange.count == 1 && replacementCount == 1 ? oldRange.lowerBound : nil
    }

    func remap(_ annotation: PaperAnnotation, old: [ParagraphResult], new: [ParagraphResult]) -> PaperAnnotation {
        if annotation.resolvedScope == .paper { return annotation }
        guard annotation.resolvedScope == .reader else {
            var preserved = annotation
            preserved.needsReview = true
            return preserved
        }
        let index = annotation.paragraphID - 1
        let candidates = destinations(for: index).filter { new.indices.contains($0) }
        var targetIndex = candidates.first ?? index
        var range: NSRange?
        if old.indices.contains(index), annotation.needsReview != true {
            let source = annotation.side == .original ? old[index].original : old[index].translation
            if !oldRange.contains(index), let candidate = candidates.first {
                let target = annotation.side == .original ? new[candidate].original : new[candidate].translation
                if source == target { range = annotation.resolvedRange(in: target) }
            } else if annotation.side == .original, let originalRange = annotation.resolvedRange(in: source) {
                var matches: [(Int, NSRange)] = []
                for candidate in candidates {
                    let target = new[candidate].original
                    // Merging: relocate the complete old paragraph before relocating its quote.
                    if let parent = uniqueRange(of: source, in: target) {
                        matches.append((candidate, NSRange(location: parent.location + originalRange.location,
                                                           length: originalRange.length)))
                    // Splitting: preserve the occurrence within the retained source slice.
                    } else if let slice = uniqueRange(of: target, in: source),
                              originalRange.location >= slice.location,
                              NSMaxRange(originalRange) <= NSMaxRange(slice) {
                        matches.append((candidate, NSRange(location: originalRange.location - slice.location,
                                                           length: originalRange.length)))
                    }
                }
                if matches.isEmpty {
                    matches = candidates.compactMap { candidate in
                        uniqueRange(of: annotation.quote, in: new[candidate].original).map { (candidate, $0) }
                    }
                }
                if matches.count == 1 { (targetIndex, range) = (matches[0].0, matches[0].1) }
            }
        }
        let target = new.indices.contains(targetIndex)
            ? (annotation.side == .original ? new[targetIndex].original : new[targetIndex].translation) : ""
        var result = PaperAnnotation(id: annotation.id, paragraphID: targetIndex + 1, side: annotation.side,
            quote: annotation.quote, rangeLocation: range?.location ?? annotation.rangeLocation,
            rangeLength: range?.length ?? annotation.rangeLength, scope: annotation.resolvedScope,
            context: range == nil ? annotation.context : target, locator: range == nil ? annotation.locator : nil,
            pdfAnchors: annotation.pdfAnchors, highlightColor: annotation.highlightColor,
            note: annotation.note, createdAt: annotation.createdAt)
        result.needsReview = range == nil
        return result
    }

    private func uniqueRange(of needle: String, in text: String) -> NSRange? {
        guard !needle.isEmpty else { return nil }
        let text = text as NSString
        let first = text.range(of: needle)
        guard first.location != NSNotFound else { return nil }
        let start = first.location + 1
        let next = text.range(of: needle, range: NSRange(location: start, length: text.length - start))
        return next.location == NSNotFound ? first : nil
    }
}

struct PaperSection: Identifiable, Equatable {
    let id: Int
    let title: String
    let paragraphIDs: [Int]
}

struct ParagraphQualityIssue: Identifiable, Equatable {
    let paragraphID: Int
    let reason: String
    var id: Int { paragraphID }
}

enum PaperReadingAnalysis {
    static func sections(in paper: PaperDocument) -> [PaperSection] {
        var headings: [Int: String] = [:]
        for segment in paper.markdownSegments ?? [] where segment.kind == .heading && !segment.isReference {
            if let id = segment.paragraphID, paper.paragraphs.indices.contains(id - 1) {
                headings[id] = segment.analysisText ?? paper.paragraphs[id - 1]
            }
        }
        for (index, text) in paper.paragraphs.enumerated() where headings[index + 1] == nil {
            headings[index + 1] = TextProcessing.detectedSectionTitle(in: text)
        }
        guard !paper.paragraphs.isEmpty else { return [] }
        if headings[1] == nil { headings[1] = headings.isEmpty ? "Document" : "Opening material" }
        let starts = headings.keys.sorted()
        return starts.enumerated().map { index, start in
            let end = index + 1 < starts.count ? starts[index + 1] : paper.paragraphs.count + 1
            return PaperSection(id: start, title: headings[start]!, paragraphIDs: Array(start..<end))
        }
    }

    static func overviewParagraphIDs(in sections: [PaperSection]) -> [Int] {
        sections.filter {
            $0.title.range(of: #"(?i)\b(abstract|conclusions?|concluding remarks)\b|摘要|结论"#,
                           options: .regularExpression) != nil
        }.flatMap(\.paragraphIDs)
    }

    static func qualityIssues(in paper: PaperDocument) -> [ParagraphQualityIssue] {
        let protectedIDs = Set((paper.markdownSegments ?? []).filter {
            $0.kind != .paragraph || $0.isReference
        }.compactMap(\.paragraphID))
        return paper.paragraphs.enumerated().compactMap { index, paragraph in
            let id = index + 1
            let text = paragraph.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !protectedIDs.contains(id), !text.isEmpty,
                  TextProcessing.detectedSectionTitle(in: text) == nil else { return nil }
            let reason: String?
            if text.range(of: #"[A-Za-z]{2,}[-‐]\s*$"#, options: .regularExpression) != nil {
                reason = "Possible cut-off word at the end. Compare with the next block and original page."
            } else if text.range(of: #"(?i)\b(in case of|where we|such as|given by|defined as)\s*$"#, options: .regularExpression) != nil {
                reason = "This phrase appears unfinished. The continuation may be in the next block."
            } else if text.range(of: #"^[\d\s.,()\[\]+=×÷−*/^_]+$"#, options: .regularExpression) != nil {
                reason = "Possible detached number, equation fragment, or plot label. Check the original before merging."
            } else if text.count > 100 && text.range(of: #"[.!?。！？:：;；][\"'”’）)\]]*\s*$"#, options: .regularExpression) == nil {
                reason = "No sentence-ending punctuation was found. This can be valid near a formula; check the source."
            } else {
                reason = nil
            }
            return reason.map { ParagraphQualityIssue(paragraphID: id, reason: $0) }
        }
    }
}
