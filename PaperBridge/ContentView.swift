import AppKit
import SwiftUI
import UniformTypeIdentifiers

struct ContentView: View {
    private static let compactInspectorBreakpoint: CGFloat = 1_400
    private static let compactInspectorMinHeight: CGFloat = 190
    private static let compactInspectorMaxHeight: CGFloat = 340

    @ObservedObject var viewModel: PaperReaderViewModel
    var onShowGettingStarted: () -> Void = {}
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var isDropTargeted = false
    @State private var isPasteTextExpanded = false
    @State private var hasAppeared = false
    @FocusState private var isManualInputFocused: Bool
    @FocusState private var isReaderSearchFocused: Bool
    @State private var handledSearchFocusRequest: UUID?
    @State private var visibleReaderItemID: String?
    @State private var positionBeforeSearch: String?
    @State private var handledParagraphNavigationID: UUID?
    @State private var isDocumentDetailsExpanded = false
    @State private var isDocumentSidebarPresented = true
    @State private var isReadingToolsPresented = false
    @State private var focusRestoreState: (sidebar: Bool, inspector: Bool)?

    var body: some View {
        GeometryReader { geometry in
            responsiveRootLayout(
                usesBottomInspector: geometry.size.width < Self.compactInspectorBreakpoint,
                availableHeight: geometry.size.height
            )
        }
        .tint(PaperBridgeTheme.accent)
        .environment(\.readingAppearance, viewModel.settings.readingAppearance.clamped)
        .sheet(isPresented: $viewModel.isLibraryPresented) { PaperLibraryView(viewModel: viewModel) }
        .sheet(isPresented: $viewModel.isGlossaryPresented) { GlossaryView(viewModel: viewModel) }
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
            viewModel.refreshMinerUStatus()
        }
        .onChange(of: viewModel.settings.ollamaBaseURL) { _, _ in
            viewModel.scheduleModelRefresh()
        }
        .onChange(of: viewModel.settings.minerUExecutablePath) { _, _ in
            viewModel.scheduleMinerUStatusRefresh()
        }
        .onAppear {
            if reduceMotion {
                hasAppeared = true
            } else {
                withAnimation(.easeOut(duration: 0.45)) {
                    hasAppeared = true
                }
            }
        }
    }

    private func responsiveRootLayout(
        usesBottomInspector: Bool,
        availableHeight: CGFloat
    ) -> some View {
        HSplitView {
            if isDocumentSidebarPresented || viewModel.loadedPaper == nil {
                documentSidebar
                    .frame(minWidth: 240, idealWidth: 264, maxWidth: 300)
            }

            if usesBottomInspector {
                compactDetail(availableHeight: availableHeight)
                    .frame(minWidth: 560, maxWidth: .infinity, maxHeight: .infinity)
            } else {
                detail
                    .frame(minWidth: 600, maxWidth: .infinity, maxHeight: .infinity)
                    .inspector(isPresented: $viewModel.isInspectorPresented) {
                        SelectionInspectorView(viewModel: viewModel)
                            .inspectorColumnWidth(min: 280, ideal: 330, max: 420)
                    }
            }
        }
    }

    private func compactDetail(availableHeight: CGFloat) -> some View {
        VStack(spacing: 0) {
            detail
                .frame(minHeight: 320, maxHeight: .infinity)

            if viewModel.isInspectorPresented {
                Divider()

                SelectionInspectorView(viewModel: viewModel, placement: .bottomDrawer)
                    .frame(
                        height: min(
                            Self.compactInspectorMaxHeight,
                            max(Self.compactInspectorMinHeight, min(availableHeight * 0.30, availableHeight - 440))
                        )
                    )
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(.easeInOut(duration: 0.2), value: viewModel.isInspectorPresented)
    }

    private var documentSidebar: some View {
        ScrollView(.vertical) {
            VStack(alignment: .leading, spacing: 12) {
                brandHeader
                Button(action: viewModel.showLibrary) {
                    Label("Paper Library", systemImage: "books.vertical")
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.vertical, 5).contentShape(Rectangle())
                }
                .buttonStyle(.bordered)

                if let paper = viewModel.loadedPaper {
                    DisclosureGroup("Document & Import", isExpanded: $isDocumentDetailsExpanded) {
                        sourceCard
                        documentCard(paper)
                        languageCard
                        localStatusCard
                    }

                    if !viewModel.bookmarkedParagraphIDs.isEmpty {
                        bookmarksCard
                    }
                    outlineCard
                } else {
                    sourceCard
                    localStatusCard
                }
            }
            .frame(maxWidth: .infinity, alignment: .topLeading)
            .padding(14)
        }
        .scrollIndicators(.visible)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(PaperBridgeTheme.sidebar)
        .environment(\.colorScheme, .dark)
        .tint(PaperBridgeTheme.sidebarAccent)
    }

    private var brandHeader: some View {
        HStack(alignment: .center, spacing: 12) {
            AppIconBadge(size: 48)

            VStack(alignment: .leading, spacing: 4) {
                Text("PaperBridge")
                    .font(.system(size: 25, weight: .bold, design: .serif))

                Text("Papers across languages")
                    .font(.caption)
                    .foregroundStyle(.secondary)

                HStack(spacing: 6) {
                    Circle()
                        .fill(PaperBridgeTheme.sidebarAccent)
                        .frame(width: 6, height: 6)
                    Text("Private by design")
                        .font(.caption2.weight(.semibold))
                }
                .foregroundStyle(PaperBridgeTheme.sidebarAccent)
            }
        }
        .padding(.horizontal, 2)
        .padding(.vertical, 6)
    }

    private var sourceCard: some View {
        SidebarCard(title: "Source", icon: "doc.richtext") {
            Button {
                viewModel.showImporter()
            } label: {
                Label("Open PDF", systemImage: "plus.circle.fill")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(PaperBridgeTheme.sidebarAccent)
            .controlSize(.large)

            DisclosureGroup(isExpanded: $isPasteTextExpanded) {
                VStack(alignment: .leading, spacing: 8) {
                    ZStack(alignment: .topLeading) {
                        TextEditor(text: manualInputBinding)
                            .focused($isManualInputFocused)
                            .font(.body)
                            .scrollContentBackground(.hidden)
                            .padding(7)

                        if viewModel.manualInputText
                            .trimmingCharacters(in: .whitespacesAndNewlines)
                            .isEmpty {
                            Text("Paste an abstract or paper...")
                                .font(.callout)
                                .foregroundStyle(.tertiary)
                                .padding(13)
                                .allowsHitTesting(false)
                        }
                    }
                    .frame(height: 104)
                    .background(
                        PaperBridgeTheme.sidebarInput,
                        in: RoundedRectangle(cornerRadius: 8, style: .continuous)
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .strokeBorder(PaperBridgeTheme.sidebarBorder)
                    )

                    HStack {
                        Button("Load Text") {
                            viewModel.loadTextInput()
                        }
                        .buttonStyle(.bordered)
                        .disabled(!viewModel.canLoadInputText)

                        Button("Clear") {
                            viewModel.manualInputText = ""
                        }
                        .buttonStyle(.borderless)
                        .disabled(viewModel.manualInputText.isEmpty || viewModel.isBusy)
                    }
                }
                .padding(.top, 8)
            } label: {
                Label("Paste Text", systemImage: "text.badge.plus")
                    .font(.subheadline.weight(.semibold))
            }
        }
    }

    private func documentCard(_ paper: PaperDocument) -> some View {
        SidebarCard(title: "Document", icon: "doc.text.magnifyingglass") {
            Text(paper.name)
                .font(.headline)
                .lineLimit(3)

            statRow(label: "Paragraphs", value: "\(paper.paragraphs.count)")
            if let extractionEngine = paper.extractionEngine {
                statRow(label: "Parser", value: extractionEngine.displayName)
            }
            statRow(label: "Translated", value: "\(viewModel.translatedCount)")
            if viewModel.failedCount > 0 {
                statRow(label: "Failed", value: "\(viewModel.failedCount)")
            }
            if paper.excludedReferenceCount > 0 {
                statRow(label: "Skipped refs", value: "\(paper.excludedReferenceCount)")
            }
            if !viewModel.annotations.isEmpty {
                statRow(label: "Annotations", value: "\(viewModel.annotations.count)")
            }
        }
    }

    private var outlineCard: some View {
        SidebarCard(title: "Outline", icon: "list.bullet.indent") {
            VStack(alignment: .leading, spacing: 4) {
                ForEach(viewModel.documentSections) { section in
                    Button {
                        viewModel.workspaceMode = .reader
                        viewModel.navigateToParagraph(section.paragraphID)
                    } label: {
                        HStack(spacing: 8) {
                            Rectangle()
                                .fill(
                                    viewModel.selectedParagraphID == section.paragraphID
                                        ? PaperBridgeTheme.sidebarAccent
                                        : Color.clear
                                )
                                .frame(width: 2, height: 18)

                            Text(section.title)
                                .lineLimit(2)
                                .multilineTextAlignment(.leading)

                            Spacer(minLength: 4)

                            Text("\(section.paragraphID)")
                                .font(.caption2.monospacedDigit())
                                .foregroundStyle(.secondary)
                        }
                        .font(.callout)
                        .padding(.vertical, 5)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private var bookmarksCard: some View {
        SidebarCard(title: "Bookmarks", icon: "bookmark.fill") {
            ForEach(viewModel.bookmarkedParagraphIDs.sorted(), id: \.self) { paragraphID in
                Button {
                    viewModel.workspaceMode = .reader
                    viewModel.navigateToParagraph(paragraphID)
                } label: {
                    HStack {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(viewModel.paragraphResults.first(where: { $0.id == paragraphID })?.previewText ?? "Paragraph \(paragraphID)")
                                .lineLimit(2)
                            Text("Paragraph \(paragraphID)")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        Image(systemName: "chevron.right")
                            .font(.caption2)
                    }
                    .font(.callout)
                    .padding(.vertical, 3)
                }
                .buttonStyle(.plain)
            }
        }
    }

    private var languageCard: some View {
        SidebarCard(title: "Language", icon: "character.book.closed") {
            languagePicker("From", selection: settingBinding(\.sourceLanguage))

            HStack {
                Spacer()
                Button {
                    viewModel.swapTranslationLanguages()
                } label: {
                    Label("Swap", systemImage: "arrow.up.arrow.down")
                }
                .buttonStyle(.borderless)
                Spacer()
            }

            languagePicker("To", selection: settingBinding(\.targetLanguage))
        }
        .disabled(viewModel.isBusy)
    }

    private var localStatusCard: some View {
        SidebarCard(title: "Local Engine", icon: "cpu") {
            HStack {
                OllamaStatusBadge(
                    isRefreshing: viewModel.isRefreshingModels,
                    isAvailable: viewModel.isOllamaReachable
                )
                Spacer()
                Button {
                    viewModel.refreshAvailableModels()
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .buttonStyle(.borderless)
                .disabled(viewModel.isRefreshingModels)
                .help("Refresh Ollama models")
            }

            if let modelRefreshError = viewModel.modelRefreshError {
                Text(modelRefreshError)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Divider()

            HStack(spacing: 8) {
                if viewModel.isRefreshingMinerU {
                    ProgressView()
                        .controlSize(.small)
                } else {
                    Circle()
                        .fill(viewModel.minerUStatus.isAvailable ? PaperBridgeTheme.sidebarAccent : Color.orange)
                        .frame(width: 7, height: 7)
                }

                VStack(alignment: .leading, spacing: 2) {
                    Text(viewModel.minerUStatus.isAvailable ? "MinerU ready" : "MinerU unavailable")
                        .font(.callout.weight(.semibold))
                    Text(viewModel.minerUStatus.message)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(3)
                }

                Spacer(minLength: 4)

                Button {
                    viewModel.refreshMinerUStatus()
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .buttonStyle(.borderless)
                .disabled(viewModel.isRefreshingMinerU)
            }

            Label("PDFKit facsimile always available", systemImage: "doc.viewfinder")
                .font(.caption.weight(.medium))
                .foregroundStyle(.secondary)

            SettingsLink {
                Label("Parser, Models & Settings", systemImage: "gearshape")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
        }
    }

    private var detail: some View {
        ZStack {
            PaperBridgeBackground()

            if viewModel.loadedPaper == nil {
                emptyState
            } else {
                workspace
            }
        }
        .dropDestination(for: URL.self) { items, _ in
            viewModel.handleDroppedFiles(items)
        } isTargeted: { isTargeted in
            isDropTargeted = isTargeted
        }
        .overlay {
            RoundedRectangle(cornerRadius: 16)
                .strokeBorder(
                    isDropTargeted ? PaperBridgeTheme.accent : Color.clear,
                    lineWidth: 2
                )
                .padding(16)
        }
        .overlay(alignment: .top) {
            if isDropTargeted {
                Label("Drop PDF to open", systemImage: "arrow.down.doc.fill")
                    .font(.headline)
                    .padding(.horizontal, 18)
                    .padding(.vertical, 10)
                    .foregroundStyle(.white)
                    .background(
                        PaperBridgeTheme.accent,
                        in: RoundedRectangle(cornerRadius: 8, style: .continuous)
                    )
                    .padding(.top, 22)
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .animation(.easeInOut(duration: 0.18), value: isDropTargeted)
    }

    private var workspace: some View {
        VStack(spacing: 0) {
            workspaceHeader
            Divider()
            workspaceContent
        }
        .overlay(alignment: .bottomTrailing) {
            if viewModel.isQuickLookupPresented && !viewModel.isInspectorPresented && viewModel.activeTextSelection != nil {
                QuickSelectionView(viewModel: viewModel).padding(16)
            }
        }
    }

    private var workspaceHeader: some View {
        VStack(alignment: .leading, spacing: 13) {
            HStack(alignment: .center, spacing: 14) {
                Button {
                    focusRestoreState = nil
                    isDocumentSidebarPresented.toggle()
                } label: {
                    Image(systemName: "sidebar.left")
                }
                .buttonStyle(.bordered)
                .keyboardShortcut("s", modifiers: [.command, .control])
                .accessibilityLabel(isDocumentSidebarPresented ? "Hide Document Sidebar" : "Show Document Sidebar")
                .help("Show or hide Document Sidebar (Control-Command-S)")

                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 9) {
                        RoundedRectangle(cornerRadius: 2)
                            .fill(PaperBridgeTheme.translation)
                            .frame(width: 5, height: 26)

                        Text(viewModel.loadedPaper?.name ?? "Untitled Paper")
                            .font(.system(size: 25, weight: .semibold, design: .serif))
                            .foregroundStyle(PaperBridgeTheme.ink)
                            .lineLimit(1)
                    }

                    Text(
                        "\(viewModel.settings.sourceLanguage.displayName) → \(viewModel.settings.targetLanguage.displayName) · \(viewModel.loadedPaper?.extractionEngine?.displayName ?? "Local parser") · \(viewModel.paragraphResults.count) blocks"
                    )
                    .font(.caption)
                    .foregroundStyle(.secondary)
                }

                Spacer()

                Button {
                    if let previous = focusRestoreState {
                        isDocumentSidebarPresented = previous.sidebar
                        viewModel.isInspectorPresented = previous.inspector
                        focusRestoreState = nil
                    } else {
                        focusRestoreState = (isDocumentSidebarPresented, viewModel.isInspectorPresented)
                        isDocumentSidebarPresented = false
                        viewModel.isInspectorPresented = false
                        viewModel.isQuickLookupPresented = false
                    }
                } label: { Image(systemName: focusRestoreState == nil ? "arrow.up.left.and.arrow.down.right" : "arrow.down.right.and.arrow.up.left") }
                .buttonStyle(.bordered)
                .keyboardShortcut("f", modifiers: [.command, .control])
                .help(focusRestoreState == nil ? "Focus Reading (Control-Command-F)" : "Exit Focus Reading")
                .accessibilityLabel(focusRestoreState == nil ? "Focus Reading" : "Exit Focus Reading")

                Button { isReadingToolsPresented.toggle() } label: { Image(systemName: "textformat.size") }
                    .buttonStyle(.bordered).help("Reading appearance").accessibilityLabel("Reading Appearance")
                    .popover(isPresented: $isReadingToolsPresented) {
                        ReadingToolsView(appearance: settingBinding(\.readingAppearance))
                    }

                Button {
                    focusRestoreState = nil
                    viewModel.toggleInspector()
                } label: {
                    Image(systemName: "sidebar.right")
                }
                .buttonStyle(.bordered)
                .help("Show or hide Research Inspector")
            }

            ViewThatFits(in: .horizontal) {
                HStack(spacing: 10) {
                    workspaceModePicker
                    Spacer()
                    primaryActions
                }

                VStack(alignment: .leading, spacing: 10) {
                    workspaceModePicker
                    primaryActions
                }
            }
            if let message = viewModel.primarySetupMessage {
                Text(message)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 15)
        .background(PaperBridgeTheme.surface)
    }

    private var workspaceModePicker: some View {
        HStack(spacing: 3) {
            ForEach(ReaderWorkspaceMode.allCases) { mode in
                Button {
                    withAnimation(.easeOut(duration: 0.18)) {
                        viewModel.workspaceMode = mode
                    }
                } label: {
                    Text(mode.displayName)
                        .font(.caption.weight(.semibold))
                        .lineLimit(1)
                        .minimumScaleFactor(0.88)
                        .frame(maxWidth: .infinity)
                        .padding(.horizontal, 7)
                        .padding(.vertical, 8)
                        .foregroundStyle(
                            viewModel.workspaceMode == mode
                                ? PaperBridgeTheme.accentForeground
                                : PaperBridgeTheme.ink
                        )
                        .background(
                            viewModel.workspaceMode == mode
                                ? PaperBridgeTheme.accent
                                : Color.clear,
                            in: RoundedRectangle(cornerRadius: 8, style: .continuous)
                        )
                        // Plain buttons must include the padded segment in their hit target.
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(
                    viewModel.workspaceMode == mode ? .isSelected : []
                )
            }
        }
        .padding(3)
        .background(
            PaperBridgeTheme.accentSoft,
            in: RoundedRectangle(cornerRadius: 11, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 11, style: .continuous)
                .strokeBorder(PaperBridgeTheme.border)
        )
        .frame(maxWidth: 540)
    }

    @ViewBuilder
    private var primaryActions: some View {
        HStack(spacing: 8) {
            Button {
                if viewModel.primarySetupMessage != nil { onShowGettingStarted() }
                else { viewModel.performPrimaryWorkspaceAction() }
            } label: {
                Label(
                    viewModel.primarySetupMessage == nil ? primaryWorkspaceActionTitle : "Set Up Local AI",
                    systemImage: primaryWorkspaceActionIcon
                )
            }
            .buttonStyle(.borderedProminent)
            .tint(primaryWorkspaceActionTint)
            .disabled(!viewModel.canPerformPrimaryWorkspaceAction)

            Menu {
                Section("Translation Range") {
                    Button("Resume All Untranslated Blocks") { viewModel.translatePaper() }
                        .disabled(!viewModel.canTranslate)
                    Button("Abstract & Conclusion First") {
                        viewModel.translatePaper(paragraphIDs: PaperReadingAnalysis.overviewParagraphIDs(in: viewModel.paperSections))
                    }
                    .disabled(!viewModel.canTranslate || PaperReadingAnalysis.overviewParagraphIDs(in: viewModel.paperSections).isEmpty)
                    if let section = viewModel.currentReadingSection {
                        Button("Translate Current Section: \(section.title)") { viewModel.translatePaper(paragraphIDs: section.paragraphIDs) }
                            .disabled(!viewModel.canTranslate)
                        Button("Prioritize Current Section in Queue") { viewModel.prioritizeSection(section) }
                            .disabled(!viewModel.isTranslatingParagraphs)
                    }
                    Menu("Choose Section") {
                        ForEach(viewModel.paperSections) { section in
                            Button(section.title) { viewModel.translatePaper(paragraphIDs: section.paragraphIDs) }
                        }
                    }.disabled(!viewModel.canTranslate)
                }
                Divider()
                Button("Paper Library", action: viewModel.showLibrary)
                Button("Re-extract PDF as New Copy...", action: viewModel.reextractPDFAsNewCopy)
                    .disabled(viewModel.isBusy)
                Button("Saved Terminology") { viewModel.isGlossaryPresented = true }
                Divider()
                Button {
                    viewModel.workspaceMode = .summary
                    viewModel.generateSummaries()
                } label: {
                    Label("Generate Summary", systemImage: "list.bullet.rectangle")
                }
                .disabled(!viewModel.canSummarize)

                Button {
                    viewModel.workspaceMode = .fullTranslation
                    viewModel.generateConnectedTranslation()
                } label: {
                    Label("Generate Full Translation", systemImage: "text.append")
                }
                .disabled(!viewModel.canGenerateConnectedTranslation)

                Divider()

                Button {
                    viewModel.prepareMarkdownExport()
                } label: {
                    Label(
                        viewModel.loadedPaper?.hasMarkdownBundle == true
                            ? "Export Markdown Bundle"
                            : "Export Markdown",
                        systemImage: "square.and.arrow.down"
                    )
                }
                .disabled(!viewModel.canExport)
            } label: {
                Label("More", systemImage: "ellipsis")
            }
            .menuStyle(.borderlessButton)
            .fixedSize()

            if viewModel.isBusy {
                Button(role: .cancel) {
                    viewModel.cancelCurrentTask()
                } label: {
                    Image(systemName: "stop.fill")
                }
                .buttonStyle(.bordered)
                .help("Cancel the current request; completed progress is saved locally")
            }
        }
    }

    private var primaryWorkspaceActionTitle: String {
        switch viewModel.workspaceMode {
        case .preview:
            if viewModel.translatedCount == viewModel.paragraphResults.count,
               !viewModel.paragraphResults.isEmpty {
                return "Translated"
            }
            return viewModel.translatedCount > 0 ? "Resume Translation" : "Translate Document"
        case .reader:
            if viewModel.translatedCount == viewModel.paragraphResults.count,
               !viewModel.paragraphResults.isEmpty {
                return "Translated"
            }
            return viewModel.translatedCount > 0 ? "Resume" : "Translate"
        case .summary:
            return viewModel.summaries == nil ? "Generate Summary" : "Summary Ready"
        case .fullTranslation:
            if let result = viewModel.connectedTranslation {
                return result.failedBatchCount > 0
                    ? "Retry Full Translation"
                    : "Full Translation Ready"
            }
            return "Generate Full Translation"
        }
    }

    private var primaryWorkspaceActionIcon: String {
        switch viewModel.workspaceMode {
        case .preview:
            return "character.book.closed.fill"
        case .reader:
            return "character.book.closed.fill"
        case .summary:
            return "list.bullet.rectangle"
        case .fullTranslation:
            return "text.append"
        }
    }

    private var primaryWorkspaceActionTint: Color {
        switch viewModel.workspaceMode {
        case .summary:
            return PaperBridgeTheme.accent
        case .preview, .reader, .fullTranslation:
            return PaperBridgeTheme.translationButton
        }
    }

    @ViewBuilder
    private var workspaceContent: some View {
        switch viewModel.workspaceMode {
        case .preview:
            previewWorkspace
        case .reader:
            readerWorkspace
        case .summary:
            summaryWorkspace
        case .fullTranslation:
            fullTranslationWorkspace
        }
    }

    private var previewWorkspace: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 12) {
                statusStrip

                SurfaceCard(contentPadding: 14) {
                    HStack(spacing: 14) {
                        VStack(alignment: .leading, spacing: 3) {
                            Text("Full Document Preview")
                                .font(.title3.weight(.semibold))
                            Text(previewWorkspaceDescription)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }

                        Spacer()
                        displayModePicker
                            .frame(maxWidth: 340)
                    }
                }
            }
            .padding(.horizontal, 22)
            .padding(.top, 18)
            .padding(.bottom, 12)

            Divider()

            if let originalPDFURL = viewModel.previewOriginalPDFURL {
                PDFDocumentView(
                    pdfURL: originalPDFURL,
                    annotations: viewModel.annotations(for: .paper, side: .original),
                    navigationRequest: viewModel.annotationNavigationRequest,
                    readingPosition: viewModel.readingPositions["paper.pdf"],
                    onPositionChange: positionHandler(for: "paper.pdf"),
                    onNavigationFailure: viewModel.reportAnnotationNavigationFailure,
                    onSelection: viewModel.captureTextSelection
                )
                    .id("pdf-\(viewModel.loadedPaper?.checksum ?? "")")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                MarkdownPreviewView(
                    markdown: viewModel.previewMarkdown,
                    title: viewModel.loadedPaper?.name ?? "PaperBridge Preview",
                    resourceDirectory: viewModel.previewResourceDirectory,
                    selectionScope: .paper,
                    defaultSelectionSide: viewModel.displayMode == .translationOnly
                        ? .translation
                        : .original,
                    annotations: viewModel.annotations(for: .paper),
                    navigationRequest: viewModel.annotationNavigationRequest,
                    readingPosition: viewModel.readingPositions[paperMarkdownPositionKey],
                    onPositionChange: positionHandler(for: paperMarkdownPositionKey),
                    onNavigationFailure: viewModel.reportAnnotationNavigationFailure,
                    onSelection: viewModel.captureTextSelection
                )
                .id("\(viewModel.loadedPaper?.checksum ?? "")-\(paperMarkdownPositionKey)")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
    }

    private var previewWorkspaceDescription: String {
        if viewModel.loadedPaper?.extractionEngine == nil {
            return "Your source text in a reflowable reading view. This document was not reconstructed from a PDF by MinerU."
        }
        if viewModel.loadedPaper?.hasFacsimileMarkdown == true {
            return viewModel.displayMode == .sourceOnly
                ? "Exact native PDF rendering with original formulas, figures, and page layout; no OCR is used."
                : "Original page facsimiles stay intact while selectable text is shown with translation."
        }
        if viewModel.loadedPaper?.extractionEngine == .minerU,
           viewModel.displayMode == .sourceOnly,
           viewModel.loadedPaper?.originalPDFURL != nil {
            return "Exact native PDF rendering. Switch to Bilingual for MinerU's structured reading view with figures, tables, headings, and formulas."
        }
        return "MinerU structured reading view with local images, tables, headings, and LaTeX formulas; page coordinates are intentionally reflowed."
    }

    private var readerWorkspace: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                displayModePicker
                searchField
                undoButton
            }
            .padding(.horizontal, 22)
            .padding(.vertical, 10)
            Divider()
            ScrollViewReader { scrollProxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 16) {
                    statusStrip

                    if viewModel.visibleReaderItems.isEmpty {
                        ContentUnavailableView(
                            viewModel.paragraphResults.isEmpty
                                ? "No Selectable Text Layer"
                                : "No Matching Paragraphs",
                            systemImage: viewModel.paragraphResults.isEmpty
                                ? "doc.viewfinder"
                                : "text.magnifyingglass",
                            description: Text(
                                viewModel.paragraphResults.isEmpty
                                    ? "The original PDF remains available in Paper view. Translation without OCR requires selectable text in the PDF."
                                    : "Try a different search term."
                            )
                        )
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 48)
                    } else {
                        ForEach(viewModel.visibleReaderItems) { item in
                            VStack(alignment: .leading, spacing: 16) {
                                switch item {
                                case .paragraph(let paragraph):
                                    if let sectionTitle = TextProcessing.detectedSectionTitle(
                                        in: paragraph.original
                                    ) {
                                        sectionMarker(sectionTitle)
                                    }
                                    paragraphCard(paragraph)
                                case .resource(let resource):
                                    readerResourceBlock(resource)
                                }
                            }
                            .id(item.id)
                        }
                    }
                }
                .scrollTargetLayout()
                .padding(22)
                .frame(maxWidth: viewModel.settings.readingAppearance.clamped.contentWidth, alignment: .topLeading)
            }
            .scrollPosition(id: $visibleReaderItemID, anchor: .top)
            .scrollIndicators(.visible)
            .onAppear {
                let initialID: String?
                if let request = viewModel.navigationRequest, request.id != handledParagraphNavigationID {
                    handledParagraphNavigationID = request.id
                    initialID = "paragraph-\(request.paragraphID)"
                } else {
                    let position = viewModel.readingPositions["reader"]
                    initialID = position?.readerItemID ?? position?.paragraphID.map { "paragraph-\($0)" }
                }
                restoreReaderPosition(initialID, using: scrollProxy)
            }
            .onChange(of: visibleReaderItemID) { _, id in
                guard let id, viewModel.paragraphSearchText.isEmpty else { return }
                let paragraphID = id.hasPrefix("paragraph-") ? Int(id.dropFirst("paragraph-".count)) : nil
                positionHandler(for: "reader")(ReadingPosition(paragraphID: paragraphID, readerItemID: id))
            }
            .onChange(of: viewModel.paragraphSearchText) { old, new in
                if old.isEmpty && !new.isEmpty { positionBeforeSearch = visibleReaderItemID }
                if new.isEmpty, let positionBeforeSearch { visibleReaderItemID = positionBeforeSearch }
            }
            .onChange(of: viewModel.navigationRequest) { _, request in
                guard let request else { return }
                handledParagraphNavigationID = request.id
                restoreReaderPosition("paragraph-\(request.paragraphID)", using: scrollProxy)
            }
            .onChange(of: isDocumentSidebarPresented) { _, _ in
                restoreReaderPosition(visibleReaderItemID, using: scrollProxy)
            }
            .onChange(of: viewModel.isInspectorPresented) { _, opened in
                let selectedID = opened && viewModel.activeTextSelection?.scope == .reader
                    ? viewModel.activeTextSelection.map { "paragraph-\($0.paragraphID)" } : nil
                restoreReaderPosition(selectedID ?? visibleReaderItemID, using: scrollProxy)
            }
            }
        }
    }

    private func restoreReaderPosition(_ itemID: String?, using proxy: ScrollViewProxy) {
        guard let itemID else { return }
        let checksum = viewModel.loadedPaper?.checksum
        // A remounted ScrollView needs an explicit scroll, even when the binding ID is unchanged.
        DispatchQueue.main.async {
            guard viewModel.workspaceMode == .reader, viewModel.loadedPaper?.checksum == checksum else { return }
            visibleReaderItemID = itemID
            proxy.scrollTo(itemID, anchor: .top)
        }
    }

    private var paperMarkdownPositionKey: String { "paper.markdown.\(viewModel.displayMode.rawValue)" }

    private func positionHandler(for key: String) -> (ReadingPosition) -> Void {
        let checksum = viewModel.loadedPaper?.checksum
        return { position in viewModel.updateReadingPosition(position, key: key, paperChecksum: checksum) }
    }

    private func readerResourceBlock(_ resource: ReaderResourceBlock) -> some View {
        SurfaceCard(contentPadding: 14) {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 8) {
                    Label(resourceDisplayName(resource.kind), systemImage: resourceIcon(resource.kind))
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(PaperBridgeTheme.translationInk)
                    Spacer()
                    Text("PRESERVED FROM SOURCE")
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(.secondary)
                }

                MarkdownPreviewView(
                    markdown: resource.markdown,
                    title: resourceDisplayName(resource.kind),
                    resourceDirectory: viewModel.previewResourceDirectory,
                    presentation: .embedded
                )
                .frame(height: resourcePreviewHeight(resource.kind))
                .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 6, style: .continuous)
                        .strokeBorder(PaperBridgeTheme.border)
                )
            }
        }
    }

    private func resourceDisplayName(_ kind: MarkdownSegmentKind) -> String {
        switch kind {
        case .image:
            return "Figure"
        case .formula:
            return "Formula"
        case .table:
            return "Table"
        case .code:
            return "Code"
        case .rawHTML:
            return "Document Element"
        case .heading, .paragraph, .listItem, .quote, .separator:
            return "Source Element"
        }
    }

    private func resourceIcon(_ kind: MarkdownSegmentKind) -> String {
        switch kind {
        case .image:
            return "photo"
        case .formula:
            return "function"
        case .table:
            return "tablecells"
        case .code:
            return "chevron.left.forwardslash.chevron.right"
        case .rawHTML:
            return "doc.richtext"
        case .heading, .paragraph, .listItem, .quote, .separator:
            return "doc"
        }
    }

    private func resourcePreviewHeight(_ kind: MarkdownSegmentKind) -> CGFloat {
        switch kind {
        case .image:
            return 460
        case .formula:
            return 150
        case .table:
            return 320
        case .code:
            return 240
        case .rawHTML:
            return 300
        case .heading, .paragraph, .listItem, .quote, .separator:
            return 220
        }
    }

    private var displayModePicker: some View {
        Picker("Display", selection: $viewModel.displayMode) {
            ForEach(ReaderDisplayMode.allCases) { mode in
                Text(mode.displayName).tag(mode)
            }
        }
        .pickerStyle(.segmented)
        .labelsHidden()
        .frame(maxWidth: 360)
    }

    private var searchField: some View {
        HStack(spacing: 4) {
            TextField(
                "Search original or translation",
                text: $viewModel.paragraphSearchText
            )
            .textFieldStyle(.roundedBorder)
            .focused($isReaderSearchFocused)
            .task(id: viewModel.searchFocusRequest) {
                guard let request = viewModel.searchFocusRequest,
                      request != handledSearchFocusRequest else { return }
                // Focus only after the Reader tab has mounted its search field.
                await Task.yield()
                guard !Task.isCancelled else { return }
                isReaderSearchFocused = true
                handledSearchFocusRequest = request
            }
            .onExitCommand {
                viewModel.paragraphSearchText = ""
                isReaderSearchFocused = false
            }

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
        .frame(maxWidth: .infinity)
    }

    private var undoButton: some View {
        Button {
            viewModel.undoParagraphEdit()
        } label: {
            Image(systemName: "arrow.uturn.backward")
        }
        .buttonStyle(.bordered)
        .disabled(!viewModel.canUndoParagraphEdit || viewModel.isBusy)
        .help("Undo paragraph repair")
    }

    private var summaryWorkspace: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                statusStrip

                if !viewModel.qualityIssues.isEmpty { ParagraphQualityView(viewModel: viewModel) }

                ReadingGuideView(
                    entries: viewModel.readingGuide,
                    hasText: !viewModel.paragraphResults.isEmpty,
                    translatedCount: viewModel.translatedCount,
                    paragraphCount: viewModel.paragraphResults.count,
                    onRead: { viewModel.workspaceMode = .reader },
                    onOpenSource: {
                        viewModel.workspaceMode = .preview
                        viewModel.displayMode = .sourceOnly
                    },
                    onOpenPassage: viewModel.openReadingPassage
                )

                if let summaries = viewModel.summaries {
                    summaryPanel(summaries)
                } else {
                    generationEmptyState(
                        title: "AI Summary (Optional)",
                        description: "Use a local summary model for a shorter source/target-language overview. Model output can be wrong; use the source map above to verify it.",
                        icon: "list.bullet.rectangle",
                        buttonTitle: viewModel.primarySetupMessage == nil ? "Generate Summary" : "Set Up Summary",
                        isEnabled: viewModel.canSummarize,
                        action: {
                            if viewModel.primarySetupMessage != nil { onShowGettingStarted() }
                            else { viewModel.generateSummaries() }
                        }
                    )
                }
            }
            .padding(22)
            .frame(maxWidth: 1020, alignment: .topLeading)
        }
    }

    private var fullTranslationWorkspace: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                statusStrip

                if let result = viewModel.connectedTranslation,
                   !result.text.isEmpty {
                    fullTranslationPanel(result)
                } else {
                    generationEmptyState(
                        title: "Connected Full Translation",
                        description: fullTranslationWorkspaceDescription,
                        icon: "text.append",
                        buttonTitle: viewModel.translationSetupMessage == nil ? "Generate Full Translation" : "Set Up Translation",
                        isEnabled: viewModel.canGenerateConnectedTranslation,
                        action: {
                            if viewModel.translationSetupMessage != nil { onShowGettingStarted() }
                            else { viewModel.generateConnectedTranslation() }
                        }
                    )
                }
            }
            .padding(22)
            .frame(maxWidth: 1020, alignment: .topLeading)
        }
    }

    private var fullTranslationWorkspaceDescription: String {
        if viewModel.loadedPaper?.hasStructuredMarkdown == true {
            return "Translate the complete MinerU document while preserving headings, formulas, tables, figures, and reading order."
        }
        if viewModel.loadedPaper?.hasFacsimileMarkdown == true {
            return "Translate the selectable text layer while retaining the exact original PDF and page facsimiles as immutable visual context."
        }
        return "Run an optional context-aware second pass that reads larger sections for smoother terminology and transitions."
    }

    @ViewBuilder
    private var statusStrip: some View {
        if let saveError = viewModel.workspaceSaveError {
            Label("Local save failed: \(saveError). Export your work before quitting.", systemImage: "exclamationmark.triangle")
                .font(.callout)
                .foregroundStyle(.red)
                .textSelection(.enabled)
        }
        if viewModel.isBusy || !viewModel.statusMessage.isEmpty {
            SurfaceCard(contentPadding: 14) {
                VStack(alignment: .leading, spacing: viewModel.isBusy ? 9 : 0) {
                    HStack(spacing: 10) {
                        if viewModel.isBusy {
                            ProgressView()
                                .controlSize(.small)
                        } else {
                            Circle()
                                .fill(PaperBridgeTheme.accent)
                                .frame(width: 7, height: 7)
                        }

                        Text(viewModel.statusMessage)
                            .font(.callout.weight(.medium))
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }

                    if viewModel.isBusy {
                        if viewModel.isProgressIndeterminate {
                            ProgressView()
                                .progressViewStyle(.linear)
                                .tint(PaperBridgeTheme.accent)
                        } else {
                            ProgressView(value: viewModel.progressValue)
                                .tint(PaperBridgeTheme.accent)
                        }
                    }
                }
            }
        }
    }

    private func sectionMarker(_ title: String) -> some View {
        HStack(spacing: 12) {
            Text(title)
                .font(.system(size: 21, weight: .semibold, design: .serif))
            Rectangle()
                .fill(PaperBridgeTheme.border)
                .frame(height: 1)
        }
        .padding(.top, 10)
        .accessibilityAddTraits(.isHeader)
    }

    private func paragraphCard(_ paragraph: ParagraphResult) -> some View {
        let isFirst = paragraph.id == viewModel.paragraphResults.first?.id
        let isLast = paragraph.id == viewModel.paragraphResults.last?.id
        let isSelected = paragraph.id == viewModel.selectedParagraphID

        return SurfaceCard(
            isHighlighted: isSelected,
            accent: paragraph.status == .failed ? .red : PaperBridgeTheme.accent,
            contentPadding: 18
        ) {
            VStack(alignment: .leading, spacing: 15) {
                HStack(alignment: .center, spacing: 9) {
                    Text(String(format: "%02d", paragraph.id))
                        .font(.caption.monospacedDigit().weight(.bold))
                        .foregroundStyle(PaperBridgeTheme.accent)

                    if paragraph.status == .failed {
                        Text("FAILED")
                            .font(.caption2.weight(.bold))
                            .foregroundStyle(.red)
                    } else if paragraph.status == .pending {
                        Text("AWAITING TRANSLATION")
                            .font(.caption2.weight(.bold))
                            .foregroundStyle(.secondary)
                    }

                    Spacer()

                    if paragraph.status == .failed {
                        Button {
                            viewModel.retryTranslation(for: paragraph.id)
                        } label: {
                            Image(systemName: "arrow.clockwise")
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                        .help("Retry this paragraph")
                    }

                    Button {
                        viewModel.toggleBookmark(for: paragraph.id)
                    } label: {
                        Image(
                            systemName: viewModel.bookmarkedParagraphIDs.contains(paragraph.id)
                                ? "bookmark.fill"
                                : "bookmark"
                        )
                    }
                    .buttonStyle(.borderless)
                    .help("Toggle bookmark")

                    Button {
                        viewModel.selectParagraphForExplanation(paragraph.id)
                    } label: {
                        Image(systemName: "lightbulb")
                    }
                    .buttonStyle(.borderless)
                    .help("Explain full paragraph")

                    Menu {
                        Button {
                            viewModel.retryTranslation(for: paragraph.id)
                        } label: {
                            Label("Translate This Paragraph", systemImage: "character.book.closed")
                        }

                        Button {
                            viewModel.beginEditingParagraph(paragraph.id)
                        } label: {
                            Label("Edit or Split...", systemImage: "pencil")
                        }
                        .disabled(!viewModel.canEditParagraphStructure)

                        Divider()

                        Button {
                            viewModel.mergeParagraphWithPrevious(paragraph.id)
                        } label: {
                            Label("Merge with Previous", systemImage: "arrow.up.to.line")
                        }
                        .disabled(isFirst || !viewModel.canEditParagraphStructure)

                        Button {
                            viewModel.mergeParagraphWithNext(paragraph.id)
                        } label: {
                            Label("Merge with Next", systemImage: "arrow.down.to.line")
                        }
                        .disabled(isLast || !viewModel.canEditParagraphStructure)

                        Button {
                            viewModel.reflowParagraph(paragraph.id)
                        } label: {
                            Label("Reflow at Full Sentences", systemImage: "text.insert")
                        }
                        .disabled(!viewModel.canEditParagraphStructure)
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                    .menuStyle(.borderlessButton)
                    .fixedSize()
                    .disabled(viewModel.isBusy)
                    .help("Paragraph actions")
                }

                if let issue = viewModel.qualityIssues.first(where: { $0.paragraphID == paragraph.id }) {
                    VStack(alignment: .leading, spacing: 8) {
                        Label(issue.reason, systemImage: "exclamationmark.bubble")
                            .font(.caption).foregroundStyle(.secondary)
                        HStack {
                            Button("Edit or Split") { viewModel.beginEditingParagraph(paragraph.id) }
                                .disabled(!viewModel.canEditParagraphStructure)
                            Button("Compare Original") {
                                viewModel.workspaceMode = .preview
                                viewModel.displayMode = .sourceOnly
                            }
                        }.controlSize(.small)
                        if !viewModel.canEditParagraphStructure && viewModel.loadedPaper?.hasStructuredMarkdown == true {
                            Text("MinerU owns these blocks. Review the PDF or correct an exported Markdown copy; merging here would detach assets.")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }

                if viewModel.displayMode != .translationOnly {
                    VStack(alignment: .leading, spacing: 8) {
                        languageLabel(
                            title: "ORIGINAL",
                            language: viewModel.settings.sourceLanguage,
                            color: PaperBridgeTheme.originalLabel
                        )

                        SelectableAcademicText(
                            text: paragraph.original,
                            paragraphID: paragraph.id,
                            side: .original,
                            annotations: viewModel.annotations(
                                for: paragraph.id,
                                side: .original
                            ),
                            navigationRequest: viewModel.annotationNavigationRequest,
                            onNavigationFailure: viewModel.reportAnnotationNavigationFailure,
                            onSelection: viewModel.captureTextSelection
                        )
                        .frame(maxWidth: .infinity, minHeight: 20)
                    }
                }

                if viewModel.displayMode == .bilingual {
                    Rectangle()
                        .fill(
                            paragraph.status == .ok
                                ? PaperBridgeTheme.translation.opacity(0.24)
                                : PaperBridgeTheme.border
                        )
                        .frame(height: 1)
                }

                if viewModel.displayMode != .sourceOnly {
                    VStack(alignment: .leading, spacing: 8) {
                        languageLabel(
                            title: "TRANSLATION",
                            language: viewModel.settings.targetLanguage,
                            color: paragraph.status == .ok
                                ? PaperBridgeTheme.translationInk
                                : PaperBridgeTheme.originalLabel
                        )

                        if paragraph.status == .ok {
                            SelectableAcademicText(
                                text: paragraph.translation,
                                paragraphID: paragraph.id,
                                side: .translation,
                                annotations: viewModel.annotations(
                                    for: paragraph.id,
                                    side: .translation
                                ),
                                navigationRequest: viewModel.annotationNavigationRequest,
                                onNavigationFailure: viewModel.reportAnnotationNavigationFailure,
                                onSelection: viewModel.captureTextSelection
                            )
                            .frame(maxWidth: .infinity, minHeight: 20)
                        } else if paragraph.status == .failed {
                            Text("Translation failed for this paragraph.")
                                .foregroundStyle(.red)
                                .fontWeight(.semibold)

                            if let errorMessage = paragraph.errorMessage {
                                Text(errorMessage)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .textSelection(.enabled)
                            }
                        } else {
                            HStack {
                                Text("Read first. Translate just this paragraph when you need it.")
                                    .font(.callout)
                                    .foregroundStyle(.secondary)
                                Spacer()
                                Button(viewModel.translationSetupMessage == nil ? "Translate Paragraph" : "Set Up Translation") {
                                    if viewModel.translationSetupMessage != nil { onShowGettingStarted() }
                                    else { viewModel.retryTranslation(for: paragraph.id) }
                                }
                                .buttonStyle(.bordered)
                                .disabled(viewModel.isBusy)
                            }
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(14)
                    .background(
                        paragraph.status == .ok
                            ? PaperBridgeTheme.translationSoft
                            : PaperBridgeTheme.inset,
                        in: RoundedRectangle(cornerRadius: 10, style: .continuous)
                    )
                }
            }
        }
    }

    private func summaryPanel(_ summaries: SummaryResult) -> some View {
        SurfaceCard {
            VStack(alignment: .leading, spacing: 16) {
                Label("Whole-paper Summary", systemImage: "text.book.closed.fill")
                    .font(.title2.weight(.semibold))

                Text("AI-written, not verified research findings. Source links validate the location of a quotation, not whether it proves the model's interpretation.")
                    .font(.callout).foregroundStyle(.secondary)

                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .top, spacing: 18) {
                        textPanel(
                            title: summaries.sourceLanguage.displayName,
                            body: summaries.sourceSummary,
                            scope: .summarySource,
                            side: .original
                        )
                        textPanel(
                            title: summaries.targetLanguage.displayName,
                            body: summaries.targetSummary,
                            scope: .summaryTarget,
                            side: .translation
                        )
                    }

                    VStack(alignment: .leading, spacing: 18) {
                        textPanel(
                            title: summaries.sourceLanguage.displayName,
                            body: summaries.sourceSummary,
                            scope: .summarySource,
                            side: .original
                        )
                        textPanel(
                            title: summaries.targetLanguage.displayName,
                            body: summaries.targetSummary,
                            scope: .summaryTarget,
                            side: .translation
                        )
                    }
                }
                if let claims = summaries.claims {
                    Divider()
                    Text("Check the Sources").font(.headline)
                    ForEach(Array(claims.enumerated()), id: \.element.id) { index, claim in
                        DisclosureGroup("Claim \(index + 1): \(claim.sources.isEmpty ? "No source link validated" : "\(claim.sources.count) source passage(s)")") {
                            VStack(alignment: .leading, spacing: 10) {
                                Text(claim.text).font(.callout).textSelection(.enabled)
                                if claim.sources.isEmpty {
                                    Text("Do not treat this claim as evidence. Check the original paper independently.").font(.caption).foregroundStyle(.secondary)
                                }
                                ForEach(claim.sources, id: \.self) { source in
                                    Text(source.quote).font(.callout).textSelection(.enabled)
                                    Button("Read Original Paragraph \(source.paragraphID)") {
                                        guard viewModel.loadedPaper?.paragraphs.indices.contains(source.paragraphID - 1) == true,
                                              viewModel.loadedPaper?.paragraphs[source.paragraphID - 1].contains(source.quote) == true else { return }
                                        viewModel.workspaceMode = .reader
                                        viewModel.displayMode = .bilingual
                                        viewModel.navigateToParagraph(source.paragraphID)
                                    }
                                }
                            }.padding(.vertical, 8)
                        }
                    }
                } else {
                    Text("This saved summary predates source links. Its claims have not been linked to evidence.").font(.caption).foregroundStyle(.secondary)
                }
            }
        }
    }

    private func fullTranslationPanel(_ result: ConnectedTranslationResult) -> some View {
        SurfaceCard {
            VStack(alignment: .leading, spacing: 14) {
                HStack {
                    Label("Connected Full Translation", systemImage: "text.append")
                        .font(.title2.weight(.semibold))
                    Spacer()
                    Text(result.targetLanguage.displayName)
                        .foregroundStyle(.secondary)
                }

                if result.failedBatchCount > 0 {
                    Text("\(result.failedBatchCount) batch(es) failed and are marked inline.")
                        .font(.caption)
                        .foregroundStyle(.orange)
                }

                if result.isStructuredMarkdown == true {
                    MarkdownPreviewView(
                        markdown: result.text,
                        title: "\(viewModel.loadedPaper?.name ?? "Paper") — \(result.targetLanguage.displayName)",
                        resourceDirectory: viewModel.previewResourceDirectory,
                        selectionScope: .fullTranslation,
                        defaultSelectionSide: .translation,
                        annotations: viewModel.annotations(
                            for: .fullTranslation,
                            side: .translation
                        ),
                        navigationRequest: viewModel.annotationNavigationRequest,
                        readingPosition: viewModel.readingPositions["fullTranslation.markdown"],
                        onPositionChange: positionHandler(for: "fullTranslation.markdown"),
                        onNavigationFailure: viewModel.reportAnnotationNavigationFailure,
                        onSelection: viewModel.captureTextSelection
                    )
                    .id(viewModel.loadedPaper?.checksum)
                    .frame(minHeight: 640)
                    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .strokeBorder(PaperBridgeTheme.border)
                    )
                } else {
                    SelectableAcademicText(
                        text: result.text,
                        paragraphID: 0,
                        side: .translation,
                        annotations: viewModel.annotations(
                            for: .fullTranslation,
                            side: .translation
                        ),
                        font: NSFont(name: "NewYork-Regular", size: 16) ??
                            NSFont.systemFont(ofSize: 16),
                        lineSpacing: 5,
                        scope: .fullTranslation,
                        locator: "full-translation",
                        navigationRequest: viewModel.annotationNavigationRequest,
                        onNavigationFailure: viewModel.reportAnnotationNavigationFailure,
                        onSelection: viewModel.captureTextSelection
                    )
                    .frame(maxWidth: .infinity, minHeight: 20)
                }
            }
        }
    }

    private func generationEmptyState(
        title: String,
        description: String,
        icon: String,
        buttonTitle: String,
        isEnabled: Bool,
        action: @escaping () -> Void
    ) -> some View {
        SurfaceCard {
            VStack(spacing: 14) {
                Image(systemName: icon)
                    .font(.system(size: 30, weight: .medium))
                    .foregroundStyle(PaperBridgeTheme.accent)
                Text(title)
                    .font(.title2.weight(.semibold))
                Text(description)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 540)
                Button(buttonTitle, action: action)
                    .buttonStyle(.borderedProminent)
                    .disabled(viewModel.isBusy || !isEnabled)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 34)
        }
    }

    private func textPanel(
        title: String,
        body: String,
        scope: TextSelectionScope,
        side: ReaderTextSide
    ) -> some View {
        VStack(alignment: .leading, spacing: 9) {
            Text(title.uppercased())
                .font(.caption2.weight(.bold))
                .tracking(0.8)
                .foregroundStyle(
                    side == .translation
                        ? PaperBridgeTheme.translationInk
                        : PaperBridgeTheme.accent
                )

            SelectableAcademicText(
                text: body,
                paragraphID: 0,
                side: side,
                annotations: viewModel.annotations(for: scope, side: side),
                font: NSFont.systemFont(ofSize: NSFont.systemFontSize),
                lineSpacing: 4,
                scope: scope,
                locator: scope.rawValue,
                navigationRequest: viewModel.annotationNavigationRequest,
                onNavigationFailure: viewModel.reportAnnotationNavigationFailure,
                onSelection: viewModel.captureTextSelection
            )
            .frame(maxWidth: .infinity, minHeight: 20)
        }
        .padding(14)
        .background(
            side == .translation
                ? PaperBridgeTheme.translationSoft
                : PaperBridgeTheme.accentSoft,
            in: RoundedRectangle(cornerRadius: 10, style: .continuous)
        )
        .frame(maxWidth: .infinity, alignment: .topLeading)
    }

    private func languageLabel(
        title: String,
        language: ReaderLanguage,
        color: Color
    ) -> some View {
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

    private var emptyState: some View {
        ScrollView {
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .center, spacing: 56) {
                    emptyStateCopy
                    emptyStateWorkflow
                        .frame(width: 370)
                }

                VStack(alignment: .leading, spacing: 34) {
                    emptyStateCopy
                    emptyStateWorkflow
                }
            }
            .frame(maxWidth: 980, alignment: .leading)
            .padding(.horizontal, 52)
            .padding(.vertical, 56)
        }
        .opacity(hasAppeared || reduceMotion ? 1 : 0.84)
        .offset(y: hasAppeared || reduceMotion ? 0 : 12)
    }

    private var emptyStateCopy: some View {
        VStack(alignment: .leading, spacing: 22) {
            AppIconBadge(size: 72)

            Text("Read papers across languages.\nKeep research local.")
                .font(.system(size: 42, weight: .bold, design: .serif))
                .foregroundStyle(PaperBridgeTheme.ink)
                .fixedSize(horizontal: false, vertical: true)

            Text("Open a PDF or paste text to build a private bilingual workspace. PDFKit keeps the original pages intact, while optional MinerU preserves headings, figures, tables, and LaTeX for structured reading.")
                .font(.title3)
                .foregroundStyle(.secondary)
                .lineSpacing(4)
                .frame(maxWidth: 520, alignment: .leading)

            HStack(spacing: 12) {
                Button {
                    viewModel.showImporter()
                } label: {
                    Label("Open Academic PDF", systemImage: "doc.badge.plus")
                        .padding(.horizontal, 8)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)

                Text("or drop a PDF anywhere")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }

            HStack(spacing: 18) {
                Label("Ollama local AI", systemImage: "cpu")
                Label("Recoverable", systemImage: "internaldrive")
                Label("Markdown export", systemImage: "square.and.arrow.down")
            }
            .font(.caption.weight(.medium))
            .foregroundStyle(PaperBridgeTheme.originalLabel)

            HStack(spacing: 12) {
                Button("Try a Practice Paper") { viewModel.loadSamplePaper() }
                    .buttonStyle(.bordered)
                    .disabled(viewModel.isBusy)
                Button("Local AI Setup", action: onShowGettingStarted)
                    .buttonStyle(.borderless)
            }
            Text("You can read and annotate before installing models. The practice paper is fictional and makes no AI requests until you ask.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var emptyStateWorkflow: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("Local reading flow")
                    .font(.system(size: 22, weight: .semibold, design: .serif))
                    .foregroundStyle(PaperBridgeTheme.ink)
                Spacer()
                Circle()
                    .fill(PaperBridgeTheme.success)
                    .frame(width: 8, height: 8)
            }
            .padding(20)

            Divider()

            workflowRow(
                icon: "doc.viewfinder",
                title: "Preserve the paper",
                detail: "Original pages, formulas, figures, and layout",
                color: PaperBridgeTheme.accent
            )
            workflowRow(
                icon: "character.book.closed.fill",
                title: "Bridge the language",
                detail: "Natural bilingual paragraphs with local models",
                color: PaperBridgeTheme.translationButton
            )
            workflowRow(
                icon: "highlighter",
                title: "Study in context",
                detail: "Select, explain, highlight, note, and export",
                color: PaperBridgeTheme.warning
            )

            Text("Paper analysis stays on this Mac")
                .font(.caption.weight(.semibold))
                .foregroundStyle(PaperBridgeTheme.accentDark)
                .padding(.horizontal, 20)
                .padding(.vertical, 14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(PaperBridgeTheme.accentSoft)
        }
        .background(
            PaperBridgeTheme.surface,
            in: RoundedRectangle(cornerRadius: 16, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .strokeBorder(PaperBridgeTheme.border)
        )
    }

    private func workflowRow(
        icon: String,
        title: String,
        detail: String,
        color: Color
    ) -> some View {
        HStack(alignment: .top, spacing: 13) {
            Image(systemName: icon)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 34, height: 34)
                .background(color, in: RoundedRectangle(cornerRadius: 8, style: .continuous))

            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.headline)
                    .foregroundStyle(PaperBridgeTheme.ink)
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 15)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func languagePicker(
        _ label: String,
        selection: Binding<ReaderLanguage>
    ) -> some View {
        HStack {
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
            Spacer()
            Picker(label, selection: selection) {
                ForEach(ReaderLanguage.allCases) { language in
                    Text(language.displayName).tag(language)
                }
            }
            .labelsHidden()
            .frame(maxWidth: 170)
        }
    }

    private func statRow(label: String, value: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label)
                .foregroundStyle(.secondary)
            Spacer()
            Text(value)
                .fontWeight(.medium)
                .multilineTextAlignment(.trailing)
        }
        .font(.callout)
    }

    private func settingBinding<Value>(
        _ keyPath: WritableKeyPath<AppSettings, Value>
    ) -> Binding<Value> {
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

    private var errorBinding: Binding<Bool> {
        Binding(
            get: { viewModel.errorMessage != nil },
            set: { isPresented in
                if !isPresented {
                    viewModel.clearError()
                }
            }
        )
    }
}
