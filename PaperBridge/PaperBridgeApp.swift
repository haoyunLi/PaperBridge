import SwiftUI

@main
struct PaperBridgeApp: App {
    @StateObject private var viewModel = PaperReaderViewModel()

    var body: some Scene {
        WindowGroup("PaperBridge") {
            ContentView(viewModel: viewModel)
                .frame(minWidth: 980, minHeight: 620)
        }
        .defaultSize(width: 1320, height: 820)
        .windowResizability(.contentMinSize)
        .windowStyle(.hiddenTitleBar)
        .commands {
            CommandGroup(replacing: .newItem) {
                Button("Open PDF...") {
                    viewModel.showImporter()
                }
                .keyboardShortcut("o", modifiers: .command)
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

                Button("Export Markdown...") {
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
            SettingsView(viewModel: viewModel)
        }
    }
}
