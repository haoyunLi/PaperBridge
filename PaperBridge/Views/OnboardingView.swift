import Foundation
import SwiftUI

struct OnboardingView: View {
    private enum Page: Int, CaseIterable, Identifiable {
        case welcome
        case ollama
        case translation
        case minerU
        case explanation
        case ready

        var id: Int { rawValue }

        var title: String {
            switch self {
            case .welcome: return "Welcome"
            case .ollama: return "Ollama"
            case .translation: return "Translation model"
            case .minerU: return "MinerU parser"
            case .explanation: return "Explanation model"
            case .ready: return "Ready"
            }
        }

        var icon: String {
            switch self {
            case .welcome: return "book.pages"
            case .ollama: return "externaldrive.connected.to.line.below"
            case .translation: return "character.book.closed"
            case .minerU: return "doc.text.magnifyingglass"
            case .explanation: return "sparkles"
            case .ready: return "checkmark.seal"
            }
        }
    }

    @ObservedObject var viewModel: PaperReaderViewModel
    let onFinish: (_ openPDF: Bool) -> Void
    @State private var page: Page = .welcome

    var body: some View {
        HStack(spacing: 0) {
            stepRail
            Divider()

            VStack(spacing: 0) {
                ScrollView {
                    pageContent
                        .frame(maxWidth: .infinity, alignment: .topLeading)
                        .padding(32)
                }
                .scrollIndicators(.visible)

                Divider()
                footer
            }
        }
        .frame(width: 980, height: 730)
        .background(PaperBridgeTheme.canvas)
        .tint(PaperBridgeTheme.accent)
        .interactiveDismissDisabled(viewModel.isLocalSetupBusy)
        .task {
            viewModel.refreshLocalSetupStatus()
        }
    }

    private var stepRail: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 12) {
                AppIconBadge(size: 42)
                VStack(alignment: .leading, spacing: 2) {
                    Text("PaperBridge")
                        .font(.system(size: 19, weight: .semibold, design: .serif))
                    Text("Getting started")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .padding(.bottom, 30)

            ForEach(Page.allCases) { item in
                HStack(spacing: 11) {
                    ZStack {
                        Circle()
                            .fill(stepColor(for: item).opacity(item.rawValue <= page.rawValue ? 1 : 0.10))
                            .frame(width: 30, height: 30)

                        if item.rawValue < page.rawValue {
                            Image(systemName: "checkmark")
                                .font(.caption.weight(.bold))
                                .foregroundStyle(.white)
                        } else {
                            Image(systemName: item.icon)
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(item == page ? .white : .secondary)
                        }
                    }

                    Text(item.title)
                        .font(.callout.weight(item == page ? .semibold : .regular))
                        .foregroundStyle(item.rawValue <= page.rawValue ? PaperBridgeTheme.ink : Color.secondary)
                }
                .padding(.vertical, 9)
            }

            Spacer()

            Label("Documents stay on this Mac", systemImage: "lock.fill")
                .font(.caption.weight(.semibold))
                .foregroundStyle(PaperBridgeTheme.accentDark)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(26)
        .frame(width: 230)
        .frame(maxHeight: .infinity, alignment: .topLeading)
        .background(PaperBridgeTheme.surface)
    }

    @ViewBuilder
    private var pageContent: some View {
        switch page {
        case .welcome:
            welcomePage
        case .ollama:
            ollamaPage
        case .translation:
            translationPage
        case .minerU:
            minerUPage
        case .explanation:
            explanationPage
        case .ready:
            readyPage
        }
    }

    private var welcomePage: some View {
        VStack(alignment: .leading, spacing: 24) {
            pageHeading(
                eyebrow: "FIRST LAUNCH",
                title: "Build your local reading stack.",
                detail: "PaperBridge can set up the local runtime, AI model, and structured PDF parser without Terminal. You stay in control of every download."
            )

            VStack(spacing: 14) {
                HStack(alignment: .top, spacing: 14) {
                    welcomeCard(
                        number: "01",
                        title: "Ollama runtime",
                        detail: "Runs every model locally and exposes the localhost API PaperBridge uses.",
                        icon: "externaldrive.connected.to.line.below"
                    )
                    welcomeCard(
                        number: "02",
                        title: "TranslateGemma",
                        detail: "Choose 4B, 12B, or 27B based on your Mac's memory and desired quality.",
                        icon: "character.book.closed.fill"
                    )
                }

                HStack(alignment: .top, spacing: 14) {
                    welcomeCard(
                        number: "03",
                        title: "MinerU parser",
                        detail: "Optional, but strongly recommended for the best paper structure, figures, tables, and formulas.",
                        icon: "doc.text.magnifyingglass"
                    )
                    welcomeCard(
                        number: "04",
                        title: "Explanation model",
                        detail: "A fully optional specialist for summaries, simpler explanations, and quick lookup.",
                        icon: "sparkles"
                    )
                }
            }

            SurfaceCard(accent: PaperBridgeTheme.accent) {
                HStack(alignment: .top, spacing: 14) {
                    Image(systemName: "network.slash")
                        .font(.title2)
                        .foregroundStyle(PaperBridgeTheme.accent)
                    VStack(alignment: .leading, spacing: 5) {
                        Text("Local after setup")
                            .font(.headline)
                        Text("Internet is used to download tools, models, and signed app updates. PDFs, extracted text, translations, summaries, and explanations are not uploaded.")
                            .font(.callout)
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        }
    }

    private var ollamaPage: some View {
        VStack(alignment: .leading, spacing: 22) {
            pageHeading(
                eyebrow: "REQUIRED FOR LOCAL AI",
                title: "Start with Ollama.",
                detail: "Ollama is the local model runtime. PaperBridge installs the official signed app for your macOS user, or starts an existing installation."
            )

            SurfaceCard(
                isHighlighted: viewModel.isOllamaReachable,
                accent: PaperBridgeTheme.success
            ) {
                VStack(alignment: .leading, spacing: 16) {
                    HStack(spacing: 14) {
                        Image(systemName: viewModel.isOllamaReachable ? "checkmark.circle.fill" : "externaldrive.badge.plus")
                            .font(.system(size: 30))
                            .foregroundStyle(viewModel.isOllamaReachable ? PaperBridgeTheme.success : PaperBridgeTheme.accent)

                        VStack(alignment: .leading, spacing: 4) {
                            Text(ollamaTitle)
                                .font(.title3.weight(.semibold))
                            Text(viewModel.ollamaInstallStatus)
                                .font(.callout)
                                .foregroundStyle(.secondary)
                                .fixedSize(horizontal: false, vertical: true)
                        }

                        Spacer()

                        if viewModel.isInstallingOllama {
                            Button("Cancel", role: .cancel) {
                                viewModel.cancelOllamaInstall()
                            }
                        } else if !viewModel.isOllamaReachable {
                            Button {
                                viewModel.installOrStartOllama()
                            } label: {
                                Label(
                                    viewModel.ollamaInstallation.isInstalled ? "Start Ollama" : "Install Ollama",
                                    systemImage: viewModel.ollamaInstallation.isInstalled ? "play.fill" : "arrow.down.circle.fill"
                                )
                            }
                            .buttonStyle(.borderedProminent)
                            .disabled(viewModel.isLocalSetupBusy)
                        }
                    }

                    if viewModel.isInstallingOllama {
                        if let progress = viewModel.ollamaInstallProgress {
                            ProgressView(value: progress)
                                .progressViewStyle(.linear)
                        } else {
                            ProgressView()
                                .controlSize(.small)
                        }
                    }

                    if let error = viewModel.ollamaInstallError {
                        Label(error, systemImage: "exclamationmark.triangle.fill")
                            .font(.caption)
                            .foregroundStyle(.orange)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    HStack {
                        Label("Installs to ~/Applications", systemImage: "folder")
                        Label("No administrator password", systemImage: "person.badge.key")
                        Spacer()
                        Link("Open official Ollama download", destination: URL(string: "https://ollama.com/download/mac")!)
                    }
                    .font(.caption)
                    .foregroundStyle(.secondary)
                }
            }

            callout(
                title: "Already installed?",
                detail: "Click Start Ollama, then Refresh. PaperBridge connects only to localhost, 127.0.0.1, or ::1.",
                icon: "arrow.clockwise"
            )
        }
    }

    private var translationPage: some View {
        VStack(alignment: .leading, spacing: 20) {
            pageHeading(
                eyebrow: "REQUIRED FOR TRANSLATION",
                title: "Choose a TranslateGemma size.",
                detail: "All three models support the same translation workflow. Larger models use more disk and memory and generally produce stronger translations."
            )

            HStack {
                Label("This Mac: \(physicalMemoryGB) GB memory", systemImage: "desktopcomputer")
                Spacer()
                Label("Suggested: \(suggestedTranslationModel.title)", systemImage: "wand.and.stars")
                    .foregroundStyle(PaperBridgeTheme.accentDark)
            }
            .font(.callout.weight(.semibold))
            .padding(12)
            .background(PaperBridgeTheme.accentSoft, in: RoundedRectangle(cornerRadius: 10))

            ForEach(RecommendedOllamaModel.translationModels) { model in
                modelCard(model)
            }

            if !viewModel.isOllamaReachable {
                Label("Start Ollama on the previous step before downloading a model.", systemImage: "exclamationmark.triangle.fill")
                    .font(.caption)
                    .foregroundStyle(.orange)
            }
        }
    }

    private var minerUPage: some View {
        VStack(alignment: .leading, spacing: 22) {
            pageHeading(
                eyebrow: "OPTIONAL · RECOMMENDED FOR THE BEST EXPERIENCE",
                title: "Turn PDFs into structured papers.",
                detail: "PaperBridge works without MinerU, but installing it gives the bilingual reader a much better understanding of academic layout and reading order."
            )

            SurfaceCard(isHighlighted: true, accent: PaperBridgeTheme.accent) {
                VStack(alignment: .leading, spacing: 12) {
                    HStack(spacing: 10) {
                        Image(systemName: "star.fill")
                            .foregroundStyle(PaperBridgeTheme.accent)
                        Text("Recommended PaperBridge setup")
                            .font(.headline)
                        Spacer()
                        Text("BEST EXPERIENCE")
                            .font(.caption2.weight(.bold))
                            .foregroundStyle(PaperBridgeTheme.accentDark)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(PaperBridgeTheme.accentSoft, in: Capsule())
                    }

                    Label("Restores section hierarchy and multi-column reading order", systemImage: "list.bullet.indent")
                    Label("Keeps figures, captions, tables, and formulas in the correct position", systemImage: "photo.on.rectangle")
                    Label("Produces structured Markdown and stronger bilingual exports", systemImage: "doc.richtext")
                }
                .font(.callout)
            }

            SurfaceCard(
                isHighlighted: viewModel.minerUStatus.isAvailable,
                accent: PaperBridgeTheme.success
            ) {
                VStack(alignment: .leading, spacing: 14) {
                    HStack(alignment: .top, spacing: 14) {
                        Image(systemName: "doc.text.magnifyingglass")
                            .font(.title2)
                            .foregroundStyle(PaperBridgeTheme.accent)

                        VStack(alignment: .leading, spacing: 4) {
                            HStack(spacing: 8) {
                                Text("MinerU structured PDF parser")
                                    .font(.headline)
                                Text("OPTIONAL")
                                    .font(.caption2.weight(.bold))
                                    .foregroundStyle(PaperBridgeTheme.accentDark)
                                    .padding(.horizontal, 7)
                                    .padding(.vertical, 3)
                                    .background(PaperBridgeTheme.accentSoft, in: Capsule())
                            }
                            Text(viewModel.minerUStatus.isAvailable ? "MinerU is ready for structured paper parsing." : "Several-gigabyte local installation. The first setup can take a while.")
                                .font(.callout)
                                .foregroundStyle(.secondary)
                                .fixedSize(horizontal: false, vertical: true)
                        }

                        Spacer()

                        if viewModel.isInstallingMinerU {
                            Button("Cancel", role: .cancel) {
                                viewModel.cancelMinerUInstall()
                            }
                        } else {
                            Button {
                                viewModel.installManagedMinerU()
                            } label: {
                                Label(
                                    viewModel.minerUStatus.isAvailable ? "Update MinerU" : "Install MinerU",
                                    systemImage: "arrow.down.circle.fill"
                                )
                            }
                            .buttonStyle(.borderedProminent)
                            .disabled(viewModel.isLocalSetupBusy)
                        }
                    }

                    if viewModel.isInstallingMinerU {
                        if let progress = viewModel.minerUInstallProgress {
                            ProgressView(value: progress)
                                .progressViewStyle(.linear)
                        } else {
                            ProgressView()
                                .controlSize(.small)
                        }
                        Text(viewModel.minerUInstallStatus)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    if let error = viewModel.minerUInstallError {
                        Label(error, systemImage: "exclamationmark.triangle.fill")
                            .font(.caption)
                            .foregroundStyle(.orange)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }

            callout(
                title: "PDFKit remains available",
                detail: "The built-in fallback preserves and displays the exact original PDF, but MinerU is strongly recommended for more accurate bilingual reading order, paragraph structure, figures, tables, and formulas.",
                icon: "doc.viewfinder"
            )
        }
    }

    private var explanationPage: some View {
        VStack(alignment: .leading, spacing: 22) {
            pageHeading(
                eyebrow: "OPTIONAL AI ENHANCEMENT",
                title: "Choose a specialist explainer.",
                detail: "This download is completely optional. TranslateGemma can already summarize and explain; a compact general model can make those tasks faster or more capable."
            )

            HStack {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Explanation models")
                        .font(.title3.weight(.semibold))
                    Text("Used for Summary, Explain, and selected-text lookup")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Text("OPTIONAL")
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(PaperBridgeTheme.translationInk)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(PaperBridgeTheme.translationSoft, in: Capsule())
            }

            ForEach(RecommendedOllamaModel.assistantModels) { model in
                modelCard(model)
            }

            callout(
                title: "Safe to skip",
                detail: "If no separate explanation model is installed, PaperBridge automatically continues using your selected TranslateGemma model for summaries and explanations.",
                icon: "forward.fill"
            )
        }
    }

    private var readyPage: some View {
        VStack(alignment: .leading, spacing: 24) {
            pageHeading(
                eyebrow: "SETUP SUMMARY",
                title: "Your local reader is ready.",
                detail: "You can change models, update MinerU, or run this guide again at any time from PaperBridge > PaperBridge Getting Started."
            )

            SurfaceCard(isHighlighted: requiredSetupReady, accent: PaperBridgeTheme.success) {
                VStack(alignment: .leading, spacing: 16) {
                    readinessRow(
                        title: "Ollama runtime",
                        detail: viewModel.isOllamaReachable ? "Connected to the local API" : "Not connected; local AI actions will wait",
                        isReady: viewModel.isOllamaReachable,
                        isOptional: false
                    )
                    readinessRow(
                        title: "Translation model",
                        detail: selectedTranslationDescription,
                        isReady: hasInstalledTranslationModel,
                        isOptional: false
                    )
                    readinessRow(
                        title: "MinerU parser",
                        detail: viewModel.minerUStatus.isAvailable ? "Structured PDF parsing enabled" : "Not installed; PDFKit fallback is available, but MinerU is recommended",
                        isReady: viewModel.minerUStatus.isAvailable,
                        isOptional: true
                    )
                    readinessRow(
                        title: "Explanation model",
                        detail: selectedAssistantDescription,
                        isReady: hasInstalledAssistantModel,
                        isOptional: true
                    )
                }
            }

            callout(
                title: "Nothing is locked in",
                detail: "Open Settings > Local AI to download another model, and Settings > Models to assign a different model to each task.",
                icon: "slider.horizontal.3"
            )
        }
    }

    private var footer: some View {
        HStack(spacing: 12) {
            if page != .ready && page != .minerU && page != .explanation {
                Button("Skip setup") {
                    onFinish(false)
                }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
                .disabled(viewModel.isLocalSetupBusy)
            }

            Spacer()

            if page != .welcome {
                Button("Back") {
                    movePage(by: -1)
                }
                .disabled(viewModel.isLocalSetupBusy)
            }

            Button {
                if page == .ready {
                    onFinish(true)
                } else {
                    movePage(by: 1)
                }
            } label: {
                Label(
                    page == .ready ? "Finish & Open PDF" : "Continue",
                    systemImage: page == .ready ? "doc.badge.plus" : "arrow.right"
                )
            }
            .buttonStyle(.borderedProminent)
            .disabled(viewModel.isLocalSetupBusy)
            .keyboardShortcut(.defaultAction)
        }
        .padding(.horizontal, 26)
        .padding(.vertical, 16)
        .background(PaperBridgeTheme.surface)
    }

    private func modelCard(_ model: RecommendedOllamaModel) -> some View {
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

    private func pageHeading(eyebrow: String, title: String, detail: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(eyebrow)
                .font(.caption.weight(.bold))
                .tracking(1.4)
                .foregroundStyle(PaperBridgeTheme.accent)
            Text(title)
                .font(.system(size: 34, weight: .semibold, design: .serif))
                .foregroundStyle(PaperBridgeTheme.ink)
            Text(detail)
                .font(.title3)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func welcomeCard(number: String, title: String, detail: String, icon: String) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(number)
                    .font(.caption.weight(.bold))
                    .foregroundStyle(PaperBridgeTheme.accent)
                Spacer()
                Image(systemName: icon)
                    .foregroundStyle(PaperBridgeTheme.translation)
            }
            Text(title)
                .font(.headline)
            Text(detail)
                .font(.callout)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(16)
        .frame(maxWidth: .infinity, minHeight: 142, alignment: .topLeading)
        .background(PaperBridgeTheme.surface, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(PaperBridgeTheme.border))
    }

    private func callout(title: String, detail: String, icon: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon)
                .foregroundStyle(PaperBridgeTheme.accent)
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.callout.weight(.semibold))
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(14)
        .background(PaperBridgeTheme.accentSoft.opacity(0.75), in: RoundedRectangle(cornerRadius: 10))
    }

    private func readinessRow(title: String, detail: String, isReady: Bool, isOptional: Bool) -> some View {
        HStack(spacing: 12) {
            Image(systemName: isReady ? "checkmark.circle.fill" : (isOptional ? "minus.circle" : "exclamationmark.circle.fill"))
                .foregroundStyle(isReady ? PaperBridgeTheme.success : (isOptional ? Color.secondary : Color.orange))
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 7) {
                    Text(title)
                        .fontWeight(.semibold)
                    if isOptional {
                        Text("Optional")
                            .font(.caption2.weight(.bold))
                            .foregroundStyle(.secondary)
                    }
                }
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func stepColor(for item: Page) -> Color {
        if item.rawValue < page.rawValue { return PaperBridgeTheme.success }
        if item == page { return PaperBridgeTheme.accent }
        return .secondary
    }

    private func movePage(by offset: Int) {
        let nextValue = min(max(page.rawValue + offset, 0), Page.allCases.count - 1)
        guard let next = Page(rawValue: nextValue) else { return }
        withAnimation(.easeInOut(duration: 0.18)) {
            page = next
        }
    }

    private var ollamaTitle: String {
        if viewModel.isOllamaReachable { return "Ollama is ready" }
        if viewModel.ollamaInstallation.isInstalled { return "Ollama is installed" }
        return "Install the Ollama runtime"
    }

    private var physicalMemoryGB: Int {
        Int((Double(ProcessInfo.processInfo.physicalMemory) / 1_073_741_824).rounded())
    }

    private var suggestedTranslationModel: RecommendedOllamaModel {
        if physicalMemoryGB >= 32 {
            return RecommendedOllamaModel.translationModels[2]
        }
        if physicalMemoryGB >= 16 {
            return RecommendedOllamaModel.translationModels[1]
        }
        return RecommendedOllamaModel.translationModels[0]
    }

    private var hasInstalledTranslationModel: Bool {
        RecommendedOllamaModel.translationModels.contains { viewModel.isModelInstalled($0.id) }
    }

    private var hasInstalledAssistantModel: Bool {
        RecommendedOllamaModel.assistantModels.contains { viewModel.isModelInstalled($0.id) }
    }

    private var requiredSetupReady: Bool {
        viewModel.isOllamaReachable && hasInstalledTranslationModel
    }

    private var selectedTranslationDescription: String {
        if viewModel.isModelInstalled(viewModel.settings.translationModel) {
            return viewModel.settings.translationModel
        }
        return "No downloaded translation model selected"
    }

    private var selectedAssistantDescription: String {
        if viewModel.isModelInstalled(viewModel.settings.explainModel),
           viewModel.settings.explainModel != viewModel.settings.translationModel {
            return viewModel.settings.explainModel
        }
        return "Using the translation model; a separate explainer is not required"
    }
}
