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
    // Increment only when an onboarding change should be shown once to existing users.
    private static let gettingStartedRevision = 2

    @NSApplicationDelegateAdaptor(PaperBridgeAppDelegate.self)
    private var appDelegate
    @AppStorage("completedGettingStartedRevision")
    private var completedGettingStartedRevision = 0
    @StateObject private var viewModel = PaperBridgeApp.makeViewModel()
    @StateObject private var updateController = AppUpdateController()
    @State private var isGettingStartedPresented = false

    private static func makeViewModel() -> PaperReaderViewModel {
        #if DEBUG
        let arguments = ProcessInfo.processInfo.arguments
        if let index = arguments.firstIndex(of: "--paperbridge-workspace"), index + 1 < arguments.count {
            return PaperReaderViewModel(workspaceStore: WorkspaceStore(rootURL: URL(fileURLWithPath: arguments[index + 1])))
        }
        #endif
        return PaperReaderViewModel()
    }

    var body: some Scene {
        WindowGroup("PaperBridge") {
            ContentView(viewModel: viewModel, onShowGettingStarted: { isGettingStartedPresented = true })
                .frame(minWidth: 980, minHeight: 620)
                .sheet(isPresented: $isGettingStartedPresented) {
                    OnboardingView(
                        viewModel: viewModel,
                        onFinish: finishGettingStarted
                    )
                }
                .task {
                    #if DEBUG
                    if ProcessInfo.processInfo.arguments.contains("--paperbridge-workspace") { return }
                    #endif
                    if completedGettingStartedRevision < Self.gettingStartedRevision {
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
                .disabled(viewModel.isBusy)
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
                Button("Paper Library", action: viewModel.showLibrary)
                    .keyboardShortcut("l", modifiers: [.command, .shift])
                Button("Saved Terminology") { viewModel.isGlossaryPresented = true }
                Divider()
                Button("Show Overview") {
                    viewModel.workspaceMode = .summary
                }
                .keyboardShortcut("1", modifiers: .command)
                .disabled(viewModel.loadedPaper == nil)

                Button("Find in Paper") {
                    viewModel.focusReaderSearch()
                }
                .keyboardShortcut("f", modifiers: .command)
                .disabled(viewModel.loadedPaper == nil)

                Button("Run Current Workspace Task") {
                    if viewModel.primarySetupMessage != nil { isGettingStartedPresented = true }
                    else { viewModel.performPrimaryWorkspaceAction() }
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
                Button("Undo Highlight or Note Change") {
                    viewModel.undoAnnotationChange()
                }
                .disabled(!viewModel.canUndoAnnotationChange)

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
        completedGettingStartedRevision = Self.gettingStartedRevision
        isGettingStartedPresented = false

        guard openPDF else { return }
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(250))
            viewModel.showImporter()
        }
    }
}
