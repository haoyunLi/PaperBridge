import Foundation

private enum LocalSetupError: LocalizedError {
    case ollamaStartupTimedOut

    var errorDescription: String? {
        switch self {
        case .ollamaStartupTimedOut:
            return "Ollama was opened, but its local API did not become ready. Open Ollama once and try Refresh."
        }
    }
}

extension PaperReaderViewModel {
    func isModelInstalled(_ modelID: String) -> Bool {
        availableModels.contains(modelID)
    }

    func isModelSelected(_ model: RecommendedOllamaModel) -> Bool {
        guard isModelInstalled(model.id) else { return false }
        switch model.role {
        case .translation:
            return settings.translationModel == model.id
        case .assistant:
            return settings.summaryModel == model.id &&
                settings.explainModel == model.id &&
                settings.quickLookupModel == model.id
        }
    }

    var isLocalSetupBusy: Bool {
        isInstallingOllama || isPullingModel || isInstallingMinerU
    }

    func refreshLocalSetupStatus() {
        ollamaInstallation = localToolInstaller.ollamaInstallationStatus()
        if ollamaInstallation.isInstalled && !isOllamaReachable {
            ollamaInstallStatus = "Ollama is installed but its local service is not connected."
        } else if ollamaInstallation.isInstalled {
            ollamaInstallStatus = "Ollama is installed and its local API is ready."
        } else {
            ollamaInstallStatus = "Ollama is not installed. PaperBridge can install it for this Mac user."
        }
        refreshAvailableModels()
        refreshMinerUStatus()
    }

    func installOrStartOllama() {
        guard !isLocalSetupBusy else { return }
        ollamaInstallTask?.cancel()
        ollamaInstallError = nil
        ollamaInstallProgress = 0
        isInstallingOllama = true

        ollamaInstallTask = Task { [weak self] in
            guard let self else { return }
            do {
                let applicationURL = try await self.localToolInstaller.installOllama { update in
                    Task { @MainActor [weak self] in
                        self?.ollamaInstallProgress = update.progress
                        self?.ollamaInstallStatus = update.message
                    }
                }
                self.ollamaInstallation = OllamaInstallationStatus(applicationURL: applicationURL)
                self.ollamaInstallProgress = 0.94
                self.ollamaInstallStatus = "Waiting for Ollama's local API..."
                try await self.waitForOllamaToBecomeReady()
                self.ollamaInstallProgress = 1
                self.ollamaInstallStatus = "Ollama is installed and ready."
            } catch is CancellationError {
                self.ollamaInstallStatus = "Ollama setup was cancelled."
                self.ollamaInstallProgress = nil
            } catch {
                self.ollamaInstallError = error.localizedDescription
                self.ollamaInstallStatus = "Ollama setup needs attention."
                self.ollamaInstallProgress = nil
            }
            self.isInstallingOllama = false
            self.ollamaInstallation = self.localToolInstaller.ollamaInstallationStatus()
        }
    }

    func cancelOllamaInstall() {
        ollamaInstallTask?.cancel()
        localToolInstaller.cancelAll()
    }

    func pullOrUseModel(_ model: RecommendedOllamaModel) {
        guard !isLocalSetupBusy else { return }
        if isModelInstalled(model.id) {
            useModel(model)
            modelDownloadProgress = 1
            modelDownloadStatus = selectedModelStatus(for: model)
            modelDownloadError = nil
            return
        }

        guard isOllamaReachable else {
            modelDownloadError = "Start Ollama before downloading a local model."
            return
        }

        modelPullTask?.cancel()
        activeModelDownloadID = model.id
        lastModelDownloadID = model.id
        modelDownloadProgress = nil
        modelDownloadStatus = "Starting the \(model.title) download..."
        modelDownloadError = nil

        modelPullTask = Task { [weak self] in
            guard let self else { return }
            do {
                try await self.ollamaClient.pullModel(
                    baseURL: self.settings.ollamaBaseURL,
                    model: model.id
                ) { progress in
                    Task { @MainActor [weak self] in
                        self?.modelDownloadProgress = progress.fractionCompleted
                        self?.modelDownloadStatus = Self.modelDownloadDescription(progress)
                    }
                }

                let models = try await self.ollamaClient.listModels(baseURL: self.settings.ollamaBaseURL)
                self.availableModels = Array(Set(models)).sorted()
                self.isOllamaReachable = true
                self.useModel(model)
                self.modelDownloadProgress = 1
                self.modelDownloadStatus = "\(model.title) is downloaded. \(self.selectedModelStatus(for: model))"
            } catch is CancellationError {
                self.modelDownloadStatus = "Model download was cancelled. Ollama can resume it later."
                self.modelDownloadProgress = nil
            } catch {
                self.modelDownloadError = error.localizedDescription
                self.modelDownloadStatus = "The model download needs attention."
                self.modelDownloadProgress = nil
            }
            self.activeModelDownloadID = nil
        }
    }

    func cancelModelPull() {
        modelPullTask?.cancel()
    }

    func installManagedMinerU() {
        guard !isLocalSetupBusy else { return }
        minerUInstallTask?.cancel()
        minerUInstallError = nil
        minerUInstallProgress = 0
        minerUInstallStatus = "Preparing the managed MinerU installation..."
        isInstallingMinerU = true

        minerUInstallTask = Task { [weak self] in
            guard let self else { return }
            do {
                let result = try await self.localToolInstaller.installMinerU(
                    prefetchPipelineModels: true
                ) { update in
                    Task { @MainActor [weak self] in
                        self?.minerUInstallProgress = update.progress
                        self?.minerUInstallStatus = update.message
                    }
                }

                self.settings.minerUExecutablePath = result.executableURL.path
                if self.settings.pdfExtractionMode == .pdfKitOnly {
                    self.settings.pdfExtractionMode = .minerUPreferred
                }
                self.minerUInstallProgress = 1
                self.minerUInstallStatus = result.version
                self.minerUInstallError = result.modelDownloadWarning
                self.refreshMinerUStatus()
            } catch is CancellationError {
                self.minerUInstallStatus = "MinerU setup was cancelled. Any previous working installation was kept."
                self.minerUInstallProgress = nil
                self.refreshMinerUStatus()
            } catch {
                self.minerUInstallError = error.localizedDescription
                self.minerUInstallStatus = "MinerU setup needs attention."
                self.minerUInstallProgress = nil
                self.refreshMinerUStatus()
            }
            self.isInstallingMinerU = false
        }
    }

    func cancelMinerUInstall() {
        minerUInstallTask?.cancel()
        localToolInstaller.cancelAll()
    }

    private func waitForOllamaToBecomeReady() async throws {
        for _ in 0..<30 {
            try Task.checkCancellation()
            do {
                let models = try await ollamaClient.listModels(baseURL: settings.ollamaBaseURL)
                availableModels = Array(Set(models)).sorted()
                isOllamaReachable = true
                modelRefreshError = nil
                syncModelSelections(with: availableModels)
                return
            } catch {
                try await Task.sleep(for: .seconds(1))
            }
        }
        isOllamaReachable = false
        throw LocalSetupError.ollamaStartupTimedOut
    }

    private func useModel(_ model: RecommendedOllamaModel) {
        var updatedSettings = settings
        switch model.role {
        case .translation:
            let previousTranslation = updatedSettings.translationModel
            updatedSettings.translationModel = model.id
            let installedModels = Set(availableModels)
            if !installedModels.contains(updatedSettings.summaryModel) ||
                updatedSettings.summaryModel == previousTranslation {
                updatedSettings.summaryModel = model.id
            }
            if !installedModels.contains(updatedSettings.explainModel) ||
                updatedSettings.explainModel == previousTranslation {
                updatedSettings.explainModel = model.id
            }
            if !installedModels.contains(updatedSettings.quickLookupModel) ||
                updatedSettings.quickLookupModel == previousTranslation {
                updatedSettings.quickLookupModel = model.id
            }
        case .assistant:
            updatedSettings.summaryModel = model.id
            updatedSettings.explainModel = model.id
            updatedSettings.quickLookupModel = model.id
        }
        settings = updatedSettings
    }

    private func selectedModelStatus(for model: RecommendedOllamaModel) -> String {
        switch model.role {
        case .translation:
            return "\(model.title) is selected for translation."
        case .assistant:
            return "\(model.title) is selected for summary, explanation, and quick lookup."
        }
    }

    private static func modelDownloadDescription(_ progress: OllamaPullProgress) -> String {
        guard let completed = progress.completed,
              let total = progress.total,
              total > 0 else {
            return progress.isFinished ? "Finishing the model installation..." : progress.status
        }
        let formatter = ByteCountFormatter()
        formatter.countStyle = .file
        return "\(progress.status)  \(formatter.string(fromByteCount: completed)) / \(formatter.string(fromByteCount: total))"
    }
}
