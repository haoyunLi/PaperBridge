import SwiftUI
import UniformTypeIdentifiers
import AppKit

struct ContentView: View {
    @ObservedObject var viewModel: PaperReaderViewModel
    @State private var isDropTargeted = false
    @State private var isPasteTextExpanded = false
    @FocusState private var isManualInputFocused: Bool

    var body: some View {
        HSplitView {
            sidebar
                .frame(minWidth: 310, idealWidth: 350, maxWidth: 410)

            detail
                .frame(minWidth: 520, maxWidth: .infinity, maxHeight: .infinity)
        }
        .fileImporter(
            isPresented: $viewModel.isImporterPresented,
            allowedContentTypes: [.pdf],
            allowsMultipleSelection: false,
            onCompletion: viewModel.handleFileImport
        )
        .fileExporter(
            isPresented: $viewModel.isExporterPresented,
            document: viewModel.exportDocument,
            contentType: .markdownText,
            defaultFilename: viewModel.defaultExportFilename,
            onCompletion: viewModel.handleExportCompletion
        )
        .sheet(
            isPresented: $viewModel.isParagraphEditorPresented,
            onDismiss: viewModel.cancelParagraphEdit
        ) {
            ParagraphEditorSheet(
                paragraphID: viewModel.editingParagraphID,
                text: $viewModel.paragraphEditorText,
                onCancel: viewModel.cancelParagraphEdit,
                onSave: viewModel.saveParagraphEdit
            )
        }
        .alert("PaperBridge", isPresented: errorBinding) {
            Button("OK", role: .cancel) {
                viewModel.clearError()
            }
        } message: {
            Text(viewModel.errorMessage ?? "")
        }
        .task {
            if !viewModel.hasAvailableModels {
                viewModel.refreshAvailableModels()
            }
        }
        .onChange(of: viewModel.settings.ollamaBaseURL) { _, _ in
            viewModel.scheduleModelRefresh()
        }
    }

    private var sidebar: some View {
        ScrollView(.vertical) {
            VStack(alignment: .leading, spacing: 14) {
                HStack(alignment: .center, spacing: 12) {
                    appIconBadge(size: 54)

                    VStack(alignment: .leading, spacing: 4) {
                        Text("PaperBridge")
                            .font(.system(size: 25, weight: .bold, design: .rounded))

                        Text("Read and translate papers locally.")
                            .font(.callout)
                            .foregroundStyle(.secondary)

                        Label("Private on-device workflow", systemImage: "lock.fill")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(PaperBridgeTheme.blue)
                    }
                }

                SidebarCard(title: "Document", icon: "doc.richtext") {
                    Button {
                        viewModel.showImporter()
                    } label: {
                        Label("Open PDF", systemImage: "plus.circle.fill")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)

                    Text("You can also drag a PDF directly onto the main reading area.")
                        .font(.caption)
                        .foregroundStyle(.secondary)

                    Divider()

                    DisclosureGroup(isExpanded: $isPasteTextExpanded) {
                        VStack(alignment: .leading, spacing: 8) {
                            ZStack(alignment: .topLeading) {
                                RoundedRectangle(cornerRadius: 14, style: .continuous)
                                    .fill(Color(nsColor: .textBackgroundColor))
                                    .overlay(
                                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                                            .stroke(Color.primary.opacity(0.08), lineWidth: 1)
                                    )

                                TextEditor(text: manualInputBinding)
                                    .focused($isManualInputFocused)
                                    .font(.system(.body, design: .default))
                                    .scrollContentBackground(.hidden)
                                    .padding(8)

                                if viewModel.manualInputText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                                    Text("Paste an abstract, a section, or a full paper here.")
                                        .font(.callout)
                                        .foregroundStyle(.tertiary)
                                        .padding(.horizontal, 14)
                                        .padding(.vertical, 16)
                                        .allowsHitTesting(false)
                                }
                            }
                            .frame(height: 116)

                            HStack(spacing: 10) {
                                Button {
                                    viewModel.loadTextInput()
                                } label: {
                                    Label("Load Text", systemImage: "text.badge.plus")
                                        .frame(maxWidth: .infinity)
                                }
                                .buttonStyle(.bordered)
                                .disabled(!viewModel.canLoadInputText)

                                Button("Clear") {
                                    viewModel.manualInputText = ""
                                }
                                .buttonStyle(.borderless)
                                .disabled(viewModel.manualInputText.isEmpty || viewModel.isBusy)
                            }

                            Text("Pasted text uses the same translation, summary, explanation, and Markdown export flow as PDFs.")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .padding(.top, 8)
                    } label: {
                        Label("Paste Text Instead", systemImage: "text.badge.plus")
                            .font(.subheadline.weight(.semibold))
                    }

                    if let paper = viewModel.loadedPaper {
                        Divider()

                        statRow(label: paper.name.hasSuffix(".pdf") ? "File" : "Source", value: paper.name)
                        statRow(label: "Paragraphs", value: "\(paper.paragraphs.count)")
                        statRow(label: "Characters", value: "\(paper.cleanedText.count)")
                        if paper.excludedReferenceCount > 0 {
                            statRow(label: "Skipped refs", value: "\(paper.excludedReferenceCount)")
                        }
                    }
                }

                SidebarCard(title: "Translation", icon: "character.book.closed") {
                    VStack(alignment: .leading, spacing: 12) {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Translation direction")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(.secondary)

                            HStack(alignment: .center, spacing: 8) {
                                languagePicker(
                                    "From",
                                    selection: settingBinding(\.sourceLanguage)
                                )

                                Button {
                                    viewModel.swapTranslationLanguages()
                                } label: {
                                    Image(systemName: "arrow.left.arrow.right")
                                        .frame(width: 28, height: 28)
                                }
                                .buttonStyle(.bordered)
                                .help("Swap source and target languages")

                                languagePicker(
                                    "To",
                                    selection: settingBinding(\.targetLanguage)
                                )
                            }
                        }

                        HStack(alignment: .center, spacing: 10) {
                            OllamaStatusBadge(
                                isRefreshing: viewModel.isRefreshingModels,
                                isAvailable: viewModel.hasAvailableModels
                            )

                            Spacer()

                            Button("Refresh Models") {
                                viewModel.refreshAvailableModels()
                            }
                            .buttonStyle(.bordered)
                            .controlSize(.small)
                        }

                        if let modelRefreshError = viewModel.modelRefreshError {
                            HStack(alignment: .top, spacing: 8) {
                                Image(systemName: "exclamationmark.triangle.fill")
                                    .foregroundStyle(.orange)

                                Text(modelRefreshError)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                            .padding(10)
                            .background(Color.orange.opacity(0.08), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                        }

                        if viewModel.availableModels.isEmpty && viewModel.modelRefreshError == nil {
                            Text("No Ollama models detected yet. Start Ollama and refresh the model list.")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .fixedSize(horizontal: false, vertical: true)
                        } else {
                            labeledPicker(
                                "Translation model",
                                selection: settingBinding(\.translationModel),
                                options: viewModel.availableModels
                            )
                            labeledPicker(
                                "Summary model",
                                selection: settingBinding(\.summaryModel),
                                options: viewModel.availableModels
                            )
                            labeledPicker(
                                "Explanation model",
                                selection: settingBinding(\.explainModel),
                                options: viewModel.availableModels
                            )
                        }

                        DisclosureGroup("Advanced") {
                            VStack(alignment: .leading, spacing: 12) {
                                labeledField("Ollama server", text: settingBinding(\.ollamaBaseURL))

                                VStack(alignment: .leading, spacing: 6) {
                                    Text("Maximum translation chunk")
                                        .font(.caption.weight(.semibold))
                                        .foregroundStyle(.secondary)

                                    Stepper(
                                        value: settingBinding(\.maxParagraphChars),
                                        in: 500...6000,
                                        step: 100
                                    ) {
                                        Text("\(viewModel.settings.maxParagraphChars) characters")
                                            .font(.body.monospacedDigit())
                                    }
                                }
                            }
                            .padding(.top, 10)
                        }
                    }
                    .disabled(viewModel.isBusy)
                }

                if !viewModel.paragraphResults.isEmpty {
                    SidebarCard(title: "Explanation", icon: "bubble.left.and.bubble.right") {
                        Picker("Selected paragraph", selection: selectedParagraphBinding) {
                            ForEach(viewModel.paragraphResults) { paragraph in
                                Text("Paragraph \(paragraph.id): \(paragraph.previewText)")
                                    .tag(paragraph.id)
                            }
                        }
                        .labelsHidden()

                        Picker("Language", selection: explanationLanguageBinding) {
                            ForEach(ReaderLanguage.allCases) { language in
                                Text(language.displayName).tag(language)
                            }
                        }
                        .pickerStyle(.menu)

                        if let selectedParagraph = viewModel.selectedParagraph {
                            Text(selectedParagraph.previewText)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .fixedSize(horizontal: false, vertical: true)
                        }

                        Button {
                            viewModel.explainSelectedParagraph()
                        } label: {
                            Label("Explain Selection", systemImage: "sparkles")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.bordered)
                        .disabled(!viewModel.canExplain)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .topLeading)
            .padding(18)
        }
        .scrollIndicators(.visible)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Color(nsColor: .windowBackgroundColor))
    }

    private var detail: some View {
        ZStack {
            PaperBridgeBackground()

            if viewModel.loadedPaper == nil {
                emptyState
            } else {
                detailContent
            }
        }
        .dropDestination(for: URL.self) { items, _ in
            viewModel.handleDroppedFiles(items)
        } isTargeted: { isTargeted in
            self.isDropTargeted = isTargeted
        }
        .overlay {
            RoundedRectangle(cornerRadius: 28)
                .fill(isDropTargeted ? PaperBridgeTheme.blue.opacity(0.06) : Color.clear)
                .overlay(
                    RoundedRectangle(cornerRadius: 28)
                        .strokeBorder(isDropTargeted ? PaperBridgeTheme.blue : Color.clear, style: StrokeStyle(lineWidth: 3, dash: [10, 8]))
                )
                .padding(18)
                .animation(.easeInOut(duration: 0.18), value: isDropTargeted)
        }
        .overlay(alignment: .top) {
            if isDropTargeted {
                Label("Drop PDF to open", systemImage: "arrow.down.doc.fill")
                    .font(.headline)
                    .padding(.horizontal, 18)
                    .padding(.vertical, 10)
                    .background(.regularMaterial, in: Capsule())
                    .padding(.top, 28)
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .animation(.easeInOut(duration: 0.18), value: isDropTargeted)
    }

    private var emptyState: some View {
        VStack(spacing: 22) {
            appIconBadge(size: 116)

            VStack(spacing: 9) {
                Text("LOCAL ACADEMIC READER")
                    .font(.caption.weight(.bold))
                    .tracking(1.6)
                    .foregroundStyle(PaperBridgeTheme.blue)

                Text("Bring a paper into focus.")
                    .font(.system(size: 36, weight: .bold, design: .rounded))

                Text("Open a PDF or paste text to reconstruct natural paragraphs, translate with Ollama, and read the source beside its translation.")
                    .font(.title3)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: 560)
            }

            Button {
                viewModel.showImporter()
            } label: {
                Label("Open Academic PDF", systemImage: "doc.badge.plus")
                    .padding(.horizontal, 8)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)

            Label("You can also drag a PDF anywhere onto this area", systemImage: "arrow.down.to.line.compact")
                .font(.callout)
                .foregroundStyle(.secondary)
        }
        .padding(.horizontal, 56)
        .padding(.vertical, 48)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 32, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 32, style: .continuous)
                .strokeBorder(Color.primary.opacity(0.08))
        )
        .shadow(color: .black.opacity(0.07), radius: 28, y: 16)
        .padding(40)
    }

    private var detailContent: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 18) {
                headerPanel

                if viewModel.isBusy || !viewModel.statusMessage.isEmpty {
                    SurfaceCard {
                        VStack(alignment: .leading, spacing: 14) {
                            HStack(alignment: .center) {
                                Text(viewModel.statusMessage)
                                    .font(.headline)
                                    .frame(maxWidth: .infinity, alignment: .leading)

                                if viewModel.isBusy {
                                    ProgressView()
                                        .controlSize(.small)
                                }
                            }

                            ProgressView(value: viewModel.progressValue)
                                .tint(Color.accentColor)
                        }
                    }
                }

                if let summaries = viewModel.summaries {
                    summaryPanel(summaries: summaries)
                }

                if let connectedTranslation = viewModel.connectedTranslation,
                   !connectedTranslation.text.isEmpty {
                    connectedTranslationPanel(result: connectedTranslation)
                }

                if !viewModel.explanationText.isEmpty {
                    explanationPanel
                }

                VStack(alignment: .leading, spacing: 16) {
                    HStack(alignment: .center, spacing: 12) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Paper Reader")
                                .font(.title2.weight(.bold))

                            Text("Review extraction before translating. Use each paragraph's menu to repair PDF layout mistakes.")
                                .font(.callout)
                                .foregroundStyle(.secondary)
                        }

                        Spacer()

                        Button {
                            viewModel.undoParagraphEdit()
                        } label: {
                            Label("Undo Paragraph Edit", systemImage: "arrow.uturn.backward")
                        }
                        .buttonStyle(.bordered)
                        .disabled(!viewModel.canUndoParagraphEdit || viewModel.isBusy)
                    }

                    HStack(spacing: 12) {
                        Picker("Display", selection: $viewModel.displayMode) {
                            ForEach(ReaderDisplayMode.allCases) { mode in
                                Text(mode.displayName).tag(mode)
                            }
                        }
                        .pickerStyle(.segmented)
                        .frame(maxWidth: 390)

                        TextField("Search original or translation", text: $viewModel.paragraphSearchText)
                            .textFieldStyle(.roundedBorder)

                        if !viewModel.paragraphSearchText.isEmpty {
                            Button {
                                viewModel.paragraphSearchText = ""
                            } label: {
                                Image(systemName: "xmark.circle.fill")
                            }
                            .buttonStyle(.borderless)
                            .help("Clear search")
                        }
                    }

                    if viewModel.visibleParagraphResults.isEmpty {
                        ContentUnavailableView(
                            "No Matching Paragraphs",
                            systemImage: "text.magnifyingglass",
                            description: Text("Try a different search term.")
                        )
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 40)
                    } else {
                        LazyVStack(alignment: .leading, spacing: 16) {
                            ForEach(viewModel.visibleParagraphResults) { paragraph in
                                paragraphCard(paragraph)
                            }
                        }
                    }
                }
            }
            .padding(26)
            .frame(maxWidth: 1080, alignment: .topLeading)
        }
        .scrollIndicators(.visible)
    }

    private var headerPanel: some View {
        SurfaceCard {
            VStack(alignment: .leading, spacing: 16) {
                HStack(alignment: .top, spacing: 20) {
                    HStack(alignment: .top, spacing: 14) {
                        appIconBadge(size: 56)

                        VStack(alignment: .leading, spacing: 6) {
                            Text(viewModel.loadedPaper?.name ?? "Untitled PDF")
                                .font(.system(size: 28, weight: .bold, design: .rounded))

                            Text("Original \(viewModel.settings.sourceLanguage.displayName) followed by \(viewModel.settings.targetLanguage.displayName), with local Ollama processing and session-level caching.")
                                .foregroundStyle(.secondary)
                        }
                    }

                    Spacer()

                    OllamaStatusBadge(
                        isRefreshing: viewModel.isRefreshingModels,
                        isAvailable: viewModel.hasAvailableModels
                    )
                }

                HStack(spacing: 10) {
                    MetricPill(title: "Paragraphs", value: "\(viewModel.paragraphResults.count)")
                    MetricPill(title: "Translated", value: "\(viewModel.translatedCount)")
                    MetricPill(title: "Failed", value: "\(viewModel.failedCount)")
                    if let loadedPaper = viewModel.loadedPaper, loadedPaper.excludedReferenceCount > 0 {
                        MetricPill(title: "Skipped Refs", value: "\(loadedPaper.excludedReferenceCount)")
                    }
                }

                Divider()

                documentActions
            }
        }
    }

    private var documentActions: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 10) {
                documentActionButtons
            }

            VStack(alignment: .leading, spacing: 10) {
                documentActionButtons
            }
        }
    }

    @ViewBuilder
    private var documentActionButtons: some View {
        Button {
            viewModel.translatePaper()
        } label: {
            Label("Translate Paper", systemImage: "character.book.closed.fill")
        }
        .buttonStyle(.borderedProminent)
        .disabled(!viewModel.canTranslate)

        Button {
            viewModel.generateSummaries()
        } label: {
            Label("Summary", systemImage: "text.alignleft")
        }
        .buttonStyle(.bordered)
        .disabled(!viewModel.canSummarize)

        Button {
            viewModel.generateConnectedTranslation()
        } label: {
            Label("Connected Translation", systemImage: "text.append")
        }
        .buttonStyle(.bordered)
        .disabled(!viewModel.canGenerateConnectedTranslation)
        .help("Optional second pass for a smoother full-paper translation")

        Button {
            viewModel.prepareMarkdownExport()
        } label: {
            Label("Export", systemImage: "square.and.arrow.down")
        }
        .buttonStyle(.bordered)
        .disabled(!viewModel.canExport)

        if viewModel.isBusy {
            Button(role: .cancel) {
                viewModel.cancelCurrentTask()
            } label: {
                Label("Cancel", systemImage: "xmark.circle")
            }
            .buttonStyle(.borderless)
        }
    }

    private func summaryPanel(summaries: SummaryResult) -> some View {
        SurfaceCard {
            VStack(alignment: .leading, spacing: 14) {
                Label("Whole-paper Summary", systemImage: "text.book.closed.fill")
                    .font(.title3.weight(.semibold))

                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .top, spacing: 16) {
                        textPanel(title: "\(summaries.sourceLanguage.displayName) Summary", body: summaries.sourceSummary)
                        textPanel(title: "\(summaries.targetLanguage.displayName) Summary", body: summaries.targetSummary)
                    }

                    VStack(alignment: .leading, spacing: 16) {
                        textPanel(title: "\(summaries.sourceLanguage.displayName) Summary", body: summaries.sourceSummary)
                        textPanel(title: "\(summaries.targetLanguage.displayName) Summary", body: summaries.targetSummary)
                    }
                }
            }
        }
    }

    private func connectedTranslationPanel(result: ConnectedTranslationResult) -> some View {
        SurfaceCard {
            VStack(alignment: .leading, spacing: 14) {
                HStack(alignment: .firstTextBaseline) {
                    Label("Connected Full Translation", systemImage: "text.append")
                        .font(.title3.weight(.semibold))

                    Spacer()

                    Text(result.targetLanguage.displayName)
                        .foregroundStyle(.secondary)
                }

                if result.failedBatchCount > 0 {
                    Text("\(result.failedBatchCount) batch\(result.failedBatchCount == 1 ? "" : "es") failed and were marked inline.")
                        .font(.caption)
                        .foregroundStyle(.orange)
                }

                textPanel(title: result.targetLanguage.displayName, body: result.text)
            }
        }
    }

    private var explanationPanel: some View {
        SurfaceCard {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Label("Selected Paragraph Explanation", systemImage: "lightbulb.max.fill")
                        .font(.title3.weight(.semibold))
                    Spacer()
                    if let selectedID = viewModel.selectedParagraphID {
                        Text("Paragraph \(selectedID)")
                            .foregroundStyle(.secondary)
                    }
                }

                textPanel(title: viewModel.explanationLanguage.displayName, body: viewModel.explanationText)
            }
        }
    }

    private func paragraphCard(_ paragraph: ParagraphResult) -> some View {
        let isFirst = paragraph.id == viewModel.paragraphResults.first?.id
        let isLast = paragraph.id == viewModel.paragraphResults.last?.id

        return SurfaceCard(
            isHighlighted: paragraph.id == viewModel.selectedParagraphID,
            accent: paragraph.status == .failed ? .red.opacity(0.7) : PaperBridgeTheme.blue.opacity(0.75),
            contentPadding: 18
        ) {
            VStack(alignment: .leading, spacing: 15) {
                HStack(alignment: .center, spacing: 10) {
                    Text("\(paragraph.id)")
                        .font(.headline.monospacedDigit())
                        .foregroundStyle(PaperBridgeTheme.blue)
                        .frame(width: 34, height: 34)
                        .background(PaperBridgeTheme.blue.opacity(0.10), in: RoundedRectangle(cornerRadius: 10, style: .continuous))

                    statusBadge(for: paragraph)

                    if paragraph.chunkCount > 1 {
                        Text("\(paragraph.chunkCount) chunks")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    Spacer()

                    if paragraph.status == .failed {
                        Button {
                            viewModel.retryTranslation(for: paragraph.id)
                        } label: {
                            Label("Retry", systemImage: "arrow.clockwise")
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                        .disabled(viewModel.isBusy)
                    }

                    Menu {
                        Button {
                            viewModel.beginEditingParagraph(paragraph.id)
                        } label: {
                            Label("Edit or Split...", systemImage: "pencil")
                        }

                        Divider()

                        Button {
                            viewModel.mergeParagraphWithPrevious(paragraph.id)
                        } label: {
                            Label("Merge with Previous", systemImage: "arrow.up.to.line")
                        }
                        .disabled(isFirst)

                        Button {
                            viewModel.mergeParagraphWithNext(paragraph.id)
                        } label: {
                            Label("Merge with Next", systemImage: "arrow.down.to.line")
                        }
                        .disabled(isLast)

                        Button {
                            viewModel.reflowParagraph(paragraph.id)
                        } label: {
                            Label("Reflow at Full Sentences", systemImage: "text.insert")
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                    .menuStyle(.borderlessButton)
                    .fixedSize()
                    .disabled(viewModel.isBusy)
                    .help("Paragraph repair tools")

                    Button {
                        viewModel.selectedParagraphID = paragraph.id
                    } label: {
                        Image(systemName: paragraph.id == viewModel.selectedParagraphID ? "checkmark.circle.fill" : "circle")
                            .foregroundStyle(paragraph.id == viewModel.selectedParagraphID ? PaperBridgeTheme.blue : Color.secondary)
                    }
                    .buttonStyle(.borderless)
                    .help(paragraph.id == viewModel.selectedParagraphID ? "Selected for explanation" : "Select for explanation")
                }

                if viewModel.displayMode != .translationOnly {
                    VStack(alignment: .leading, spacing: 8) {
                        languageLabel(
                            title: "ORIGINAL",
                            language: viewModel.settings.sourceLanguage,
                            color: PaperBridgeTheme.blue
                        )
                        SelectableText(
                            text: paragraph.original,
                            font: .system(size: 16, weight: .regular, design: .serif),
                            lineSpacing: 5
                        )
                    }
                }

                if viewModel.displayMode == .bilingual {
                    Rectangle()
                        .fill(Color.primary.opacity(0.08))
                        .frame(height: 1)
                }

                if viewModel.displayMode != .sourceOnly {
                    VStack(alignment: .leading, spacing: 8) {
                        languageLabel(
                            title: "TRANSLATION",
                            language: viewModel.settings.targetLanguage,
                            color: PaperBridgeTheme.coral
                        )

                        if paragraph.status == .ok {
                            SelectableText(
                                text: paragraph.translation,
                                font: .system(size: 16, weight: .regular, design: .serif),
                                lineSpacing: 5
                            )
                        } else if paragraph.status == .failed {
                            Text("Translation failed for this paragraph.")
                                .foregroundStyle(.red)
                                .fontWeight(.semibold)

                            if let errorMessage = paragraph.errorMessage {
                                SelectableText(text: errorMessage, foregroundStyle: .secondary)
                            }
                        } else {
                            Text("Translation has not started for this paragraph yet.")
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
        .onTapGesture {
            viewModel.selectedParagraphID = paragraph.id
        }
    }

    private func languageLabel(title: String, language: ReaderLanguage, color: Color) -> some View {
        HStack(spacing: 8) {
            Text(title)
                .font(.caption2.weight(.bold))
                .tracking(0.9)
                .foregroundStyle(color)

            Text(language.displayName)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private func languagePicker(_ label: String, selection: Binding<ReaderLanguage>) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)

            Picker(label, selection: selection) {
                ForEach(ReaderLanguage.allCases) { language in
                    Text(language.displayName).tag(language)
                }
            }
            .pickerStyle(.menu)
            .labelsHidden()
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func labeledField(_ label: String, text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)

            TextField(label, text: text)
                .textFieldStyle(.roundedBorder)
                .font(.system(.body, design: .monospaced))
        }
    }

    private func labeledPicker(_ label: String, selection: Binding<String>, options: [String]) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)

            Picker(label, selection: selection) {
                ForEach(options, id: \.self) { model in
                    Text(model).tag(model)
                }
            }
            .pickerStyle(.menu)
            .labelsHidden()
        }
    }

    private func appIconBadge(size: CGFloat) -> some View {
        Image(nsImage: NSApplication.shared.applicationIconImage)
            .resizable()
            .interpolation(.high)
            .scaledToFit()
            .frame(width: size, height: size)
            .shadow(color: .black.opacity(0.12), radius: 12, y: 6)
            .accessibilityHidden(true)
    }

    private func textPanel(title: String, body: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.headline)

            SelectableText(text: body)
        }
        .frame(maxWidth: .infinity, alignment: .topLeading)
    }

    private func statusBadge(for paragraph: ParagraphResult) -> some View {
        let label: String
        let color: Color

        switch paragraph.status {
        case .ok:
            label = "Translated"
            color = .green
        case .failed:
            label = "Failed"
            color = .red
        case .pending:
            label = "Pending"
            color = .orange
        }

        return Text(label)
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(color.opacity(0.13), in: Capsule())
            .foregroundStyle(color)
    }

    private func statRow(label: String, value: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label)
                .foregroundStyle(.secondary)
            Spacer()
            Text(value)
                .multilineTextAlignment(.trailing)
                .fontWeight(.medium)
        }
    }

    private func settingBinding<Value>(_ keyPath: WritableKeyPath<AppSettings, Value>) -> Binding<Value> {
        Binding(
            get: { viewModel.settings[keyPath: keyPath] },
            set: { viewModel.settings[keyPath: keyPath] = $0 }
        )
    }

    private var manualInputBinding: Binding<String> {
        Binding(
            get: { viewModel.manualInputText },
            set: { viewModel.manualInputText = $0 }
        )
    }

    private var selectedParagraphBinding: Binding<Int> {
        Binding(
            get: { viewModel.selectedParagraphID ?? viewModel.paragraphResults.first?.id ?? 1 },
            set: { viewModel.selectedParagraphID = $0 }
        )
    }

    private var explanationLanguageBinding: Binding<ReaderLanguage> {
        Binding(
            get: { viewModel.explanationLanguage },
            set: { viewModel.explanationLanguage = $0 }
        )
    }

    private var errorBinding: Binding<Bool> {
        Binding(
            get: { viewModel.errorMessage != nil },
            set: { newValue in
                if !newValue {
                    viewModel.clearError()
                }
            }
        )
    }
}

private struct ParagraphEditorSheet: View {
    let paragraphID: Int?
    @Binding var text: String
    let onCancel: () -> Void
    let onSave: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(alignment: .top, spacing: 14) {
                Image(systemName: "text.badge.checkmark")
                    .font(.system(size: 28, weight: .semibold))
                    .foregroundStyle(.tint)
                    .frame(width: 48, height: 48)
                    .background(.tint.opacity(0.12), in: RoundedRectangle(cornerRadius: 14))

                VStack(alignment: .leading, spacing: 5) {
                    Text("Repair Paragraph \(paragraphID.map(String.init) ?? "")")
                        .font(.title2.weight(.bold))

                    Text("Fix extraction errors directly. Insert a blank line wherever this text should become a new paragraph.")
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            TextEditor(text: $text)
                .font(.system(size: 15, weight: .regular, design: .serif))
                .lineSpacing(5)
                .scrollContentBackground(.hidden)
                .padding(12)
                .background(
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .fill(Color(nsColor: .textBackgroundColor))
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .strokeBorder(Color.primary.opacity(0.10))
                )

            HStack {
                Text("\(text.count) characters. Changes invalidate only affected translation output.")
                    .font(.caption)
                    .foregroundStyle(.secondary)

                Spacer()

                Button("Cancel", action: onCancel)
                    .keyboardShortcut(.cancelAction)

                Button("Save", action: onSave)
                    .buttonStyle(.borderedProminent)
                    .keyboardShortcut(.defaultAction)
                    .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(24)
        .frame(minWidth: 700, minHeight: 500)
    }
}

private struct SidebarCard<Content: View>: View {
    let title: String
    let icon: String
    let content: Content

    init(title: String, icon: String, @ViewBuilder content: () -> Content) {
        self.title = title
        self.icon = icon
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label(title, systemImage: icon)
                .font(.headline)

            content
        }
        .padding(15)
        .background(
            RoundedRectangle(cornerRadius: 17, style: .continuous)
                .fill(Color(nsColor: .controlBackgroundColor).opacity(0.78))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 17, style: .continuous)
                .strokeBorder(Color.primary.opacity(0.07))
        )
    }
}

private struct SurfaceCard<Content: View>: View {
    var isHighlighted = false
    var accent: Color = .accentColor
    var contentPadding: CGFloat = 22
    let content: Content

    init(
        isHighlighted: Bool = false,
        accent: Color = .accentColor,
        contentPadding: CGFloat = 22,
        @ViewBuilder content: () -> Content
    ) {
        self.isHighlighted = isHighlighted
        self.accent = accent
        self.contentPadding = contentPadding
        self.content = content()
    }

    var body: some View {
        content
            .padding(contentPadding)
            .background(
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .fill(Color(nsColor: .controlBackgroundColor).opacity(0.94))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .strokeBorder(isHighlighted ? accent : Color.primary.opacity(0.08), lineWidth: isHighlighted ? 2 : 1)
            )
            .shadow(color: .black.opacity(0.045), radius: 14, y: 7)
    }
}

private struct MetricPill: View {
    let title: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(value)
                .font(.headline)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(Color.accentColor.opacity(0.10), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}

private struct SelectableText: View {
    let text: String
    var foregroundStyle: Color = .primary
    var font: Font = .body
    var lineSpacing: CGFloat = 3

    var body: some View {
        Text(text)
            .font(font)
            .lineSpacing(lineSpacing)
            .frame(maxWidth: .infinity, alignment: .leading)
            .textSelection(.enabled)
            .foregroundStyle(foregroundStyle)
            .fixedSize(horizontal: false, vertical: true)
    }
}

private enum PaperBridgeTheme {
    static let blue = Color(red: 0.04, green: 0.35, blue: 0.84)
    static let coral = Color(red: 0.91, green: 0.22, blue: 0.20)
    static let amber = Color(red: 0.94, green: 0.58, blue: 0.16)
}

private struct PaperBridgeBackground: View {
    var body: some View {
        ZStack {
            Color(nsColor: .underPageBackgroundColor)

            LinearGradient(
                colors: [
                    PaperBridgeTheme.blue.opacity(0.09),
                    Color.clear,
                    PaperBridgeTheme.coral.opacity(0.055)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )

            RadialGradient(
                colors: [PaperBridgeTheme.amber.opacity(0.08), .clear],
                center: .topTrailing,
                startRadius: 10,
                endRadius: 520
            )
        }
        .ignoresSafeArea()
    }
}

private struct OllamaStatusBadge: View {
    let isRefreshing: Bool
    let isAvailable: Bool

    private var color: Color {
        if isRefreshing { return PaperBridgeTheme.amber }
        return isAvailable ? .green : .orange
    }

    private var label: String {
        if isRefreshing { return "Checking Ollama" }
        return isAvailable ? "Ollama Ready" : "Ollama Offline"
    }

    var body: some View {
        HStack(spacing: 7) {
            if isRefreshing {
                ProgressView()
                    .controlSize(.mini)
            } else {
                Circle()
                    .fill(color)
                    .frame(width: 7, height: 7)
            }

            Text(label)
                .font(.caption.weight(.semibold))
        }
        .foregroundStyle(color)
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(color.opacity(0.10), in: Capsule())
    }
}
