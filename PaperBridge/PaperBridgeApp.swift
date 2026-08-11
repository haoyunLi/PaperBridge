import AppKit
import SwiftUI

final class PaperBridgeAppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        let bundledIcon = Bundle.main
            .url(forResource: "AppIcon", withExtension: "icns")
            .flatMap(NSImage.init(contentsOf:))
        let fallbackIcon = NSImage(named: "BrandMark")

        if let icon = bundledIcon ?? fallbackIcon {
            NSApplication.shared.applicationIconImage = icon
        }
    }
}

@main
struct PaperBridgeApp: App {
    @NSApplicationDelegateAdaptor(PaperBridgeAppDelegate.self)
    private var appDelegate
    @AppStorage("hasCompletedGettingStartedV1")
    private var hasCompletedGettingStarted = false
    @StateObject private var viewModel = PaperReaderViewModel()
    @StateObject private var updateController = AppUpdateController()
    @State private var isGettingStartedPresented = false

    var body: some Scene {
        WindowGroup("PaperBridge") {
            ContentView(viewModel: viewModel)
                .frame(minWidth: 980, minHeight: 620)
                .sheet(isPresented: $isGettingStartedPresented) {
                    OnboardingView(
                        viewModel: viewModel,
                        onFinish: finishGettingStarted
                    )
                }
                .task {
                    if !hasCompletedGettingStarted {
                        isGettingStartedPresented = true
                    }
                }
        }
        .defaultSize(width: 1320, height: 820)
        .windowResizability(.contentMinSize)
        .commands {
            CommandGroup(replacing: .newItem) {
                Button("Open PDF...") {
                    viewModel.showImporter()
                }
                .keyboardShortcut("o", modifiers: .command)
            }

            CommandGroup(after: .appInfo) {
                Button("PaperBridge Getting Started…") {
                    isGettingStartedPresented = true
                }

                Button("Check for Updates…") {
                    updateController.checkForUpdates()
                }
                .disabled(!updateController.canCheckForUpdates)
            }

            CommandMenu("Paper") {
                Button("Run Current Workspace Task") {
                    viewModel.performPrimaryWorkspaceAction()
                }
                .keyboardShortcut(.return, modifiers: .command)
                .disabled(!viewModel.canPerformPrimaryWorkspaceAction)

                Button("Generate Summary") {
                    viewModel.workspaceMode = .summary
                    viewModel.generateSummaries()
                }
                .disabled(!viewModel.canSummarize)

                Button("Generate Full Translation") {
                    viewModel.workspaceMode = .fullTranslation
                    viewModel.generateConnectedTranslation()
                }
                .disabled(!viewModel.canGenerateConnectedTranslation)

                Divider()

                Button("Export Markdown or Bundle...") {
                    viewModel.prepareMarkdownExport()
                }
                .keyboardShortcut("e", modifiers: [.command, .shift])
                .disabled(!viewModel.canExport)

                Button("Show Research Inspector") {
                    viewModel.isInspectorPresented = true
                }
                .keyboardShortcut("i", modifiers: [.command, .shift])
            }

            CommandMenu("Selection") {
                Button("Translate Selection") {
                    viewModel.translateTextSelection()
                }
                .keyboardShortcut("t", modifiers: [.command, .shift])
                .disabled(!viewModel.canLookupSelection)

                Button("Explain Selection") {
                    viewModel.explainTextSelection()
                }
                .keyboardShortcut("e", modifiers: [.command, .option])
                .disabled(!viewModel.canLookupSelection)

                Button("Highlight Selection") {
                    viewModel.applyHighlight(.amber)
                }
                .keyboardShortcut("h", modifiers: [.command, .shift])
                .disabled(viewModel.activeTextSelection == nil)
            }
        }

        Settings {
            SettingsView(
                viewModel: viewModel,
                updateController: updateController,
                onShowGettingStarted: {
                    isGettingStartedPresented = true
                }
            )
        }
    }

    private func finishGettingStarted(openPDF: Bool) {
        hasCompletedGettingStarted = true
        isGettingStartedPresented = false

        guard openPDF else { return }
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(250))
            viewModel.showImporter()
        }
    }
}
