import SwiftUI

struct SettingsView: View {
    @ObservedObject var viewModel: PaperReaderViewModel
    @State private var isClearConfirmationPresented = false

    var body: some View {
        TabView {
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
        .frame(width: 620, height: 490)
        .padding(18)
        .tint(PaperBridgeTheme.accent)
        .task {
            if !viewModel.hasAvailableModels {
                viewModel.refreshAvailableModels()
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
            Text("This removes saved papers, translations, summaries, highlights, notes, and settings from this Mac. Original PDF files are not changed.")
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
