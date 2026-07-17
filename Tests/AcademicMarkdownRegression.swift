import Foundation

@main
struct AcademicMarkdownRegression {
    static func main() throws {
        let markdown = """
        # A Structured Paper

        ## Abstract

        We study $E = mc^2$ in a compact experiment.

        ![Experimental setup](images/setup.png)

        ## Methods

        Samples were measured at 37 °C and analyzed with `tool --safe`.

        $$
        y = \\sum_{i=1}^{n} x_i
        $$

        | Group | Score |
        | --- | --- |
        | A | 0.91 |

        ## Results

        The method improved accuracy by 4.2% (Figure 1).

        ## References

        [1] Example Author. Example study. 2024.
        """

        let parsed = AcademicMarkdownProcessor.parse(markdown)
        require(parsed.contains(where: { $0.kind == .image }), "Image block was not detected")
        require(parsed.contains(where: { $0.kind == .formula }), "Display formula was not detected")
        require(parsed.contains(where: { $0.kind == .table }), "Table block was not detected")

        let singleLineHTML = """
        <table><tr><td>Result</td></tr></table>
        The paragraph after the table must remain independent.
        """
        let htmlSegments = AcademicMarkdownProcessor.parse(singleLineHTML)
        require(htmlSegments.count == 2, "A single-line HTML table consumed the following paragraph")
        require(htmlSegments[0].kind == .table, "Single-line HTML table was not detected")
        require(
            htmlSegments[1].analysisText == "The paragraph after the table must remain independent.",
            "Text after a single-line HTML table was not preserved"
        )

        let structured = AcademicMarkdownProcessor.assignParagraphs(in: parsed)
        require(!structured.paragraphs.isEmpty, "No analysis paragraphs were assigned")
        require(
            structured.referenceParagraphs.contains(where: { $0.contains("References") }),
            "Reference heading was not excluded from AI paragraphs"
        )
        require(
            structured.segments.contains(where: { $0.isReference && $0.source.contains("Example Author") }),
            "Reference source block was not retained"
        )

        let protectedSource = "The value $E = mc^2$ is shown in ![Figure](images/figure.png) at https://example.org."
        let payload = AcademicMarkdownProcessor.protectForTranslation(protectedSource)
        require(payload.replacements.count == 3, "Expected formula, image, and URL protection")
        let restored = try AcademicMarkdownProcessor.restoreProtectedTokens(
            in: payload.text,
            from: payload
        )
        require(restored == protectedSource, "Protected Markdown did not round-trip exactly")

        let results = structured.paragraphs.enumerated().map { index, paragraph in
            let paragraphID = index + 1
            let segment = structured.segments.first(where: { $0.paragraphID == paragraphID })
            return ParagraphResult(
                id: paragraphID,
                original: paragraph,
                sourceMarkdown: segment?.source,
                translation: "译文 \(paragraphID)",
                translationMarkdown: segment?.kind == .heading
                    ? "## 译文 \(paragraphID)"
                    : "译文 \(paragraphID)",
                status: .ok,
                chunkCount: 1
            )
        }
        let translated = AcademicMarkdownProcessor.translatedMarkdown(
            segments: structured.segments,
            results: results
        )
        require(translated.contains("images/setup.png"), "Translated Markdown lost the image path")
        require(translated.contains("\\sum_{i=1}^{n}"), "Translated Markdown lost the formula")
        require(translated.contains("| Group | Score |"), "Translated Markdown lost the table")
        require(translated.contains("Example Author"), "Translated Markdown lost original references")

        let readerItems = AcademicMarkdownProcessor.readerFlowItems(
            segments: structured.segments,
            results: results
        )
        let abstractIndex = readerItems.firstIndex { item in
            guard case .paragraph(let paragraph) = item else { return false }
            return paragraph.original.contains("We study")
        }
        let imageIndex = readerItems.firstIndex { item in
            guard case .resource(let resource) = item else { return false }
            return resource.kind == .image
        }
        let methodsIndex = readerItems.firstIndex { item in
            guard case .paragraph(let paragraph) = item else { return false }
            return paragraph.original == "Methods"
        }
        let formulaIndex = readerItems.firstIndex { item in
            guard case .resource(let resource) = item else { return false }
            return resource.kind == .formula
        }
        let tableIndex = readerItems.firstIndex { item in
            guard case .resource(let resource) = item else { return false }
            return resource.kind == .table
        }
        require(
            abstractIndex != nil && imageIndex != nil && methodsIndex != nil &&
                abstractIndex! < imageIndex! && imageIndex! < methodsIndex!,
            "Reader flow did not keep the figure between its surrounding MinerU paragraphs"
        )
        require(
            formulaIndex != nil && tableIndex != nil && formulaIndex! < tableIndex!,
            "Reader flow changed the source order of the formula and table"
        )
        require(
            !readerItems.contains { item in
                guard case .paragraph(let paragraph) = item else { return false }
                return paragraph.original.contains("Example Author")
            },
            "Reader flow included a reference paragraph that should not be translated"
        )

        let assets = AcademicMarkdownProcessor.localAssetPaths(in: markdown)
        require(assets == ["images/setup.png"], "Local asset discovery returned the wrong paths")

        let facsimileAssets = AcademicMarkdownProcessor.localAssetPaths(
            in: "[Original PDF](original.pdf)\n\n![Page](pages/page-0001.png)"
        )
        require(
            facsimileAssets == ["original.pdf", "pages/page-0001.png"],
            "Facsimile PDF and page assets were not discovered"
        )

        let renderedHTML = MarkdownPreviewHTMLRenderer.render(
            markdown: "Authors: Cantarel<sup>1</sup> and Korf<sub>2</sub>.",
            title: "Inline HTML"
        )
        require(
            renderedHTML.contains("Cantarel<sup>1</sup> and Korf<sub>2</sub>"),
            "Safe MinerU superscript and subscript tags were escaped in the preview"
        )
        require(
            !renderedHTML.contains("&lt;sup&gt;"),
            "The preview exposed safe inline HTML as literal text"
        )
        let embeddedHTML = MarkdownPreviewHTMLRenderer.render(
            markdown: "![Setup](images/setup.png)",
            title: "Embedded figure",
            presentation: .embedded
        )
        require(
            embeddedHTML.contains("<body class=\"embedded\">") &&
                embeddedHTML.contains("images/setup.png"),
            "Embedded Reader resources did not render with their local image path"
        )
        let bilingualHTML = MarkdownPreviewHTMLRenderer.render(
            markdown: "> **Simplified Chinese translation**\n>\n> 译文",
            title: "Bilingual selection"
        )
        require(
            bilingualHTML.contains("class=\"paperbridge-translation\""),
            "Bilingual Markdown did not identify translated blocks for selection tools"
        )

        let readerSelection = ReaderTextSelection(
            paragraphID: 1,
            side: .original,
            text: "selected text",
            context: "selected text in context",
            rangeLocation: 0,
            rangeLength: 13
        )
        let paperSelection = ReaderTextSelection(
            scope: .paper,
            paragraphID: 1,
            side: .original,
            text: "selected text",
            context: "selected text in context",
            rangeLocation: 0,
            rangeLength: 13
        )
        require(
            readerSelection.identity != paperSelection.identity,
            "Selections from different workspaces shared the same identity"
        )

        let selectionPrompt = PromptLibrary.selectionTranslationPrompt(
            selection: "protein domains",
            context: "Domain data provide a measure of annotation quality.",
            from: .english,
            to: .simplifiedChinese
        )
        let contextMarker = selectionPrompt.range(
            of: "<<<PAPERBRIDGE_CONTEXT_DO_NOT_TRANSLATE>>>"
        )
        let selectionMarker = selectionPrompt.range(
            of: "<<<PAPERBRIDGE_SELECTION_TRANSLATE_ONLY>>>"
        )
        require(
            contextMarker != nil && selectionMarker != nil &&
                contextMarker!.lowerBound < selectionMarker!.lowerBound,
            "Selection translation prompt did not put reference context before the target text"
        )
        require(
            selectionPrompt.hasSuffix("<<<END_PAPERBRIDGE_SELECTION>>>") &&
                selectionPrompt.contains("DO NOT translate or output the context"),
            "Selection translation prompt did not clearly isolate the selected text"
        )
        let strictSelectionPrompt = PromptLibrary.strictSelectionTranslationPrompt(
            selection: "protein domains",
            from: .english,
            to: .simplifiedChinese
        )
        require(
            !strictSelectionPrompt.contains("Domain data provide") &&
                strictSelectionPrompt.hasSuffix("<<<END_PAPERBRIDGE_SELECTION>>>"),
            "Strict selection retry included surrounding context"
        )
        require(
            SelectionTranslationPolicy.isLikelyOverexpanded(
                output: String(repeating: "整段翻译内容", count: 20),
                comparedTo: "protein domains"
            ),
            "Overexpanded selection translations were not detected"
        )
        require(
            !SelectionTranslationPolicy.isLikelyOverexpanded(
                output: "蛋白质结构域",
                comparedTo: "protein domains"
            ),
            "A concise selection translation was incorrectly rejected"
        )

        let legacyAnnotationJSON = """
        {
          "id": "00000000-0000-0000-0000-000000000001",
          "paragraphID": 1,
          "side": "original",
          "quote": "Legacy",
          "rangeLocation": 0,
          "rangeLength": 6,
          "highlightColor": "amber",
          "note": "",
          "createdAt": "2026-07-17T12:00:00Z"
        }
        """
        let annotationDecoder = JSONDecoder()
        annotationDecoder.dateDecodingStrategy = .iso8601
        let legacyAnnotation = try annotationDecoder.decode(
            PaperAnnotation.self,
            from: Data(legacyAnnotationJSON.utf8)
        )
        require(
            legacyAnnotation.resolvedScope == .reader,
            "Legacy annotations without a saved workspace no longer default to Reader"
        )

        let fileManager = FileManager.default
        let exportRoot = fileManager.temporaryDirectory.appendingPathComponent(
            "paperbridge-markdown-export-" + UUID().uuidString,
            isDirectory: true
        )
        defer { try? fileManager.removeItem(at: exportRoot) }
        let exportAssets = exportRoot.appendingPathComponent("assets", isDirectory: true)
        let exports = exportRoot.appendingPathComponent("exports", isDirectory: true)
        try fileManager.createDirectory(
            at: exportAssets.appendingPathComponent("images", isDirectory: true),
            withIntermediateDirectories: true
        )
        try fileManager.createDirectory(at: exports, withIntermediateDirectories: true)
        let exactPDF = Data("exact-original-pdf".utf8)
        try exactPDF.write(to: exportAssets.appendingPathComponent("original.pdf"), options: .atomic)
        try Data("figure".utf8).write(
            to: exportAssets.appendingPathComponent("images/setup.png"),
            options: .atomic
        )
        let exportResult = try MarkdownBundleExporter(fileManager: fileManager).export(
            paperName: "paper.pdf",
            documents: [
                "paper_original.md": "Original",
                "paper_translation_zh-Hans.md": translated
            ],
            assetSourceDirectory: exportAssets,
            to: exports
        )
        require(
            (try? Data(contentsOf: exportResult.directoryURL.appendingPathComponent("original.pdf"))) == exactPDF,
            "Markdown bundle export omitted the unmodified original PDF"
        )
        require(
            fileManager.fileExists(
                atPath: exportResult.directoryURL.appendingPathComponent("images/setup.png").path
            ),
            "Translated Markdown export omitted its referenced figure asset"
        )

        print("Academic Markdown regression tests passed.")
    }

    private static func require(
        _ condition: @autoclosure () -> Bool,
        _ message: String
    ) {
        guard condition() else {
            fputs("FAIL: \(message)\n", stderr)
            exit(1)
        }
    }
}
