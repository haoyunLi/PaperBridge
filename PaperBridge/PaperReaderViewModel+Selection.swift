import Foundation

extension PaperReaderViewModel {
    var canLookupSelection: Bool {
        activeTextSelection != nil && !isSelectionLookupBusy
    }

    var activeSelectionAnnotation: PaperAnnotation? {
        guard let selection = activeTextSelection else { return nil }
        return annotations.first {
            $0.resolvedScope == selection.scope &&
                $0.paragraphID == selection.paragraphID &&
                $0.side == selection.side &&
                $0.locator == selection.locator &&
                $0.rangeLocation == selection.rangeLocation &&
                $0.rangeLength == selection.rangeLength &&
                $0.quote == selection.text
        }
    }

    func annotations(for paragraphID: Int, side: ReaderTextSide) -> [PaperAnnotation] {
        annotations.filter {
            $0.resolvedScope == .reader &&
                $0.paragraphID == paragraphID &&
                $0.side == side
        }
    }

    func annotations(
        for scope: TextSelectionScope,
        side: ReaderTextSide? = nil
    ) -> [PaperAnnotation] {
        annotations.filter { annotation in
            annotation.resolvedScope == scope &&
                (side == nil || annotation.side == side)
        }
    }

    func captureTextSelection(_ selection: ReaderTextSelection) {
        let trimmed = selection.text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        if activeTextSelection?.identity != selection.identity {
            selectionTask?.cancel()
            isSelectionLookupBusy = false
            selectionLookupError = nil
            selectionLookupStatus = ""
            selectionTranslation = ""
            selectionExplanation = ""
        }

        activeTextSelection = selection
        if selection.scope == .reader {
            selectedParagraphID = selection.paragraphID
        }
        isInspectorPresented = true
        restoreSelectionLookupCache(for: selection)
    }

    func clearTextSelection() {
        selectionTask?.cancel()
        selectionTask = nil
        activeTextSelection = nil
        selectionTranslation = ""
        selectionExplanation = ""
        selectionLookupStatus = ""
        selectionLookupError = nil
        isSelectionLookupBusy = false
    }

    func selectParagraphForExplanation(_ paragraphID: Int) {
        clearTextSelection()
        selectedParagraphID = paragraphID
        isInspectorPresented = true
    }

    func translateTextSelection() {
        runSelectionLookup(.translation)
    }

    func explainTextSelection() {
        runSelectionLookup(.explanation)
    }

    func cancelSelectionLookup() {
        selectionTask?.cancel()
        selectionTask = nil
        isSelectionLookupBusy = false
        selectionLookupStatus = "Quick lookup cancelled."
    }

    func applyHighlight(_ color: PaperHighlightColor) {
        guard let selection = activeTextSelection else { return }

        if let index = annotationIndex(for: selection) {
            annotations[index].highlightColor = color
        } else {
            annotations.append(
                PaperAnnotation(
                    paragraphID: selection.paragraphID,
                    side: selection.side,
                    quote: selection.text,
                    rangeLocation: selection.rangeLocation,
                    rangeLength: selection.rangeLength,
                    scope: selection.scope,
                    context: selection.context,
                    locator: selection.locator,
                    highlightColor: color
                )
            )
        }
        persistWorkspace()
    }

    func saveSelectionNote(_ note: String) {
        guard let selection = activeTextSelection else { return }
        let trimmed = note.trimmingCharacters(in: .whitespacesAndNewlines)

        if let index = annotationIndex(for: selection) {
            annotations[index].note = trimmed
            if annotations[index].highlightColor == nil && trimmed.isEmpty {
                annotations.remove(at: index)
            }
        } else if !trimmed.isEmpty {
            annotations.append(
                PaperAnnotation(
                    paragraphID: selection.paragraphID,
                    side: selection.side,
                    quote: selection.text,
                    rangeLocation: selection.rangeLocation,
                    rangeLength: selection.rangeLength,
                    scope: selection.scope,
                    context: selection.context,
                    locator: selection.locator,
                    note: trimmed
                )
            )
        }
        persistWorkspace()
    }

    func removeSelectionAnnotation() {
        guard let selection = activeTextSelection,
              let index = annotationIndex(for: selection) else {
            return
        }
        annotations.remove(at: index)
        persistWorkspace()
    }

    func activateAnnotation(_ annotation: PaperAnnotation) {
        let scope = annotation.resolvedScope
        if scope == .reader {
            guard let paragraph = paragraphResults.first(where: { $0.id == annotation.paragraphID }) else {
                return
            }

            let context = annotation.side == .original
                ? paragraph.original
                : paragraph.translation
            guard let range = annotation.resolvedRange(in: context) else {
                navigateToParagraph(annotation.paragraphID)
                return
            }

            navigateToParagraph(annotation.paragraphID)
            captureTextSelection(
                ReaderTextSelection(
                    paragraphID: annotation.paragraphID,
                    side: annotation.side,
                    text: (context as NSString).substring(with: range),
                    context: context,
                    rangeLocation: range.location,
                    rangeLength: range.length
                )
            )
            return
        }

        workspaceMode = scope.workspaceMode
        if scope == .paper {
            displayMode = annotation.side == .original ? .sourceOnly : .translationOnly
        }

        let context = annotation.context?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
            ? annotation.context ?? annotation.quote
            : annotation.quote
        let range = annotation.resolvedRange(in: context) ?? (context as NSString).range(of: annotation.quote)
        guard range.location != NSNotFound else { return }

        captureTextSelection(
            ReaderTextSelection(
                scope: scope,
                paragraphID: annotation.paragraphID,
                side: annotation.side,
                text: annotation.quote,
                context: context,
                rangeLocation: range.location,
                rangeLength: range.length,
                locator: annotation.locator
            )
        )
    }

    func removeAnnotation(id: UUID) {
        annotations.removeAll { $0.id == id }
        persistWorkspace()
    }

    private enum SelectionLookupAction: String {
        case translation
        case explanation
    }

    private func runSelectionLookup(_ action: SelectionLookupAction) {
        guard let paper = loadedPaper,
              let selection = activeTextSelection else {
            return
        }

        selectionTask?.cancel()
        selectionLookupError = nil
        isSelectionLookupBusy = true

        let settings = settings
        let explanationLanguage = explanationLanguage
        let cacheKey = selectionLookupCacheKey(
            for: selection,
            action: action,
            paperChecksum: paper.checksum,
            settings: settings,
            explanationLanguage: explanationLanguage
        )

        if let cached = selectionLookupCache[cacheKey] {
            if action == .translation {
                selectionTranslation = cached
            } else {
                selectionExplanation = cached
            }
            selectionLookupStatus = "Using cached quick lookup."
            isSelectionLookupBusy = false
            return
        }

        selectionTask = Task { [weak self] in
            guard let self else { return }

            do {
                let context = self.selectionContext(
                    selection.context,
                    around: selection.text,
                    maximumLength: action == .translation ? 600 : 2400
                )
                let result: String

                switch action {
                case .translation:
                    let sourceLanguage = selection.side == .original
                        ? settings.sourceLanguage
                        : settings.targetLanguage
                    let targetLanguage = selection.side == .original
                        ? settings.targetLanguage
                        : settings.sourceLanguage

                    if sourceLanguage == targetLanguage {
                        result = selection.text
                    } else {
                        self.selectionLookupStatus = "Translating selection..."
                        try await self.ollamaClient.ensureModelAvailable(
                            baseURL: settings.ollamaBaseURL,
                            model: settings.quickLookupModel
                        )
                        let firstPass = try await self.ollamaClient.generate(
                            baseURL: settings.ollamaBaseURL,
                            model: settings.quickLookupModel,
                            prompt: PromptLibrary.selectionTranslationPrompt(
                                selection: selection.text,
                                context: context,
                                from: sourceLanguage,
                                to: targetLanguage
                            ),
                            systemPrompt: PromptLibrary.selectionTranslationSystemPrompt(
                                targetLanguage: targetLanguage
                            )
                        )

                        if SelectionTranslationPolicy.isLikelyOverexpanded(
                            output: firstPass,
                            comparedTo: selection.text
                        ) {
                            self.selectionLookupStatus = "Refining exact selection..."
                            result = try await self.ollamaClient.generate(
                                baseURL: settings.ollamaBaseURL,
                                model: settings.quickLookupModel,
                                prompt: PromptLibrary.strictSelectionTranslationPrompt(
                                    selection: selection.text,
                                    from: sourceLanguage,
                                    to: targetLanguage
                                ),
                                systemPrompt: PromptLibrary.selectionTranslationSystemPrompt(
                                    targetLanguage: targetLanguage
                                )
                            )
                        } else {
                            result = firstPass
                        }
                    }

                case .explanation:
                    self.selectionLookupStatus = "Explaining selection..."
                    try await self.ollamaClient.ensureModelAvailable(
                        baseURL: settings.ollamaBaseURL,
                        model: settings.quickLookupModel
                    )
                    result = try await self.ollamaClient.generate(
                        baseURL: settings.ollamaBaseURL,
                        model: settings.quickLookupModel,
                        prompt: PromptLibrary.selectionExplanationPrompt(
                            selection: selection.text,
                            context: context,
                            language: explanationLanguage
                        ),
                        systemPrompt: PromptLibrary.explainSystemPrompt
                    )
                }

                try Task.checkCancellation()
                guard self.activeTextSelection == selection else { return }

                self.selectionLookupCache[cacheKey] = result
                if action == .translation {
                    self.selectionTranslation = result
                    self.selectionLookupStatus = "Selection translated."
                } else {
                    self.selectionExplanation = result
                    self.selectionLookupStatus = "Selection explained."
                }
                self.isSelectionLookupBusy = false
                self.selectionTask = nil
            } catch is CancellationError {
                guard self.activeTextSelection == selection else { return }
                self.isSelectionLookupBusy = false
                self.selectionTask = nil
            } catch {
                guard self.activeTextSelection == selection else { return }
                self.selectionLookupError = error.localizedDescription
                self.selectionLookupStatus = ""
                self.isSelectionLookupBusy = false
                self.selectionTask = nil
            }
        }
    }

    func restoreSelectionLookupCache(for selection: ReaderTextSelection) {
        guard let paper = loadedPaper else { return }

        let translationKey = selectionLookupCacheKey(
            for: selection,
            action: .translation,
            paperChecksum: paper.checksum,
            settings: settings,
            explanationLanguage: explanationLanguage
        )
        let explanationKey = selectionLookupCacheKey(
            for: selection,
            action: .explanation,
            paperChecksum: paper.checksum,
            settings: settings,
            explanationLanguage: explanationLanguage
        )

        selectionTranslation = selectionLookupCache[translationKey] ?? ""
        selectionExplanation = selectionLookupCache[explanationKey] ?? ""
    }

    private func selectionLookupCacheKey(
        for selection: ReaderTextSelection,
        action: SelectionLookupAction,
        paperChecksum: String,
        settings: AppSettings,
        explanationLanguage: ReaderLanguage
    ) -> String {
        Hashing.sha256(
            [
                paperChecksum,
                action.rawValue,
                settings.ollamaBaseURL,
                settings.quickLookupModel,
                settings.sourceLanguage.rawValue,
                settings.targetLanguage.rawValue,
                explanationLanguage.rawValue,
                SelectionTranslationPolicy.cacheVersion,
                selection.identity,
                selection.context
            ].joined(separator: "|")
        )
    }

    private func selectionContext(
        _ context: String,
        around selection: String,
        maximumLength: Int
    ) -> String {
        let nsContext = context as NSString
        let limit = max(maximumLength, (selection as NSString).length)
        guard nsContext.length > limit else { return context }

        let selectedRange = nsContext.range(of: selection)
        guard selectedRange.location != NSNotFound else {
            return nsContext.substring(to: min(nsContext.length, limit))
        }

        let availableContext = max(0, limit - selectedRange.length)
        let leadingContext = availableContext / 2
        let start = max(0, selectedRange.location - leadingContext)
        let end = min(nsContext.length, start + limit)
        return nsContext.substring(with: NSRange(location: start, length: end - start))
    }

    private func annotationIndex(for selection: ReaderTextSelection) -> Int? {
        annotations.firstIndex {
            $0.resolvedScope == selection.scope &&
                $0.paragraphID == selection.paragraphID &&
                $0.side == selection.side &&
                $0.locator == selection.locator &&
                $0.rangeLocation == selection.rangeLocation &&
                $0.rangeLength == selection.rangeLength &&
                $0.quote == selection.text
        }
    }
}
