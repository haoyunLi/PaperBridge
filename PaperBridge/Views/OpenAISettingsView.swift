import SwiftUI

struct OpenAISettingsView: View {
    @ObservedObject var viewModel: PaperReaderViewModel
    @State private var apiKeyInput = ""

    private var isEditingDisabled: Bool {
        viewModel.isBusy || viewModel.isSelectionLookupBusy
    }

    private var isKeyEditingDisabled: Bool {
        isEditingDisabled || viewModel.isRefreshingOpenAIModels
    }

    var body: some View {
        VStack(spacing: 10) {
            if let error = viewModel.openAIError {
                Label {
                    Text(error)
                        .foregroundStyle(PaperBridgeTheme.ink)
                } icon: {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundStyle(.orange)
                }
                .font(.caption)
                .fixedSize(horizontal: false, vertical: true)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(12)
                .background(
                    PaperBridgeTheme.surface,
                    in: RoundedRectangle(cornerRadius: 10, style: .continuous)
                )
                .accessibilityLabel("OpenAI error: \(error)")
            }

            Form {
                apiKeySection
                consentSection
                modelsSection
                privacySection
            }
            .formStyle(.grouped)
        }
        .onAppear {
            // Check only local Keychain status; model discovery is always explicit.
            viewModel.checkOpenAIKeyStatus()
        }
        .onDisappear {
            apiKeyInput = ""
        }
    }

    private var apiKeySection: some View {
        Section("OpenAI API Key") {
            Label(
                viewModel.hasOpenAIAPIKey ? "Key saved on this Mac" : "No saved API key",
                systemImage: viewModel.hasOpenAIAPIKey ? "key.fill" : "key"
            )
            .foregroundStyle(PaperBridgeTheme.accentDark)

            SecureField("New OpenAI API key", text: $apiKeyInput)
                .font(.system(.body, design: .monospaced))
                .privacySensitive()
                .onSubmit(saveAPIKey)
                .disabled(isKeyEditingDisabled)

            HStack {
                Button(viewModel.hasOpenAIAPIKey ? "Replace Saved Key" : "Save Key") {
                    saveAPIKey()
                }
                .buttonStyle(.borderedProminent)
                .disabled(isKeyEditingDisabled || apiKeyInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

                Button("Remove Key", role: .destructive) {
                    apiKeyInput = ""
                    viewModel.removeOpenAIAPIKey()
                }
                .disabled(isKeyEditingDisabled || !viewModel.hasOpenAIAPIKey)

                Spacer()
                Link("Manage API keys", destination: URL(string: "https://platform.openai.com/api-keys")!)
            }

            detail("Stored in the local macOS Keychain (iCloud synchronization disabled), never in settings or exports. Normal Mac backup or migration can include the Keychain. macOS may prompt for access again after rebuilding the app. The entry field clears after saving or leaving this view. Saving a key does not send paper text or test a model.")
        }
    }

    private var consentSection: some View {
        Section("Permission for This Session") {
            detail("Selection requests send selected text, nearby context, the paper title, and matching saved terminology to OpenAI. Full translation and summary send the full extracted paper text in batches. PDF files and images are not uploaded.")

            Toggle("I allow this text to be sent to OpenAI for this session", isOn: $viewModel.isOpenAIOptInConfirmed)
                .disabled(viewModel.isBusy && !viewModel.isOpenAIOptInConfirmed)

            detail("Consent is not saved across app launches. Turning it off stops active OpenAI requests, but cannot recall text already sent. You can also revoke consent in the settings header while a task is running.")
            detail("OpenAI API usage is paid separately from ChatGPT. No request is sent just by enabling consent, and PaperBridge never falls back to the cloud automatically.")
        }
    }

    private var modelsSection: some View {
        Section("OpenAI Task Models") {
            HStack {
                Button {
                    viewModel.refreshOpenAIModels()
                } label: {
                    Label("Refresh Available Models", systemImage: "arrow.clockwise")
                }
                .disabled(isEditingDisabled || !viewModel.hasOpenAIAPIKey || viewModel.isRefreshingOpenAIModels)

                if viewModel.isRefreshingOpenAIModels {
                    ProgressView()
                        .controlSize(.small)
                        .accessibilityLabel("Refreshing available OpenAI models")
                }
            }

            detail("Refresh calls GET /v1/models only: no inference and no paper text. The list is not capability or pricing data. Choose a model your API project can access that supports text through the Responses API, or enter its ID manually. No model is selected automatically.")

            if !viewModel.openAIStatus.isEmpty {
                detail(viewModel.openAIStatus)
                    .textSelection(.enabled)
            }

            Group {
                modelPicker("Translation", selection: settingBinding(\.openAITranslationModel))
                modelPicker("Summary", selection: settingBinding(\.openAISummaryModel))
                modelPicker("Paragraph explanation", selection: settingBinding(\.openAIExplainModel))
                modelPicker("Quick lookup", selection: settingBinding(\.openAIQuickLookupModel))

                Button("Use Translation Model for All Tasks") {
                    let model = viewModel.settings.openAITranslationModel.trimmingCharacters(in: .whitespacesAndNewlines)
                    viewModel.settings.openAISummaryModel = model
                    viewModel.settings.openAIExplainModel = model
                    viewModel.settings.openAIQuickLookupModel = model
                }
                .disabled(viewModel.settings.openAITranslationModel.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
            .disabled(isEditingDisabled)

            detail("Each task uses its chosen model; an empty field is unconfigured, not a fallback. Quick lookup handles selected-text translation and explanation. Optional translation instructions are under Settings > Reading > Translation Style Guide.")
        }
    }

    private var privacySection: some View {
        Section("Data and Costs") {
            detail("Text requests use the Responses API with store: false. This does not mean zero retention: abuse-monitoring logs and other applicable retention policies may still apply. Review OpenAI's data controls before sending sensitive or unpublished work.")
            detail("Costs depend on the model and text processed. Whole-paper tasks can make multiple paid requests. Check your API project's usage and billing; a ChatGPT subscription does not cover this API usage.")

            HStack(spacing: 20) {
                Link("OpenAI data controls", destination: URL(string: "https://developers.openai.com/api/docs/guides/your-data")!)
                Link("API usage and costs", destination: URL(string: "https://platform.openai.com/usage")!)
            }
        }
    }

    private func modelPicker(_ title: String, selection: Binding<String>) -> some View {
        let options = Array(Set(viewModel.openAIModels + [selection.wrappedValue]))
            .filter { !$0.isEmpty }
            .sorted()

        return VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .fontWeight(.medium)

            HStack(spacing: 12) {
                Picker("Available models", selection: selection) {
                    Text("Choose a model").tag("")
                    ForEach(options, id: \.self) { model in
                        Text(model).tag(model)
                    }
                }
                .labelsHidden()
                .accessibilityLabel("\(title) available models")
                .frame(maxWidth: .infinity)

                TextField("Manual model ID", text: selection)
                    .font(.system(.body, design: .monospaced))
                    .accessibilityLabel("\(title) model ID")
                    .frame(maxWidth: .infinity)
            }
        }
    }

    private func saveAPIKey() {
        let key = apiKeyInput.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !isKeyEditingDisabled, !key.isEmpty else { return }
        apiKeyInput = ""
        viewModel.saveOpenAIAPIKey(key)
    }

    private func detail(_ text: String) -> some View {
        Text(text)
            .font(.caption)
            .foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)
    }

    private func settingBinding(_ keyPath: WritableKeyPath<AppSettings, String>) -> Binding<String> {
        Binding(
            get: { viewModel.settings[keyPath: keyPath] },
            set: { viewModel.settings[keyPath: keyPath] = $0 }
        )
    }
}
