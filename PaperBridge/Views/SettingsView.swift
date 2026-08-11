import SwiftUI

struct SettingsView: View {
    private enum SettingsSection: String, CaseIterable, Identifiable {
        case setup
        case parsing
        case models
        case reading
        case updates
        case data

        var id: String { rawValue }

        var title: String {
            switch self {
            case .setup: return "Local AI"
            case .parsing: return "Parsing"
            case .models: return "Models"
            case .reading: return "Reading"
            case .updates: return "Updates"
            case .data: return "Local Data"
            }
        }

        var icon: String {
            switch self {
            case .setup: return "square.and.arrow.down"
            case .parsing: return "doc.richtext"
            case .models: return "cpu"
            case .reading: return "text.book.closed"
            case .updates: return "arrow.triangle.2.circlepath"
            case .data: return "internaldrive"
            }
        }
    }

    @ObservedObject var viewModel: PaperReaderViewModel
    @ObservedObject var updateController: AppUpdateController
    let onShowGettingStarted: () -> Void
    @State private var isClearConfirmationPresented = false
    @State private var selectedSection: SettingsSection = .setup

    var body: some View {
        VStack(spacing: 0) {
            settingsHeader
            settingsNavigation
            Divider()

            Group {
                switch selectedSection {
                case .setup:
                    localSetupTab
                case .parsing:
                    parsingTab
                case .models:
                    modelsTab
                case .reading:
                    readingTab
                case .updates:
                    UpdateSettingsView(updateController: updateController)
                case .data:
                    dataTab
                }
            }
            .id(selectedSection)
            .transition(.opacity)
            .animation(.easeOut(duration: 0.16), value: selectedSection)
            .padding(18)
        }
        .frame(width: 820, height: 720)
        .background(PaperBridgeTheme.canvas)
        .tint(PaperBridgeTheme.accent)
        .task {
            viewModel.refreshLocalSetupStatus()
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

    private var settingsNavigation: some View {
        HStack(spacing: 20) {
            ForEach(SettingsSection.allCases) { section in
                Button {
                    selectedSection = section
                } label: {
                    VStack(spacing: 7) {
                        Label(section.title, systemImage: section.icon)
                        Rectangle()
                            .fill(
                                selectedSection == section
                                    ? PaperBridgeTheme.accent
                                    : Color.clear
                            )
                            .frame(height: 2)
                    }
                        .font(.callout.weight(.semibold))
                        .frame(maxWidth: .infinity)
                        .padding(.top, 4)
                        .foregroundStyle(
                            selectedSection == section
                                ? PaperBridgeTheme.accent
                                : PaperBridgeTheme.originalLabel
                        )
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(selectedSection == section ? .isSelected : [])
            }
        }
        .padding(.horizontal, 22)
        .padding(.bottom, 10)
        .background(PaperBridgeTheme.surface)
    }

    private var settingsHeader: some View {
        HStack(spacing: 12) {
            AppIconBadge(size: 42)

            VStack(alignment: .leading, spacing: 3) {
                Text("PaperBridge")
                    .font(.system(size: 21, weight: .semibold, design: .serif))
                    .foregroundStyle(PaperBridgeTheme.ink)
                Text("Local models, document parsing, reading, updates, and privacy")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            Label("Local only", systemImage: "lock.fill")
                .font(.caption.weight(.semibold))
                .foregroundStyle(PaperBridgeTheme.accentDark)
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(
                    PaperBridgeTheme.accentSoft,
                    in: RoundedRectangle(cornerRadius: 7, style: .continuous)
                )
        }
        .padding(.horizontal, 22)
        .padding(.vertical, 12)
        .background(PaperBridgeTheme.surface)
    }

    private var localSetupTab: some View {
        Form {
            Section {
                HStack(alignment: .top, spacing: 12) {
                    Image(systemName: "externaldrive.connected.to.line.below")
                        .font(.title2)
                        .foregroundStyle(PaperBridgeTheme.accent)
                    VStack(alignment: .leading, spacing: 5) {
                        Text("Set up everything without Terminal")
                            .font(.headline)
                        Text("PaperBridge installs local tools only for your macOS user. Papers and model requests stay on this Mac.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer()
                    HStack {
                        Button {
                            onShowGettingStarted()
                        } label: {
                            Label("Getting Started", systemImage: "questionmark.circle")
                        }

                        Button {
                            viewModel.refreshLocalSetupStatus()
                        } label: {
                            Label("Refresh", systemImage: "arrow.clockwise")
                        }
                        .disabled(viewModel.isLocalSetupBusy)
                    }
                }
            }

            Section("1. Ollama Runtime") {
                setupStatusRow(
                    title: viewModel.isOllamaReachable
                        ? "Ollama ready"
                        : (viewModel.ollamaInstallation.isInstalled ? "Ollama installed" : "Ollama not installed"),
                    detail: viewModel.ollamaInstallStatus,
                    systemImage: viewModel.isOllamaReachable
                        ? "checkmark.circle.fill"
                        : (viewModel.ollamaInstallation.isInstalled ? "power.circle" : "arrow.down.app"),
                    isReady: viewModel.isOllamaReachable
                )

                setupProgress(
                    value: viewModel.ollamaInstallProgress,
                    isActive: viewModel.isInstallingOllama
                )

                if let error = viewModel.ollamaInstallError {
                    setupMessage(error, color: .orange)
                }

                HStack {
                    if viewModel.isInstallingOllama {
                        Button("Cancel", role: .cancel) {
                            viewModel.cancelOllamaInstall()
                        }
                    } else {
                        Button {
                            viewModel.installOrStartOllama()
                        } label: {
                            Label(
                                viewModel.ollamaInstallation.isInstalled ? "Start Ollama" : "Install Ollama",
                                systemImage: viewModel.ollamaInstallation.isInstalled ? "play.fill" : "arrow.down.circle.fill"
                            )
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(viewModel.isLocalSetupBusy || viewModel.isOllamaReachable)
                    }

                    Link("Official download", destination: URL(string: "https://ollama.com/download/mac")!)
                        .font(.caption)
                    Spacer()
                    Text("Installs to ~/Applications; no administrator password")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            Section("2. Translation Models · Required for Translation") {
                Text("Choose one TranslateGemma size. 4B is fastest, while 12B and 27B trade more disk and memory for stronger translation quality.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)

                ForEach(RecommendedOllamaModel.translationModels) { model in
                    localModelCard(model)
                }
            }

            Section("3. MinerU Parser · Optional, Recommended") {
                Text("MinerU is optional, but strongly recommended for the best bilingual reading order, paragraph structure, figures, captions, tables, formulas, and Markdown exports.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)

                setupStatusRow(
                    title: viewModel.minerUStatus.isAvailable ? "MinerU ready" : "MinerU recommended for the best experience",
                    detail: viewModel.minerUInstallStatus,
                    systemImage: viewModel.minerUStatus.isAvailable ? "checkmark.circle.fill" : "doc.text.magnifyingglass",
                    isReady: viewModel.minerUStatus.isAvailable
                )

                setupProgress(
                    value: viewModel.minerUInstallProgress,
                    isActive: viewModel.isInstallingMinerU
                )

                if let error = viewModel.minerUInstallError {
                    setupMessage(error, color: .orange)
                }

                HStack {
                    if viewModel.isInstallingMinerU {
                        Button("Cancel", role: .cancel) {
                            viewModel.cancelMinerUInstall()
                        }
                    } else {
                        Button {
                            viewModel.installManagedMinerU()
                        } label: {
                            Label(
                                viewModel.minerUStatus.isAvailable ? "Install Managed Update" : "Install MinerU",
                                systemImage: "arrow.down.circle.fill"
                            )
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(viewModel.isLocalSetupBusy)
                    }
                    Spacer()
                    Text("Includes isolated Python and pipeline models; several GB")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Text("PDFKit facsimile remains available without Python, OCR, or additional downloads, but it cannot reconstruct academic layout as reliably as MinerU.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Section("4. Explanation Models · Optional") {
                Text("These general models are fully optional. When selected, they power whole-paper summaries, paragraph explanations, and selected-text lookup. Translation continues to use TranslateGemma.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)

                ForEach(RecommendedOllamaModel.assistantModels) { model in
                    localModelCard(model)
                }
            }
        }
        .formStyle(.grouped)
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
                        isAvailable: viewModel.isOllamaReachable
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

    private func localModelCard(_ model: RecommendedOllamaModel) -> some View {
        let isDownloading = viewModel.activeModelDownloadID == model.id
        return LocalAIModelCard(
            model: model,
            isInstalled: viewModel.isModelInstalled(model.id),
            isSelected: viewModel.isModelSelected(model),
            isDownloading: isDownloading,
            isDisabled: !viewModel.isOllamaReachable || (viewModel.isLocalSetupBusy && !isDownloading),
            progress: isDownloading ? viewModel.modelDownloadProgress : nil,
            status: viewModel.modelDownloadStatus,
            error: viewModel.lastModelDownloadID == model.id ? viewModel.modelDownloadError : nil,
            onAction: { viewModel.pullOrUseModel(model) },
            onCancel: viewModel.cancelModelPull
        )
    }

    @ViewBuilder
    private func setupProgress(value: Double?, isActive: Bool) -> some View {
        if isActive {
            if let value {
                ProgressView(value: value)
                    .progressViewStyle(.linear)
            } else {
                ProgressView()
                    .controlSize(.small)
            }
        }
    }

    private func setupStatusRow(
        title: String,
        detail: String,
        systemImage: String,
        isReady: Bool
    ) -> some View {
        Label {
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .fontWeight(.medium)
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .textSelection(.enabled)
            }
        } icon: {
            Image(systemName: systemImage)
                .foregroundStyle(isReady ? PaperBridgeTheme.accent : Color.secondary)
        }
    }

    private func setupMessage(_ message: String, color: Color) -> some View {
        Label(message, systemImage: "exclamationmark.triangle.fill")
            .font(.caption)
            .foregroundStyle(color)
            .fixedSize(horizontal: false, vertical: true)
            .textSelection(.enabled)
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
