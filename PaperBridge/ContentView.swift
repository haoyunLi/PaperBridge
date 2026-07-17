import AppKit
import SwiftUI
import UniformTypeIdentifiers

struct ContentView: View {
    private static let compactInspectorBreakpoint: CGFloat = 1_180
    private static let compactInspectorMinHeight: CGFloat = 230
    private static let compactInspectorMaxHeight: CGFloat = 340

    @ObservedObject var viewModel: PaperReaderViewModel
    @State private var isDropTargeted = false
    @State private var isPasteTextExpanded = false
    @FocusState private var isManualInputFocused: Bool

    var body: some View {
        GeometryReader { geometry in
            responsiveRootLayout(
                usesBottomInspector: geometry.size.width < Self.compactInspectorBreakpoint,
                availableHeight: geometry.size.height
            )
        }
        .tint(PaperBridgeTheme.accent)
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
    }

    private func responsiveRootLayout(
        usesBottomInspector: Bool,
        availableHeight: CGFloat
    ) -> some View {
        HSplitView {
            documentSidebar
                .frame(minWidth: 250, idealWidth: 280, maxWidth: 330)

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
                            max(Self.compactInspectorMinHeight, availableHeight * 0.36)
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
                sourceCard

                if let paper = viewModel.loadedPaper {
                    documentCard(paper)
                    outlineCard

                    if !viewModel.bookmarkedParagraphIDs.isEmpty {
                        bookmarksCard
                    }

                    languageCard
                }

                localStatusCard
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
            AppIconBadge(size: 42)

            VStack(alignment: .leading, spacing: 4) {
                Text("PaperBridge")
                    .font(.system(size: 23, weight: .semibold, design: .serif))

                Text("Local academic reader")
                    .font(.caption)
                    .foregroundStyle(.secondary)

                HStack(spacing: 6) {
                    Circle()
                        .fill(PaperBridgeTheme.sidebarAccent)
                        .frame(width: 6, height: 6)
                    Text("LOCAL-ONLY / OLLAMA")
                        .font(.caption2.weight(.bold))
                        .tracking(0.7)
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
                        Text("Paragraph \(paragraphID)")
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
    }

    private var workspaceHeader: some View {
        VStack(alignment: .leading, spacing: 13) {
            HStack(alignment: .center, spacing: 14) {
                AppIconBadge(size: 40)

                VStack(alignment: .leading, spacing: 3) {
                    Text(viewModel.loadedPaper?.name ?? "Untitled Paper")
                        .font(.system(size: 24, weight: .semibold, design: .serif))
                        .lineLimit(1)

                    Text(
                        "\(viewModel.settings.sourceLanguage.displayName) → \(viewModel.settings.targetLanguage.displayName) · \(viewModel.loadedPaper?.extractionEngine?.displayName ?? "Local parser") · \(viewModel.paragraphResults.count) blocks"
                    )
                    .font(.caption)
                    .foregroundStyle(.secondary)
                }

                Spacer()

                OllamaStatusBadge(
                    isRefreshing: viewModel.isRefreshingModels,
                    isAvailable: viewModel.isOllamaReachable
                )

                Button {
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
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 15)
        .background(PaperBridgeTheme.surface)
    }

    private var workspaceModePicker: some View {
        Picker("Workspace", selection: $viewModel.workspaceMode) {
            ForEach(ReaderWorkspaceMode.allCases) { mode in
                Label(mode.displayName, systemImage: mode.systemImage)
                    .tag(mode)
            }
        }
        .pickerStyle(.segmented)
        .labelsHidden()
        .frame(maxWidth: 540)
    }

    @ViewBuilder
    private var primaryActions: some View {
        HStack(spacing: 8) {
            Button {
                viewModel.performPrimaryWorkspaceAction()
            } label: {
                Label(
                    primaryWorkspaceActionTitle,
                    systemImage: primaryWorkspaceActionIcon
                )
            }
            .buttonStyle(.borderedProminent)
            .disabled(!viewModel.canPerformPrimaryWorkspaceAction)

            Menu {
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
                .help("Stop after the current request; progress is saved locally")
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
                    onSelection: viewModel.captureTextSelection
                )
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
                    onSelection: viewModel.captureTextSelection
                )
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
    }

    private var previewWorkspaceDescription: String {
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
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 16) {
                    statusStrip
                    readerControls

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
                            switch item {
                            case .paragraph(let paragraph):
                                if let sectionTitle = TextProcessing.detectedSectionTitle(
                                    in: paragraph.original
                                ) {
                                    sectionMarker(sectionTitle)
                                }

                                paragraphCard(paragraph)
                                    .id(paragraph.id)
                            case .resource(let resource):
                                readerResourceBlock(resource)
                            }
                        }
                    }
                }
                .padding(22)
                .frame(maxWidth: 1020, alignment: .topLeading)
            }
            .scrollIndicators(.visible)
            .onChange(of: viewModel.navigationRequest) { _, request in
                guard let request else { return }
                withAnimation(.easeInOut(duration: 0.25)) {
                    proxy.scrollTo(request.paragraphID, anchor: .top)
                }
            }
        }
    }

    private var readerControls: some View {
        SurfaceCard(contentPadding: 16) {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    VStack(alignment: .leading, spacing: 3) {
                        Text("Paper Reader")
                            .font(.title3.weight(.semibold))
                        Text(readerWorkspaceSubtitle)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    Spacer()

                    HStack(spacing: 8) {
                        MetricPill(
                            title: "Translated",
                            value: "\(viewModel.translatedCount)/\(viewModel.paragraphResults.count)"
                        )
                        if viewModel.failedCount > 0 {
                            MetricPill(title: "Failed", value: "\(viewModel.failedCount)")
                        }
                    }
                }

                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 10) {
                        displayModePicker
                        searchField
                        undoButton
                    }

                    VStack(alignment: .leading, spacing: 10) {
                        displayModePicker
                        searchField
                        undoButton
                    }
                }
            }
        }
    }

    private var readerWorkspaceSubtitle: String {
        if viewModel.loadedPaper?.hasStructuredMarkdown == true {
            return "MinerU paragraph order with figures, tables, and formulas preserved in place. Select text for research tools."
        }
        return "Select text to open translation, explanation, highlight, and note tools."
    }

    private func readerResourceBlock(_ resource: ReaderResourceBlock) -> some View {
        SurfaceCard(contentPadding: 14) {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 8) {
                    Label(resourceDisplayName(resource.kind), systemImage: resourceIcon(resource.kind))
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(PaperBridgeTheme.accent)
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

                if let summaries = viewModel.summaries {
                    summaryPanel(summaries)
                } else {
                    generationEmptyState(
                        title: "Whole-paper Summary",
                        description: "Create faithful summaries in both the source and target languages.",
                        icon: "list.bullet.rectangle",
                        buttonTitle: "Generate Summary",
                        action: viewModel.generateSummaries
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
                        buttonTitle: "Generate Full Translation",
                        action: viewModel.generateConnectedTranslation
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
                            onSelection: viewModel.captureTextSelection
                        )
                        .frame(maxWidth: .infinity, minHeight: 20)
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
                            color: PaperBridgeTheme.accent
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
                            Text("Translation has not started yet.")
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
    }

    private func summaryPanel(_ summaries: SummaryResult) -> some View {
        SurfaceCard {
            VStack(alignment: .leading, spacing: 16) {
                Label("Whole-paper Summary", systemImage: "text.book.closed.fill")
                    .font(.title2.weight(.semibold))

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
                        onSelection: viewModel.captureTextSelection
                    )
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
                    .disabled(viewModel.isBusy)
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
                .foregroundStyle(PaperBridgeTheme.accent)

            SelectableAcademicText(
                text: body,
                paragraphID: 0,
                side: side,
                annotations: viewModel.annotations(for: scope, side: side),
                font: NSFont.systemFont(ofSize: NSFont.systemFontSize),
                lineSpacing: 4,
                scope: scope,
                locator: scope.rawValue,
                onSelection: viewModel.captureTextSelection
            )
            .frame(maxWidth: .infinity, minHeight: 20)
        }
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
        VStack(spacing: 24) {
            AppIconBadge(size: 70)

            VStack(spacing: 9) {
                Text("PRIVATE ACADEMIC WORKSPACE")
                    .font(.caption2.weight(.bold))
                    .tracking(1.2)
                    .foregroundStyle(PaperBridgeTheme.accent)

                Text("Read deeply. Translate locally.")
                    .font(.system(size: 38, weight: .semibold, design: .serif))

                Text("Open a PDF or paste text. Built-in PDFKit can preserve the exact pages without OCR; optional MinerU adds semantic Markdown and LaTeX. Translation stays local in Ollama.")
                    .font(.title3)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 620)
            }

            Button {
                viewModel.showImporter()
            } label: {
                Label("Open Academic PDF", systemImage: "doc.badge.plus")
                    .padding(.horizontal, 8)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)

            HStack(spacing: 20) {
                Label("Drag and drop", systemImage: "hand.draw")
                Label("Local recovery", systemImage: "internaldrive")
                Label("Markdown + assets", systemImage: "doc.plaintext")
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        .padding(.horizontal, 64)
        .padding(.vertical, 52)
        .background(
            PaperBridgeTheme.surface,
            in: RoundedRectangle(cornerRadius: 16, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .strokeBorder(PaperBridgeTheme.border)
        )
        .padding(38)
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
