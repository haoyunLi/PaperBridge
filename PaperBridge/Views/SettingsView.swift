import SwiftUI

struct SettingsView: View {
    @ObservedObject var viewModel: PaperReaderViewModel
    @State private var isClearConfirmationPresented = false

    var body: some View {
        TabView {
            parsingTab
                .tabItem {
                    Label("Document Parsing", systemImage: "doc.richtext")
                }

            modelsTab
                .tabItem {
                    Label("Models", systemImage: "cpu")
                }

            readingTab
                .tabItem {
                    Label("Reading", systemImage: "text.book.closed")
                }

            dataTab
                .tabItem {
                    Label("Local Data", systemImage: "internaldrive")
                }
        }
        .frame(width: 660, height: 540)
        .padding(18)
        .tint(PaperBridgeTheme.accent)
        .task {
            if !viewModel.hasAvailableModels {
                viewModel.refreshAvailableModels()
            }
            viewModel.refreshMinerUStatus()
        }
        .alert(
            "Remove all saved PaperBridge data?",
            isPresented: $isClearConfirmationPresented
        ) {
            Button("Cancel", role: .cancel) {}
            Button("Remove Local Data", role: .destructive) {
                viewModel.clearSavedData()
            }
        } message: {
            Text("This removes saved papers, translations, summaries, highlights, notes, and settings from this Mac. Original PDF files are not changed.")
        }
    }

    private var parsingTab: some View {
        Form {
            Section("PDF Parsing") {
                HStack {
                    Label {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(viewModel.minerUStatus.isAvailable ? "MinerU ready" : "MinerU unavailable")
                                .fontWeight(.medium)
                            Text(viewModel.minerUStatus.message)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .textSelection(.enabled)
                        }
                    } icon: {
                        if viewModel.isRefreshingMinerU {
                            ProgressView()
                                .controlSize(.small)
                        } else {
                            Image(
                                systemName: viewModel.minerUStatus.isAvailable
                                    ? "checkmark.circle.fill"
                                    : "exclamationmark.triangle.fill"
                            )
                            .foregroundStyle(
                                viewModel.minerUStatus.isAvailable
                                    ? PaperBridgeTheme.accent
                                    : Color.orange
                            )
                        }
                    }

                    Spacer()
                    Button("Check Again") {
                        viewModel.refreshMinerUStatus()
                    }
                    .disabled(viewModel.isRefreshingMinerU)
                }

                Picker("PDF parser", selection: settingBinding(\.pdfExtractionMode)) {
                    ForEach(PDFExtractionMode.allCases) { mode in
                        Text(mode.displayName).tag(mode)
                    }
                }

                Text(viewModel.settings.pdfExtractionMode.detail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)

                Picker("MinerU backend", selection: settingBinding(\.minerUBackend)) {
                    ForEach(MinerUBackend.allCases) { backend in
                        Text(backend.displayName).tag(backend)
                    }
                }
                .disabled(viewModel.settings.pdfExtractionMode == .pdfKitOnly)

                Text(viewModel.settings.minerUBackend.detail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .disabled(viewModel.settings.pdfExtractionMode == .pdfKitOnly)

                TextField(
                    "MinerU executable (auto-detect when empty)",
                    text: settingBinding(\.minerUExecutablePath)
                )
                .font(.system(.body, design: .monospaced))
                .disabled(viewModel.settings.pdfExtractionMode == .pdfKitOnly)

                HStack {
                    Text("Common custom path: ~/.paperbridge-mineru/bin/mineru")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Spacer()
                    Button("Use Auto-Detect") {
                        viewModel.settings.minerUExecutablePath = ""
                        viewModel.refreshMinerUStatus()
                    }
                    .disabled(
                        viewModel.settings.minerUExecutablePath.isEmpty ||
                            viewModel.settings.pdfExtractionMode == .pdfKitOnly
                    )
                }
            }

            Section("PDFKit Facsimile (No OCR)") {
                Label("Exact original PDF in the native viewer", systemImage: "doc.viewfinder")
                Label("Page images retain formulas, figures, tables, and layout", systemImage: "photo.stack")
                Label("Existing selectable text is used for translation and analysis", systemImage: "text.cursor")

                Text("This built-in fallback needs no Python package, OCR model, or download. An image-only scanned PDF can still be previewed and exported exactly, but it cannot be translated or summarized until an OCR parser supplies text.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Section("What MinerU Adds") {
                Label("Section hierarchy and reading order", systemImage: "list.bullet.indent")
                Label("Images, captions, tables, and local asset links", systemImage: "photo.on.rectangle")
                Label("Display and inline formulas as LaTeX", systemImage: "function")

                Text("MinerU is optional. When installed, it adds semantic Markdown and reconstructed LaTeX for more editable exports. PaperBridge stores its output locally; PDFKit remains available as an independent parser choice and automatic fallback.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .formStyle(.grouped)
        .onChange(of: viewModel.settings.minerUExecutablePath) { _, _ in
            viewModel.scheduleMinerUStatusRefresh()
        }
    }

    private var modelsTab: some View {
        Form {
            Section("Ollama") {
                HStack {
                    OllamaStatusBadge(
                        isRefreshing: viewModel.isRefreshingModels,
                        isAvailable: viewModel.hasAvailableModels
                    )
                    Spacer()
                    Button {
                        viewModel.refreshAvailableModels()
                    } label: {
                        Label("Refresh Models", systemImage: "arrow.clockwise")
                    }
                    .disabled(viewModel.isRefreshingModels)
                }

                TextField(
                    "Server",
                    text: settingBinding(\.ollamaBaseURL)
                )
                .font(.system(.body, design: .monospaced))

                if let modelRefreshError = viewModel.modelRefreshError {
                    Label(modelRefreshError, systemImage: "exclamationmark.triangle.fill")
                        .font(.caption)
                        .foregroundStyle(.orange)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            Section("Task Models") {
                modelPicker("Translation", selection: settingBinding(\.translationModel))
                modelPicker("Summary", selection: settingBinding(\.summaryModel))
                modelPicker("Paragraph explanation", selection: settingBinding(\.explainModel))
                modelPicker("Quick lookup", selection: settingBinding(\.quickLookupModel))

                Text("Quick lookup powers selected-text translation and explanation. A smaller local model usually gives a more immediate reading experience.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .formStyle(.grouped)
    }

    private var readingTab: some View {
        Form {
            Section("Default Translation Direction") {
                Picker("From", selection: settingBinding(\.sourceLanguage)) {
                    ForEach(ReaderLanguage.allCases) { language in
                        Text(language.displayName).tag(language)
                    }
                }

                Picker("To", selection: settingBinding(\.targetLanguage)) {
                    ForEach(ReaderLanguage.allCases) { language in
                        Text(language.displayName).tag(language)
                    }
                }

                Button {
                    viewModel.swapTranslationLanguages()
                } label: {
                    Label("Swap Languages", systemImage: "arrow.left.arrow.right")
                }
            }

            Section("Translation Chunking") {
                Stepper(
                    value: settingBinding(\.maxParagraphChars),
                    in: 500...6000,
                    step: 100
                ) {
                    LabeledContent(
                        "Maximum chunk",
                        value: "\(viewModel.settings.maxParagraphChars) characters"
                    )
                }

                Text("Long natural paragraphs stay visually intact. This limit only controls the smaller requests sent to Ollama.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .formStyle(.grouped)
    }

    private var dataTab: some View {
        Form {
            Section("Local Workspace") {
                Label {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Automatic local recovery")
                            .fontWeight(.medium)
                        Text("PaperBridge stores extracted text, generated results, bookmarks, highlights, and notes in Application Support.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                } icon: {
                    Image(systemName: "checkmark.shield.fill")
                        .foregroundStyle(PaperBridgeTheme.accent)
                }

                Text("No workspace data is uploaded. Ollama requests stay on localhost.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Section("Privacy") {
                Button("Remove All Saved PaperBridge Data", role: .destructive) {
                    isClearConfirmationPresented = true
                }

                Text("Original PDF files are never removed by this action.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .formStyle(.grouped)
    }

    private func modelPicker(_ label: String, selection: Binding<String>) -> some View {
        let options = viewModel.availableModels.contains(selection.wrappedValue)
            ? viewModel.availableModels
            : [selection.wrappedValue] + viewModel.availableModels

        return Picker(label, selection: selection) {
            ForEach(options, id: \.self) { model in
                Text(model).tag(model)
            }
        }
    }

    private func settingBinding<Value>(
        _ keyPath: WritableKeyPath<AppSettings, Value>
    ) -> Binding<Value> {
        Binding(
            get: { viewModel.settings[keyPath: keyPath] },
            set: { viewModel.settings[keyPath: keyPath] = $0 }
        )
    }
}
