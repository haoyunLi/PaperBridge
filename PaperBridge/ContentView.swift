import SwiftUI
import UniformTypeIdentifiers
import AppKit

struct ContentView: View {
    @ObservedObject var viewModel: PaperReaderViewModel
    @State private var isDropTargeted = false

    var body: some View {
        NavigationSplitView {
            sidebar
                .navigationSplitViewColumnWidth(min: 320, ideal: 350)
        } detail: {
            detail
        }
        .navigationSplitViewStyle(.balanced)
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
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                VStack(alignment: .leading, spacing: 8) {
                    HStack(alignment: .top, spacing: 14) {
                        appIconBadge(size: 64)

                        VStack(alignment: .leading, spacing: 8) {
                            Text("PaperBridge")
                                .font(.system(size: 29, weight: .bold, design: .rounded))

                            Text("A native macOS paper reader with selectable translation languages. PDFKit handles extraction, and Ollama handles local translation, summary, and explanation.")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
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

                    VStack(alignment: .leading, spacing: 8) {
                        Text("Paste Text")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)

                        ZStack(alignment: .topLeading) {
                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                .fill(Color(nsColor: .textBackgroundColor))
                                .overlay(
                                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                                        .stroke(Color.primary.opacity(0.08), lineWidth: 1)
                                )

                            TextEditor(text: manualInputBinding)
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
                        .frame(minHeight: 150)

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

                SidebarCard(title: "Settings", icon: "slider.horizontal.3") {
                    VStack(alignment: .leading, spacing: 12) {
                        labeledField("OLLAMA_BASE_URL", text: settingBinding(\.ollamaBaseURL))

                        VStack(alignment: .leading, spacing: 8) {
                            Text("TRANSLATION_DIRECTION")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(.secondary)

                            HStack(alignment: .center, spacing: 8) {
                                languagePicker(
                                    "FROM",
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
                                    "TO",
                                    selection: settingBinding(\.targetLanguage)
                                )
                            }
                        }

                        HStack(alignment: .center, spacing: 10) {
                            Text(viewModel.isRefreshingModels ? "Refreshing Ollama models..." : "Detected local Ollama models")
                                .font(.caption)
                                .foregroundStyle(.secondary)

                            Spacer()

                            Button("Refresh Models") {
                                viewModel.refreshAvailableModels()
                            }
                            .buttonStyle(.bordered)
                            .controlSize(.small)
                        }

                        if let modelRefreshError = viewModel.modelRefreshError {
                            Text(modelRefreshError)
                                .font(.caption)
                                .foregroundStyle(.red)
                                .fixedSize(horizontal: false, vertical: true)
                        }

                        if viewModel.availableModels.isEmpty {
                            Text("No Ollama models detected yet. Start Ollama and refresh the model list.")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .fixedSize(horizontal: false, vertical: true)
                        } else {
                            labeledPicker(
                                "TRANSLATION_MODEL",
                                selection: settingBinding(\.translationModel),
                                options: viewModel.availableModels
                            )
                            labeledPicker(
                                "SUMMARY_MODEL",
                                selection: settingBinding(\.summaryModel),
                                options: viewModel.availableModels
                            )
                            labeledPicker(
                                "EXPLAIN_MODEL",
                                selection: settingBinding(\.explainModel),
                                options: viewModel.availableModels
                            )
                        }

                        VStack(alignment: .leading, spacing: 8) {
                            Text("MAX_PARAGRAPH_CHARS")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(.secondary)

                            Stepper(value: settingBinding(\.maxParagraphChars), in: 500...6000, step: 100) {
                                Text("\(viewModel.settings.maxParagraphChars)")
                                    .font(.body.monospacedDigit())
                            }
                        }
                    }
                }

                SidebarCard(title: "Actions", icon: "bolt.fill") {
                    VStack(alignment: .leading, spacing: 10) {
                        Button {
                            viewModel.translatePaper()
                        } label: {
                            Label("Translate Paper", systemImage: "globe.asia.australia.fill")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(!viewModel.canTranslate)

                        Button {
                            viewModel.generateSummaries()
                        } label: {
                            Label("Generate Summary", systemImage: "text.alignleft")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.bordered)
                        .disabled(!viewModel.canSummarize)

                        Button {
                            viewModel.explainSelectedParagraph()
                        } label: {
                            Label("Explain Selected Paragraph", systemImage: "sparkles")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.bordered)
                        .disabled(!viewModel.canExplain)

                        Button {
                            viewModel.prepareMarkdownExport()
                        } label: {
                            Label("Export Markdown", systemImage: "square.and.arrow.down")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.bordered)
                        .disabled(!viewModel.canExport)

                        if viewModel.isBusy {
                            Button(role: .cancel) {
                                viewModel.cancelCurrentTask()
                            } label: {
                                Label("Cancel Current Task", systemImage: "xmark.circle")
                                    .frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.borderless)
                        }
                    }
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
                    }
                }
            }
            .padding(22)
        }
        .background(.thinMaterial)
    }

    private var detail: some View {
        ZStack {
            LinearGradient(
                colors: [
                    Color(nsColor: .windowBackgroundColor),
                    Color.accentColor.opacity(0.10),
                    Color(nsColor: .underPageBackgroundColor)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()

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
                .strokeBorder(isDropTargeted ? Color.accentColor : Color.clear, style: StrokeStyle(lineWidth: 3, dash: [10, 8]))
                .padding(18)
                .animation(.easeInOut(duration: 0.18), value: isDropTargeted)
        }
    }

    private var emptyState: some View {
        ContentUnavailableView {
            VStack(spacing: 14) {
                appIconBadge(size: 88)
                Label("Add a Paper to Begin", systemImage: "doc.on.doc.fill")
            }
        } description: {
            Text("Import an academic paper PDF, or paste text in the sidebar. Translation, summary, explanation, and export stay local and call Ollama on your Mac.")
        } actions: {
            Button("Open PDF") {
                viewModel.showImporter()
            }
            .buttonStyle(.borderedProminent)
        }
        .padding(48)
    }

    private var detailContent: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
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
                    Text("Aligned Translation View")
                        .font(.title2.weight(.bold))

                    ForEach(viewModel.paragraphResults) { paragraph in
                        paragraphCard(paragraph)
                    }
                }
            }
            .padding(24)
            .frame(maxWidth: 1180, alignment: .topLeading)
        }
        .scrollIndicators(.visible)
    }

    private var headerPanel: some View {
        SurfaceCard {
            VStack(alignment: .leading, spacing: 16) {
                HStack(alignment: .top) {
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
                }

                HStack(spacing: 10) {
                    MetricPill(title: "Paragraphs", value: "\(viewModel.paragraphResults.count)")
                    MetricPill(title: "Translated", value: "\(viewModel.translatedCount)")
                    MetricPill(title: "Failed", value: "\(viewModel.failedCount)")
                    if let loadedPaper = viewModel.loadedPaper, loadedPaper.excludedReferenceCount > 0 {
                        MetricPill(title: "Skipped Refs", value: "\(loadedPaper.excludedReferenceCount)")
                    }
                    MetricPill(title: "Local", value: "Ollama")
                }
            }
        }
    }

    private func summaryPanel(summaries: SummaryResult) -> some View {
        SurfaceCard {
            VStack(alignment: .leading, spacing: 14) {
                Label("Whole-paper Summary", systemImage: "text.book.closed.fill")
                    .font(.title3.weight(.semibold))

                HStack(alignment: .top, spacing: 16) {
                    textPanel(title: "\(summaries.sourceLanguage.displayName) Summary", body: summaries.sourceSummary)
                    textPanel(title: "\(summaries.targetLanguage.displayName) Summary", body: summaries.targetSummary)
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
        SurfaceCard(
            isHighlighted: paragraph.id == viewModel.selectedParagraphID,
            accent: paragraph.status == .failed ? .red.opacity(0.6) : .accentColor.opacity(0.6)
        ) {
            VStack(alignment: .leading, spacing: 16) {
                HStack(alignment: .top, spacing: 12) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Paragraph \(paragraph.id)")
                            .font(.title3.weight(.semibold))

                        HStack(spacing: 8) {
                            statusBadge(for: paragraph)

                            if paragraph.chunkCount > 0 {
                                Text("\(paragraph.chunkCount) chunk\(paragraph.chunkCount == 1 ? "" : "s")")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }

                    Spacer()

                    Button(paragraph.id == viewModel.selectedParagraphID ? "Selected" : "Select") {
                        viewModel.selectedParagraphID = paragraph.id
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                }

                VStack(alignment: .leading, spacing: 8) {
                    Text("Original \(viewModel.settings.sourceLanguage.displayName)")
                        .font(.headline)
                    SelectableText(text: paragraph.original)
                }

                Divider()

                VStack(alignment: .leading, spacing: 8) {
                    Text("Translation (\(viewModel.settings.targetLanguage.displayName))")
                        .font(.headline)

                    if paragraph.status == .ok {
                        SelectableText(text: paragraph.translation)
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
        .onTapGesture {
            viewModel.selectedParagraphID = paragraph.id
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
        }
    }

    private func appIconBadge(size: CGFloat) -> some View {
        Image(nsImage: NSWorkspace.shared.icon(forFile: Bundle.main.bundlePath))
            .resizable()
            .interpolation(.high)
            .scaledToFit()
            .frame(width: size, height: size)
            .clipShape(RoundedRectangle(cornerRadius: size * 0.22, style: .continuous))
            .shadow(color: .black.opacity(0.12), radius: 12, y: 6)
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
        VStack(alignment: .leading, spacing: 14) {
            Label(title, systemImage: icon)
                .font(.headline)

            content
        }
        .padding(18)
        .background(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .fill(.regularMaterial)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .strokeBorder(Color.white.opacity(0.28))
        )
    }
}

private struct SurfaceCard<Content: View>: View {
    var isHighlighted = false
    var accent: Color = .accentColor
    let content: Content

    init(
        isHighlighted: Bool = false,
        accent: Color = .accentColor,
        @ViewBuilder content: () -> Content
    ) {
        self.isHighlighted = isHighlighted
        self.accent = accent
        self.content = content()
    }

    var body: some View {
        content
            .padding(22)
            .background(
                RoundedRectangle(cornerRadius: 24, style: .continuous)
                    .fill(.ultraThinMaterial)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 24, style: .continuous)
                    .strokeBorder(isHighlighted ? accent : Color.white.opacity(0.26), lineWidth: isHighlighted ? 2 : 1)
            )
            .shadow(color: .black.opacity(0.06), radius: 18, y: 10)
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

    var body: some View {
        Text(text)
            .frame(maxWidth: .infinity, alignment: .leading)
            .textSelection(.enabled)
            .foregroundStyle(foregroundStyle)
            .fixedSize(horizontal: false, vertical: true)
    }
}
