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
    var hasRecommendedModel: Bool {
        availableModels.contains(AppSettings.recommendedLocalModel)
    }

    var isLocalSetupBusy: Bool {
        isInstallingOllama || isPullingRecommendedModel || isInstallingMinerU
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

    func pullOrUseRecommendedModel() {
        guard !isLocalSetupBusy else { return }
        if hasRecommendedModel {
            useRecommendedModelForAllTasks()
            recommendedModelProgress = 1
            recommendedModelStatus = "TranslateGemma 4B is selected for all local AI tasks."
            recommendedModelError = nil
            return
        }

        recommendedModelPullTask?.cancel()
        isPullingRecommendedModel = true
        recommendedModelProgress = nil
        recommendedModelStatus = "Starting the TranslateGemma 4B download..."
        recommendedModelError = nil

        recommendedModelPullTask = Task { [weak self] in
            guard let self else { return }
            do {
                try await self.ollamaClient.pullModel(
                    baseURL: self.settings.ollamaBaseURL,
                    model: AppSettings.recommendedLocalModel
                ) { progress in
                    Task { @MainActor [weak self] in
                        self?.recommendedModelProgress = progress.fractionCompleted
                        self?.recommendedModelStatus = Self.modelDownloadDescription(progress)
                    }
                }

                let models = try await self.ollamaClient.listModels(baseURL: self.settings.ollamaBaseURL)
                self.availableModels = Array(Set(models)).sorted()
                self.isOllamaReachable = true
                self.useRecommendedModelForAllTasks()
                self.recommendedModelProgress = 1
                self.recommendedModelStatus = "TranslateGemma 4B is downloaded and selected."
            } catch is CancellationError {
                self.recommendedModelStatus = "Model download was cancelled. Ollama can resume it later."
                self.recommendedModelProgress = nil
            } catch {
                self.recommendedModelError = error.localizedDescription
                self.recommendedModelStatus = "The model download needs attention."
                self.recommendedModelProgress = nil
            }
            self.isPullingRecommendedModel = false
        }
    }

    func cancelRecommendedModelPull() {
        recommendedModelPullTask?.cancel()
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

    private func useRecommendedModelForAllTasks() {
        var updatedSettings = settings
        updatedSettings.translationModel = AppSettings.recommendedLocalModel
        updatedSettings.summaryModel = AppSettings.recommendedLocalModel
        updatedSettings.explainModel = AppSettings.recommendedLocalModel
        updatedSettings.quickLookupModel = AppSettings.recommendedLocalModel
        settings = updatedSettings
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
