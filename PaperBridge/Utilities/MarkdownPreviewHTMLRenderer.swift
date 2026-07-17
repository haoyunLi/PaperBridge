import Foundation

enum MarkdownPreviewHTMLRenderer {
    static func render(
        markdown: String,
        title: String,
        presentation: MarkdownPreviewPresentation = .document
    ) -> String {
        let segments = AcademicMarkdownProcessor.parse(markdown)
        let body = segments.map(renderSegment).joined(separator: "\n")
        let bodyClass = presentation == .embedded ? " class=\"embedded\"" : ""
        return """
        <!doctype html>
        <html lang="en">
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src file: data:; style-src 'unsafe-inline';">
          <title>\(escapeHTML(title))</title>
          <style>
            :root { color-scheme: light dark; }
            * { box-sizing: border-box; }
            body {
              margin: 0 auto;
              max-width: 920px;
              padding: 46px 54px 80px;
              color: #17201c;
              background: #f5f3ec;
              font-family: "New York", "Iowan Old Style", Georgia, serif;
              font-size: 17px;
              line-height: 1.68;
              -webkit-font-smoothing: antialiased;
            }
            article { background: #fffdf7; border: 1px solid #d9d5ca; padding: 50px 58px 72px; }
            h1, h2, h3, h4, h5, h6 { color: #10251c; line-height: 1.2; margin: 1.7em 0 0.65em; }
            h1 { font-size: 2.05em; margin-top: 0; }
            h2 { font-size: 1.5em; padding-bottom: 0.25em; border-bottom: 1px solid #d8d5cb; }
            h3 { font-size: 1.22em; }
            p { margin: 0.85em 0; text-align: left; }
            a { color: #0e6550; text-underline-offset: 2px; }
            blockquote { margin: 1.2em 0; padding: 0.15em 1.15em; border-left: 3px solid #c66b3d; color: #405047; background: #f1eee5; }
            .list-item { margin: 0.42em 0 0.42em 1.4em; }
            .list-marker { display: inline-block; min-width: 1.55em; margin-left: -1.55em; color: #0e6550; font-weight: 700; }
            figure { margin: 1.7em auto; text-align: center; }
            img { display: block; max-width: 100%; max-height: 760px; height: auto; margin: 0 auto; object-fit: contain; }
            .pdf-page { margin: 2.2em auto; }
            .pdf-page img { width: 100%; max-height: none; border: 1px solid #d4d0c5; box-shadow: 0 12px 30px rgba(26, 34, 29, 0.12); }
            figcaption { margin-top: 0.55em; color: #66716a; font-family: -apple-system, BlinkMacSystemFont, sans-serif; font-size: 0.83em; }
            table { width: 100%; border-collapse: collapse; margin: 1.5em 0; font-family: -apple-system, BlinkMacSystemFont, sans-serif; font-size: 0.88em; }
            th, td { border: 1px solid #cfcbbf; padding: 0.55em 0.65em; vertical-align: top; }
            th { background: #e9e6dc; color: #173126; text-align: left; }
            pre { overflow-x: auto; padding: 1em 1.15em; background: #202622; color: #edf1ed; border-radius: 4px; }
            code { font-family: "SFMono-Regular", Menlo, monospace; font-size: 0.86em; }
            :not(pre) > code { padding: 0.12em 0.3em; color: #823d20; background: #eee9dd; }
            .math-block { overflow-x: auto; margin: 1.35em 0; padding: 0.35em 0; text-align: center; }
            details { margin: 0.8em 0; font-family: -apple-system, BlinkMacSystemFont, sans-serif; font-size: 0.9em; }
            summary { cursor: pointer; color: #56635c; }
            .remote-image { padding: 1em; color: #8a4a2a; background: #f4e8dd; font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
            ::highlight(paperbridge-amber) { background: rgba(255, 204, 64, 0.38); }
            ::highlight(paperbridge-teal) { background: rgba(56, 168, 145, 0.34); }
            ::highlight(paperbridge-coral) { background: rgba(255, 132, 84, 0.32); }
            ::highlight(paperbridge-note) { text-decoration: underline 2px #0e8068; text-underline-offset: 3px; }
            body.embedded { max-width: none; padding: 0; background: transparent; font-size: 15px; line-height: 1.55; }
            body.embedded article { min-height: 100%; padding: 16px 18px; border: 0; }
            body.embedded h1, body.embedded h2, body.embedded h3,
            body.embedded h4, body.embedded h5, body.embedded h6 { margin: 0.5em 0; }
            body.embedded p, body.embedded figure, body.embedded table,
            body.embedded .math-block { margin-top: 0.35em; margin-bottom: 0.35em; }
            body.embedded img { max-height: 400px; }
            body.embedded pre { margin: 0; }
            @media (prefers-color-scheme: dark) {
              body { color: #e2e7e3; background: #151a17; }
              article { background: #1d231f; border-color: #3c4640; }
              h1, h2, h3, h4, h5, h6 { color: #f2f6f3; }
              h2 { border-color: #414a45; }
              blockquote { color: #c9d2cc; background: #252d28; }
              th { color: #eaf2ed; background: #2c3630; }
              th, td { border-color: #465149; }
              .pdf-page img { border-color: #48524c; box-shadow: 0 12px 30px rgba(0, 0, 0, 0.28); }
              :not(pre) > code { color: #ffb18a; background: #303832; }
            }
            @media (max-width: 720px) {
              body { padding: 0; }
              article { border: 0; padding: 30px 24px 56px; }
            }
          </style>
        </head>
        <body\(bodyClass)><article>\(body)</article></body>
        </html>
        """
    }

    private static func renderSegment(_ segment: PaperMarkdownSegment) -> String {
        switch segment.kind {
        case .heading:
            let trimmed = segment.source.trimmingCharacters(in: .whitespacesAndNewlines)
            let level = min(max(trimmed.prefix { $0 == "#" }.count, 1), 6)
            let content = trimmed.drop(while: { $0 == "#" || $0.isWhitespace })
            return "<h\(level)>\(renderInline(String(content)))</h\(level)>"
        case .paragraph:
            let normalized = segment.source.replacingOccurrences(of: "\n", with: " ")
            return "<p>\(renderInline(normalized))</p>"
        case .listItem:
            let source = segment.source.trimmingCharacters(in: .whitespacesAndNewlines)
            let marker = firstMatch(in: source, pattern: #"^\s*((?:[-+*]|\d+[.)]))\s+"#, group: 1) ?? "•"
            let content = replacingMatches(
                in: source,
                pattern: #"^\s*(?:[-+*]|\d+[.)])\s+"#,
                template: ""
            )
            return "<div class=\"list-item\"><span class=\"list-marker\">\(escapeHTML(marker))</span>\(renderInline(content))</div>"
        case .quote:
            let content = replacingMatches(
                in: segment.source,
                pattern: #"(?m)^\s*>\s?"#,
                template: ""
            )
            let cssClass = segment.source.lowercased().contains(" translation**")
                ? " class=\"paperbridge-translation\""
                : ""
            return "<blockquote\(cssClass)>\(renderInline(content))</blockquote>"
        case .image:
            return renderInline(segment.source)
        case .formula:
            return "<div class=\"math-block\">\(escapeHTML(segment.source))</div>"
        case .table:
            if segment.source.trimmingCharacters(in: .whitespaces).hasPrefix("<") {
                return renderSafeHTML(segment.source)
            }
            return renderMarkdownTable(segment.source)
        case .code:
            let code = stripCodeFence(segment.source)
            return "<pre><code>\(escapeHTML(code))</code></pre>"
        case .rawHTML:
            return renderSafeHTML(segment.source)
        case .separator:
            return ""
        }
    }

    private static func renderInline(_ source: String) -> String {
        var text = source
        var tokens: [String: String] = [:]
        var tokenIndex = 0

        func protect(pattern: String, transform: (String, NSTextCheckingResult) -> String) {
            guard let regex = try? NSRegularExpression(pattern: pattern) else { return }
            let range = NSRange(text.startIndex..<text.endIndex, in: text)
            for match in regex.matches(in: text, range: range).reversed() {
                guard let swiftRange = Range(match.range, in: text) else { continue }
                tokenIndex += 1
                let token = "PAPERBRIDGEHTMLTOKEN\(tokenIndex)END"
                tokens[token] = transform(String(text[swiftRange]), match)
                text.replaceSubrange(swiftRange, with: token)
            }
        }

        protect(pattern: #"!\[([^\]]*)\]\((?:<)?([^)>\s]+)(?:>)?(?:\s+[^)]*)?\)"#) { full, _ in
            guard let regex = try? NSRegularExpression(
                pattern: #"!\[([^\]]*)\]\((?:<)?([^)>\s]+)(?:>)?(?:\s+[^)]*)?\)"#
            ) else { return escapeHTML(full) }
            let nsFull = full as NSString
            let range = NSRange(location: 0, length: nsFull.length)
            guard let match = regex.firstMatch(in: full, range: range), match.numberOfRanges > 2 else {
                return escapeHTML(full)
            }
            let alt = nsFull.substring(with: match.range(at: 1))
            let path = nsFull.substring(with: match.range(at: 2))
            guard isSafeLocalResource(path) else {
                return "<div class=\"remote-image\">Remote image blocked: \(escapeHTML(path))</div>"
            }
            let caption = alt.isEmpty ? "" : "<figcaption>\(escapeHTML(alt))</figcaption>"
            let figureClass = alt.hasPrefix("Original PDF page") ? " class=\"pdf-page\"" : ""
            return "<figure\(figureClass)><img src=\"\(escapeAttribute(path))\" alt=\"\(escapeAttribute(alt))\">\(caption)</figure>"
        }

        protect(pattern: #"\[([^\]]+)\]\(([^)]+)\)"#) { full, _ in
            guard let regex = try? NSRegularExpression(pattern: #"\[([^\]]+)\]\(([^)]+)\)"#) else {
                return escapeHTML(full)
            }
            let nsFull = full as NSString
            let range = NSRange(location: 0, length: nsFull.length)
            guard let match = regex.firstMatch(in: full, range: range), match.numberOfRanges > 2 else {
                return escapeHTML(full)
            }
            let label = nsFull.substring(with: match.range(at: 1))
            let url = nsFull.substring(with: match.range(at: 2))
            guard isSafeLink(url) else { return escapeHTML(label) }
            return "<a href=\"\(escapeAttribute(url))\">\(escapeHTML(label))</a>"
        }

        protect(pattern: #"`([^`\n]+)`"#) { full, _ in
            "<code>\(escapeHTML(String(full.dropFirst().dropLast())))</code>"
        }
        protect(pattern: #"(?s)\$\$.*?\$\$|\\\[.*?\\\]|\\\(.*?\\\)|(?<!\\)\$(?!\$)(?:\\.|[^$\n])+\$"#) { full, _ in
            escapeHTML(full)
        }
        let safeInlineTags: Set<String> = ["sup", "sub", "br", "strong", "em", "b", "i"]
        protect(pattern: #"(?i)</?\s*(?:sup|sub|br|strong|em|b|i)\s*/?>"#) { full, _ in
            sanitizedTag(full, allowedTags: safeInlineTags)
        }

        text = escapeHTML(text)
        text = replacingMatches(in: text, pattern: #"\*\*(.+?)\*\*"#, template: "<strong>$1</strong>")
        text = replacingMatches(in: text, pattern: #"__(.+?)__"#, template: "<strong>$1</strong>")
        text = replacingMatches(in: text, pattern: #"(?<!\*)\*([^*]+)\*(?!\*)"#, template: "<em>$1</em>")
        text = replacingMatches(in: text, pattern: #"~~(.+?)~~"#, template: "<del>$1</del>")
        text = text.replacingOccurrences(of: "\n", with: "<br>")
        for (token, replacement) in tokens {
            text = text.replacingOccurrences(of: token, with: replacement)
        }
        return text
    }

    private static func renderMarkdownTable(_ source: String) -> String {
        let rows = source.components(separatedBy: "\n")
            .map { splitTableRow($0) }
        guard rows.count >= 2 else { return "<pre>\(escapeHTML(source))</pre>" }
        let header = rows[0]
        let bodyRows = rows.dropFirst(2)
        let headerHTML = header.map { "<th>\(renderInline($0))</th>" }.joined()
        let bodyHTML = bodyRows.map { row in
            "<tr>" + row.map { "<td>\(renderInline($0))</td>" }.joined() + "</tr>"
        }.joined()
        return "<table><thead><tr>\(headerHTML)</tr></thead><tbody>\(bodyHTML)</tbody></table>"
    }

    private static func splitTableRow(_ row: String) -> [String] {
        var trimmed = row.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.hasPrefix("|") { trimmed.removeFirst() }
        if trimmed.hasSuffix("|") { trimmed.removeLast() }
        return trimmed.split(separator: "|", omittingEmptySubsequences: false)
            .map { $0.trimmingCharacters(in: .whitespaces) }
    }

    private static func renderSafeHTML(_ source: String) -> String {
        let allowedTags: Set<String> = [
            "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption",
            "colgroup", "col", "details", "summary", "figure", "figcaption", "img",
            "p", "div", "span", "strong", "em", "b", "i", "sup", "sub", "br"
        ]
        guard let regex = try? NSRegularExpression(pattern: #"<[^>]+>"#) else {
            return escapeHTML(source)
        }

        let nsSource = source as NSString
        let fullRange = NSRange(location: 0, length: nsSource.length)
        var output = ""
        var cursor = 0
        for match in regex.matches(in: source, range: fullRange) {
            if match.range.location > cursor {
                output += escapeHTML(nsSource.substring(with: NSRange(
                    location: cursor,
                    length: match.range.location - cursor
                )))
            }
            let tag = nsSource.substring(with: match.range)
            output += sanitizedTag(tag, allowedTags: allowedTags)
            cursor = NSMaxRange(match.range)
        }
        if cursor < nsSource.length {
            output += escapeHTML(nsSource.substring(from: cursor))
        }
        return output
    }

    private static func sanitizedTag(_ tag: String, allowedTags: Set<String>) -> String {
        guard let name = firstMatch(
            in: tag,
            pattern: #"^<\s*/?\s*([A-Za-z0-9]+)"#,
            group: 1
        )?.lowercased(), allowedTags.contains(name) else {
            return escapeHTML(tag)
        }
        let isClosing = tag.range(of: #"^<\s*/"#, options: .regularExpression) != nil
        if isClosing { return "</\(name)>" }
        if name == "br" || name == "col" { return "<\(name)>" }

        var attributes = ""
        if name == "th" || name == "td" {
            for attribute in ["rowspan", "colspan"] {
                if let value = firstMatch(
                    in: tag,
                    pattern: "(?i)\\b\(attribute)\\s*=\\s*[\\\"']?([0-9]+)",
                    group: 1
                ) {
                    attributes += " \(attribute)=\"\(escapeAttribute(value))\""
                }
            }
        } else if name == "img",
                  let path = firstMatch(
                    in: tag,
                    pattern: #"(?i)\bsrc\s*=\s*[\"']([^\"']+)[\"']"#,
                    group: 1
                  ), isSafeLocalResource(path) {
            attributes += " src=\"\(escapeAttribute(path))\""
            if let alt = firstMatch(
                in: tag,
                pattern: #"(?i)\balt\s*=\s*[\"']([^\"']*)[\"']"#,
                group: 1
            ) {
                attributes += " alt=\"\(escapeAttribute(alt))\""
            }
        }
        return "<\(name)\(attributes)>"
    }

    private static func stripCodeFence(_ source: String) -> String {
        var lines = source.components(separatedBy: "\n")
        if lines.first?.trimmingCharacters(in: .whitespaces).hasPrefix("```") == true ||
            lines.first?.trimmingCharacters(in: .whitespaces).hasPrefix("~~~") == true {
            lines.removeFirst()
        }
        if lines.last?.trimmingCharacters(in: .whitespaces).hasPrefix("```") == true ||
            lines.last?.trimmingCharacters(in: .whitespaces).hasPrefix("~~~") == true {
            lines.removeLast()
        }
        return lines.joined(separator: "\n")
    }

    private static func isSafeLocalResource(_ value: String) -> Bool {
        let lowercased = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return !lowercased.hasPrefix("http:") &&
            !lowercased.hasPrefix("https:") &&
            !lowercased.hasPrefix("javascript:") &&
            !lowercased.hasPrefix("file:") &&
            !lowercased.hasPrefix("/") &&
            !lowercased.contains("../")
    }

    private static func isSafeLink(_ value: String) -> Bool {
        let lowercased = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return lowercased.hasPrefix("https://") ||
            lowercased.hasPrefix("http://") ||
            lowercased.hasPrefix("mailto:") ||
            lowercased.hasPrefix("#") ||
            isSafeLocalResource(value)
    }

    private static func escapeHTML(_ value: String) -> String {
        value
            .replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
            .replacingOccurrences(of: "\"", with: "&quot;")
    }

    private static func escapeAttribute(_ value: String) -> String {
        escapeHTML(value).replacingOccurrences(of: "'", with: "&#39;")
    }

    private static func replacingMatches(in text: String, pattern: String, template: String) -> String {
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return text }
        let range = NSRange(text.startIndex..<text.endIndex, in: text)
        return regex.stringByReplacingMatches(in: text, range: range, withTemplate: template)
    }

    private static func firstMatch(
        in text: String,
        pattern: String,
        group: Int
    ) -> String? {
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return nil }
        let nsText = text as NSString
        let range = NSRange(location: 0, length: nsText.length)
        guard let match = regex.firstMatch(in: text, range: range),
              match.numberOfRanges > group,
              match.range(at: group).location != NSNotFound else { return nil }
        return nsText.substring(with: match.range(at: group))
    }
}
