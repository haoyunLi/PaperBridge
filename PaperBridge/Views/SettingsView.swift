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
            .disabled(viewModel.isBusy && selectedSection != .models)
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
        .onAppear {
            showRequestedAISettings()
        }
        .onChange(of: viewModel.isAISettingsRequested) { _, isRequested in
            if isRequested {
                showRequestedAISettings()
            }
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
            Text("This removes saved papers, translations, summaries, highlights, notes, and settings from this Mac. Original PDF files are not changed. The OpenAI API key remains in Keychain; remove it separately under Models > OpenAI. Text already sent to OpenAI cannot be recalled.")
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
                Text("AI providers, document parsing, reading, updates, and privacy")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            VStack(alignment: .trailing, spacing: 6) {
                Label(
                    viewModel.aiProviderLabel,
                    systemImage: viewModel.settings.aiProvider == .ollama ? "lock.fill" : "network"
                )
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(PaperBridgeTheme.accentDark)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(
                        PaperBridgeTheme.accentSoft,
                        in: RoundedRectangle(cornerRadius: 7, style: .continuous)
                    )

                if viewModel.isOpenAIOptInConfirmed {
                    Button("Revoke OpenAI Consent") {
                        viewModel.isOpenAIOptInConfirmed = false
                    }
                    .font(.caption)
                    .help("Stop active OpenAI requests and require consent before sending more text. Already sent text cannot be recalled.")
                }
            }
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
                        Text("These optional tools run on this Mac and are installed only for your macOS user. Ollama requests stay local. OpenAI is a separate, opt-in online provider under Models; it sends text to OpenAI, not PDF files or images.")
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

            Section("2. Translation Models · For Local Translation") {
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
                Text("These general models are fully optional. With Ollama selected, they power whole-paper summaries, paragraph explanations, and selected-text lookup. Local translation uses your selected translation model. OpenAI has separate task models under Models.")
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
        VStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 8) {
                Picker("AI provider", selection: settingBinding(\.aiProvider)) {
                    Text(AIProvider.ollama.displayName).tag(AIProvider.ollama)
                    Text(AIProvider.openAI.displayName).tag(AIProvider.openAI)
                }
                .pickerStyle(.segmented)
                .disabled(viewModel.isBusy || viewModel.isSelectionLookupBusy)

                Text("Ollama is the default. OpenAI requires your API key, chosen models, and consent for this session. PaperBridge never switches providers automatically.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(12)
            .background(
                PaperBridgeTheme.surface,
                in: RoundedRectangle(cornerRadius: 10, style: .continuous)
            )

            if viewModel.settings.aiProvider == .ollama {
                localModelsForm
                    .disabled(viewModel.isBusy || viewModel.isSelectionLookupBusy)
            } else {
                OpenAISettingsView(viewModel: viewModel)
            }
        }
    }

    private var localModelsForm: some View {
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

                Text("Long natural paragraphs stay visually intact. This limit controls the smaller requests sent to the selected AI provider. With OpenAI enabled, full translation and summary can send the full extracted paper text in multiple batches.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Section("Translation Style Guide · Optional") {
                TextField(
                    "Preferred terminology, tone, or formatting",
                    text: Binding(
                        get: { viewModel.settings.translationStyleGuide },
                        set: { viewModel.settings.translationStyleGuide = String($0.prefix(2000)) }
                    ),
                    axis: .vertical
                )
                .lineLimit(3...6)
                .disabled(viewModel.isSelectionLookupBusy)

                Text("\(viewModel.settings.translationStyleGuide.count)/2,000 characters. Sent with translation instructions to the selected provider. Do not include secrets. Leave empty to use the default instructions.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
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

                Text("Workspace recovery is local, not a cloud backup. Ollama requests stay on localhost. If you choose OpenAI and consent, requested text and relevant context are sent to OpenAI; PDF files and images are not uploaded.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Section("Privacy") {
                Text("OpenAI selection requests include selected text, nearby context, the paper title, and matching saved terminology. Full translation and summary send the full extracted text in batches. API usage is paid separately from ChatGPT. There is no automatic cloud fallback.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)

                Text("The OpenAI API key is stored in the local macOS Keychain (iCloud synchronization disabled), never in app settings or exports. Normal Mac backup or migration can include the Keychain. Manage or remove the key under Models > OpenAI. Responses API requests use store: false, which does not guarantee zero retention; OpenAI's data policies still apply.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)

                Link("OpenAI data controls", destination: URL(string: "https://developers.openai.com/api/docs/guides/your-data")!)

                Button("Remove All Saved PaperBridge Data", role: .destructive) {
                    isClearConfirmationPresented = true
                }

                Text("Original PDF files and the Keychain API key are not removed by this action. Remove the key separately under Models > OpenAI. Clearing local data cannot recall text already sent to OpenAI.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
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
            isDisabled: viewModel.isSelectionLookupBusy || !viewModel.isOllamaReachable || (viewModel.isLocalSetupBusy && !isDownloading),
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

    private func showRequestedAISettings() {
        guard viewModel.isAISettingsRequested else { return }
        selectedSection = .models
        viewModel.isAISettingsRequested = false
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
