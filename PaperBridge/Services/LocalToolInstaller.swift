import AppKit
import CryptoKit
import Foundation

struct LocalToolInstallUpdate: Equatable, Sendable {
    let progress: Double?
    let message: String
}

struct MinerUInstallResult: Equatable, Sendable {
    let executableURL: URL
    let version: String
    let modelDownloadWarning: String?
}

struct OllamaInstallationStatus: Equatable, Sendable {
    let applicationURL: URL?

    var isInstalled: Bool { applicationURL != nil }
}

enum LocalToolInstallerError: LocalizedError {
    case unsupportedMac
    case invalidDownloadResponse(String)
    case checksumMismatch
    case archiveMissingExecutable
    case processFailed(String, Int32, String)
    case minerUVerificationFailed
    case ollamaDiskImageInvalid
    case ollamaSignatureInvalid(String)
    case ollamaInstallFailed(String)
    case ollamaLaunchFailed(String)

    var errorDescription: String? {
        switch self {
        case .unsupportedMac:
            return "This Mac architecture is not supported by the automatic installer."
        case .invalidDownloadResponse(let address):
            return "The official download did not return a valid file: \(address)"
        case .checksumMismatch:
            return "The downloaded installer failed its security checksum and was not opened."
        case .archiveMissingExecutable:
            return "The verified uv archive did not contain the expected executable."
        case .processFailed(let command, let status, let details):
            return "\(command) stopped with exit code \(status). \(details)"
        case .minerUVerificationFailed:
            return "MinerU installed, but its command could not be verified. The previous installation was kept."
        case .ollamaDiskImageInvalid:
            return "The official Ollama disk image did not contain Ollama.app."
        case .ollamaSignatureInvalid(let details):
            return "The Ollama download failed its Apple signature or notarization check. \(details)"
        case .ollamaInstallFailed(let details):
            return "Ollama could not be installed in your Applications folder. \(details)"
        case .ollamaLaunchFailed(let details):
            return "Ollama is installed, but macOS could not launch it. \(details)"
        }
    }
}

final class LocalToolInstaller {
    static let managedMinerUPath = "~/.paperbridge-mineru/bin/mineru"

    private struct UVArtifact {
        let filename: String
        let checksum: String
    }

    private struct ProcessResult {
        let standardOutput: Data
        let standardError: Data

        var combinedText: String {
            [standardOutput, standardError]
                .compactMap { String(data: $0, encoding: .utf8) }
                .joined(separator: "\n")
                .trimmingCharacters(in: .whitespacesAndNewlines)
        }
    }

    private final class LockedData {
        private let lock = NSLock()
        private var storage = Data()
        private let limit: Int

        init(limit: Int = 8_000_000) {
            self.limit = limit
        }

        func append(_ data: Data) {
            guard !data.isEmpty else { return }
            lock.lock()
            storage.append(data)
            if storage.count > limit {
                storage.removeFirst(storage.count - limit)
            }
            lock.unlock()
        }

        func value() -> Data {
            lock.lock()
            defer { lock.unlock() }
            return storage
        }
    }

    private final class CancellationState {
        private let lock = NSLock()
        private var cancelled = false

        func markCancelled() {
            lock.lock()
            cancelled = true
            lock.unlock()
        }

        var isCancelled: Bool {
            lock.lock()
            defer { lock.unlock() }
            return cancelled
        }
    }

    private let fileManager: FileManager
    private let session: URLSession
    private let processLock = NSLock()
    private var activeProcesses: [UUID: Process] = [:]

    private let uvVersion = "0.11.29"
    private let expectedOllamaBundleIdentifier = "com.electron.ollama"
    private let expectedOllamaTeamIdentifier = "3MU9H2V9Y9"

    init(fileManager: FileManager = .default) {
        self.fileManager = fileManager
        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = 600
        configuration.timeoutIntervalForResource = 21_600
        session = URLSession(configuration: configuration)
    }

    func ollamaInstallationStatus() -> OllamaInstallationStatus {
        let candidates = [
            URL(fileURLWithPath: "/Applications/Ollama.app"),
            fileManager.homeDirectoryForCurrentUser
                .appendingPathComponent("Applications", isDirectory: true)
                .appendingPathComponent("Ollama.app", isDirectory: true)
        ]

        if let applicationURL = candidates.first(where: isValidApplicationBundle) {
            return OllamaInstallationStatus(applicationURL: applicationURL)
        }

        let discovered = NSWorkspace.shared.urlForApplication(
            withBundleIdentifier: expectedOllamaBundleIdentifier
        )
        return OllamaInstallationStatus(
            applicationURL: discovered.flatMap { isValidApplicationBundle($0) ? $0 : nil }
        )
    }

    func launchOllama(at applicationURL: URL) async throws {
        do {
            try await NSWorkspace.shared.openApplication(
                at: applicationURL,
                configuration: NSWorkspace.OpenConfiguration()
            )
        } catch {
            throw LocalToolInstallerError.ollamaLaunchFailed(error.localizedDescription)
        }
    }

    func installOllama(
        update: @escaping @Sendable (LocalToolInstallUpdate) -> Void
    ) async throws -> URL {
        if let existing = ollamaInstallationStatus().applicationURL {
            update(.init(progress: 1, message: "Ollama is installed. Starting it now..."))
            try await launchOllama(at: existing)
            return existing
        }

        update(.init(progress: nil, message: "Downloading Ollama from ollama.com..."))
        let downloadURL = URL(string: "https://ollama.com/download/Ollama.dmg")!
        let diskImageURL = try await download(from: downloadURL)
        defer { try? fileManager.removeItem(at: diskImageURL) }
        try Task.checkCancellation()

        update(.init(progress: 0.55, message: "Opening the verified disk image..."))
        let attachResult = try await runProcess(
            executableURL: URL(fileURLWithPath: "/usr/bin/hdiutil"),
            arguments: ["attach", "-nobrowse", "-readonly", "-plist", diskImageURL.path]
        )
        guard let mountURL = mountURL(from: attachResult.standardOutput) else {
            throw LocalToolInstallerError.ollamaDiskImageInvalid
        }

        do {
            let sourceAppURL = mountURL.appendingPathComponent("Ollama.app", isDirectory: true)
            guard isValidApplicationBundle(sourceAppURL) else {
                throw LocalToolInstallerError.ollamaDiskImageInvalid
            }

            update(.init(progress: 0.66, message: "Verifying Ollama's Apple signature and notarization..."))
            try await verifyOllamaApplication(at: sourceAppURL)
            try Task.checkCancellation()

            update(.init(progress: 0.78, message: "Installing Ollama for this Mac user..."))
            let destinationURL = try installOllamaApplication(from: sourceAppURL)
            try await detachDiskImage(at: mountURL)

            update(.init(progress: 0.92, message: "Starting the local Ollama service..."))
            try await launchOllama(at: destinationURL)
            update(.init(progress: 1, message: "Ollama is installed and starting."))
            return destinationURL
        } catch {
            try? await detachDiskImage(at: mountURL)
            throw error
        }
    }

    func installMinerU(
        prefetchPipelineModels: Bool,
        update: @escaping @Sendable (LocalToolInstallUpdate) -> Void
    ) async throws -> MinerUInstallResult {
        update(.init(progress: 0.03, message: "Preparing the managed MinerU environment..."))
        let uvURL = try await installedUV(update: update)
        let home = fileManager.homeDirectoryForCurrentUser
        let finalEnvironment = home.appendingPathComponent(".paperbridge-mineru", isDirectory: true)
        let stagingEnvironment = home.appendingPathComponent(".paperbridge-mineru.installing", isDirectory: true)
        let backupEnvironment = home.appendingPathComponent(".paperbridge-mineru.backup", isDirectory: true)

        try removeAppManagedItemIfPresent(at: stagingEnvironment)
        try fileManager.createDirectory(
            at: stagingEnvironment.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )

        let environment = installerEnvironment()
        do {
            update(.init(progress: 0.22, message: "Installing an isolated Python 3.12 runtime..."))
            _ = try await runProcess(
                executableURL: uvURL,
                arguments: ["python", "install", "3.12"],
                environment: environment,
                output: processStatusHandler(baseProgress: 0.22, update: update)
            )
            try Task.checkCancellation()

            update(.init(progress: 0.34, message: "Creating the MinerU environment..."))
            _ = try await runProcess(
                executableURL: uvURL,
                arguments: ["venv", "--relocatable", "--python", "3.12", stagingEnvironment.path],
                environment: environment,
                output: processStatusHandler(baseProgress: 0.34, update: update)
            )

            update(.init(progress: 0.45, message: "Installing MinerU and its local parsing components..."))
            _ = try await runProcess(
                executableURL: uvURL,
                arguments: [
                    "pip", "install",
                    "--python", stagingEnvironment.appendingPathComponent("bin/python").path,
                    "--upgrade", "mineru[all]"
                ],
                environment: environment,
                output: processStatusHandler(baseProgress: 0.45, update: update)
            )
            try Task.checkCancellation()

            let stagedExecutable = stagingEnvironment.appendingPathComponent("bin/mineru")
            guard fileManager.isExecutableFile(atPath: stagedExecutable.path) else {
                throw LocalToolInstallerError.minerUVerificationFailed
            }
            _ = try await runProcess(
                executableURL: stagedExecutable,
                arguments: ["--version"],
                environment: environment
            )

            update(.init(progress: 0.75, message: "Activating the verified MinerU installation..."))
            try activateStagedEnvironment(
                stagingEnvironment,
                final: finalEnvironment,
                backup: backupEnvironment
            )

            let executable = finalEnvironment.appendingPathComponent("bin/mineru")
            let finalVerification: ProcessResult
            do {
                guard fileManager.isExecutableFile(atPath: executable.path) else {
                    throw LocalToolInstallerError.minerUVerificationFailed
                }
                finalVerification = try await runProcess(
                    executableURL: executable,
                    arguments: ["--version"],
                    environment: environment
                )
                try removeAppManagedItemIfPresent(at: backupEnvironment)
            } catch {
                try? restoreEnvironmentBackup(final: finalEnvironment, backup: backupEnvironment)
                throw LocalToolInstallerError.minerUVerificationFailed
            }
            let version = finalVerification.combinedText.isEmpty
                ? "MinerU installed"
                : finalVerification.combinedText

            var modelWarning: String?
            if prefetchPipelineModels {
                update(.init(progress: nil, message: "Downloading MinerU pipeline models. This is the largest step..."))
                let modelDownloader = finalEnvironment.appendingPathComponent("bin/mineru-models-download")
                if fileManager.isExecutableFile(atPath: modelDownloader.path) {
                    do {
                        _ = try await runProcess(
                            executableURL: modelDownloader,
                            arguments: ["--source", "auto", "--model_type", "pipeline"],
                            environment: environment,
                            output: processStatusHandler(baseProgress: nil, update: update)
                        )
                    } catch is CancellationError {
                        modelWarning = "MinerU is installed. Pipeline model pre-download was cancelled and will resume when you open a PDF."
                    } catch {
                        modelWarning = "Pipeline model pre-download did not finish. MinerU is installed and will retry when you open a PDF. \(error.localizedDescription)"
                    }
                } else {
                    modelWarning = "MinerU is installed, but its pipeline model downloader was not found. Models will be checked when you open a PDF."
                }
            }

            update(.init(progress: 1, message: "MinerU is ready."))
            return MinerUInstallResult(
                executableURL: executable,
                version: version,
                modelDownloadWarning: modelWarning
            )
        } catch {
            try? removeAppManagedItemIfPresent(at: stagingEnvironment)
            throw error
        }
    }

    func cancelAll() {
        processLock.lock()
        let processes = Array(activeProcesses.values)
        processLock.unlock()
        for process in processes where process.isRunning {
            process.terminate()
        }
    }

    private func installedUV(
        update: @escaping @Sendable (LocalToolInstallUpdate) -> Void
    ) async throws -> URL {
        let artifact = try uvArtifact()
        let toolsRoot = fileManager.homeDirectoryForCurrentUser
            .appendingPathComponent(".paperbridge-tools", isDirectory: true)
        let uvRoot = toolsRoot
            .appendingPathComponent("uv", isDirectory: true)
            .appendingPathComponent(uvVersion, isDirectory: true)
        let installedURL = uvRoot.appendingPathComponent("uv")
        if fileManager.isExecutableFile(atPath: installedURL.path) {
            return installedURL
        }

        update(.init(progress: 0.08, message: "Downloading the verified uv bootstrap..."))
        let base = "https://releases.astral.sh/github/uv/releases/download/\(uvVersion)"
        let archiveURL = try await download(from: URL(string: "\(base)/\(artifact.filename)")!)
        defer { try? fileManager.removeItem(at: archiveURL) }

        guard sha256(of: archiveURL) == artifact.checksum else {
            throw LocalToolInstallerError.checksumMismatch
        }
        try Task.checkCancellation()

        let extractionRoot = fileManager.temporaryDirectory
            .appendingPathComponent("PaperBridge-uv-\(UUID().uuidString)", isDirectory: true)
        defer { try? fileManager.removeItem(at: extractionRoot) }
        try fileManager.createDirectory(at: extractionRoot, withIntermediateDirectories: true)
        _ = try await runProcess(
            executableURL: URL(fileURLWithPath: "/usr/bin/tar"),
            arguments: ["-xzf", archiveURL.path, "-C", extractionRoot.path]
        )

        guard let extractedUV = findExecutable(named: "uv", under: extractionRoot) else {
            throw LocalToolInstallerError.archiveMissingExecutable
        }
        try fileManager.createDirectory(at: uvRoot, withIntermediateDirectories: true)
        try removeAppManagedItemIfPresent(at: installedURL)
        try fileManager.copyItem(at: extractedUV, to: installedURL)
        try fileManager.setAttributes(
            [.posixPermissions: 0o755],
            ofItemAtPath: installedURL.path
        )
        return installedURL
    }

    private func uvArtifact() throws -> UVArtifact {
#if arch(arm64)
        return UVArtifact(
            filename: "uv-aarch64-apple-darwin.tar.gz",
            checksum: "61c04acc52a33ef0f331e494bdfbedcdb6c26c6970c022ed3699e5860f8930e3"
        )
#elseif arch(x86_64)
        return UVArtifact(
            filename: "uv-x86_64-apple-darwin.tar.gz",
            checksum: "c4c4de482da9ccdd076dc4fb5cfe7b740609029385c72f58606be3153602387d"
        )
#else
        throw LocalToolInstallerError.unsupportedMac
#endif
    }

    private func download(from url: URL) async throws -> URL {
        let temporaryURL: URL
        let response: URLResponse
        do {
            (temporaryURL, response) = try await session.download(from: url)
        } catch is CancellationError {
            throw CancellationError()
        } catch let error as URLError where error.code == .cancelled {
            throw CancellationError()
        }
        guard let httpResponse = response as? HTTPURLResponse,
              (200..<300).contains(httpResponse.statusCode) else {
            throw LocalToolInstallerError.invalidDownloadResponse(url.absoluteString)
        }
        return temporaryURL
    }

    private func verifyOllamaApplication(at url: URL) async throws {
        guard Bundle(url: url)?.bundleIdentifier == expectedOllamaBundleIdentifier else {
            throw LocalToolInstallerError.ollamaSignatureInvalid("The bundle identifier was unexpected.")
        }

        do {
            _ = try await runProcess(
                executableURL: URL(fileURLWithPath: "/usr/bin/codesign"),
                arguments: ["--verify", "--deep", "--strict", url.path]
            )
            let details = try await runProcess(
                executableURL: URL(fileURLWithPath: "/usr/bin/codesign"),
                arguments: ["-dvvv", url.path]
            ).combinedText
            guard details.contains("TeamIdentifier=\(expectedOllamaTeamIdentifier)") else {
                throw LocalToolInstallerError.ollamaSignatureInvalid("The signing team was unexpected.")
            }
            _ = try await runProcess(
                executableURL: URL(fileURLWithPath: "/usr/sbin/spctl"),
                arguments: ["--assess", "--type", "execute", "--verbose=4", url.path]
            )
        } catch let error as LocalToolInstallerError {
            throw error
        } catch {
            throw LocalToolInstallerError.ollamaSignatureInvalid(error.localizedDescription)
        }
    }

    private func installOllamaApplication(from sourceURL: URL) throws -> URL {
        let applicationsURL = fileManager.homeDirectoryForCurrentUser
            .appendingPathComponent("Applications", isDirectory: true)
        let destinationURL = applicationsURL.appendingPathComponent("Ollama.app", isDirectory: true)
        let stagingURL = applicationsURL.appendingPathComponent("Ollama.app.installing", isDirectory: true)
        let backupURL = applicationsURL.appendingPathComponent("Ollama.app.backup", isDirectory: true)

        do {
            try fileManager.createDirectory(at: applicationsURL, withIntermediateDirectories: true)
            try removeAppManagedItemIfPresent(at: stagingURL)
            try removeAppManagedItemIfPresent(at: backupURL)
            try fileManager.copyItem(at: sourceURL, to: stagingURL)
            if fileManager.fileExists(atPath: destinationURL.path) {
                try fileManager.moveItem(at: destinationURL, to: backupURL)
            }
            do {
                try fileManager.moveItem(at: stagingURL, to: destinationURL)
                try? removeAppManagedItemIfPresent(at: backupURL)
            } catch {
                if fileManager.fileExists(atPath: backupURL.path),
                   !fileManager.fileExists(atPath: destinationURL.path) {
                    try? fileManager.moveItem(at: backupURL, to: destinationURL)
                }
                throw error
            }
            return destinationURL
        } catch {
            throw LocalToolInstallerError.ollamaInstallFailed(error.localizedDescription)
        }
    }

    private func activateStagedEnvironment(_ staging: URL, final: URL, backup: URL) throws {
        try removeAppManagedItemIfPresent(at: backup)
        if fileManager.fileExists(atPath: final.path) {
            try fileManager.moveItem(at: final, to: backup)
        }
        do {
            try fileManager.moveItem(at: staging, to: final)
        } catch {
            if fileManager.fileExists(atPath: backup.path),
               !fileManager.fileExists(atPath: final.path) {
                try? fileManager.moveItem(at: backup, to: final)
            }
            throw error
        }
    }

    private func restoreEnvironmentBackup(final: URL, backup: URL) throws {
        try removeAppManagedItemIfPresent(at: final)
        if fileManager.fileExists(atPath: backup.path) {
            try fileManager.moveItem(at: backup, to: final)
        }
    }

    private func detachDiskImage(at mountURL: URL) async throws {
        _ = try await runProcess(
            executableURL: URL(fileURLWithPath: "/usr/bin/hdiutil"),
            arguments: ["detach", mountURL.path]
        )
    }

    private func mountURL(from propertyListData: Data) -> URL? {
        guard let propertyList = try? PropertyListSerialization.propertyList(
            from: propertyListData,
            options: [],
            format: nil
        ) as? [String: Any],
        let entities = propertyList["system-entities"] as? [[String: Any]] else {
            return nil
        }
        return entities
            .compactMap { $0["mount-point"] as? String }
            .map { URL(fileURLWithPath: $0, isDirectory: true) }
            .first
    }

    private func installerEnvironment() -> [String: String] {
        let toolsRoot = fileManager.homeDirectoryForCurrentUser
            .appendingPathComponent(".paperbridge-tools", isDirectory: true)
        var environment = ProcessInfo.processInfo.environment
        environment["UV_CACHE_DIR"] = toolsRoot.appendingPathComponent("cache/uv", isDirectory: true).path
        environment["UV_PYTHON_INSTALL_DIR"] = toolsRoot.appendingPathComponent("python", isDirectory: true).path
        environment["UV_PYTHON_INSTALL_BIN"] = "0"
        environment["UV_NO_MODIFY_PATH"] = "1"
        environment["PYTHONUNBUFFERED"] = "1"
        environment["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
        return environment
    }

    private func processStatusHandler(
        baseProgress: Double?,
        update: @escaping @Sendable (LocalToolInstallUpdate) -> Void
    ) -> @Sendable (String) -> Void {
        { output in
            guard let line = Self.lastReadableLine(in: output) else { return }
            update(.init(progress: baseProgress, message: line))
        }
    }

    private func runProcess(
        executableURL: URL,
        arguments: [String],
        environment: [String: String]? = nil,
        output: (@Sendable (String) -> Void)? = nil
    ) async throws -> ProcessResult {
        try Task.checkCancellation()
        let process = Process()
        process.executableURL = executableURL
        process.arguments = arguments
        process.environment = environment

        let stdoutPipe = Pipe()
        let stderrPipe = Pipe()
        let stdout = LockedData()
        let stderr = LockedData()
        process.standardOutput = stdoutPipe
        process.standardError = stderrPipe

        stdoutPipe.fileHandleForReading.readabilityHandler = { handle in
            let data = handle.availableData
            stdout.append(data)
            if let text = String(data: data, encoding: .utf8), !text.isEmpty {
                output?(text)
            }
        }
        stderrPipe.fileHandleForReading.readabilityHandler = { handle in
            let data = handle.availableData
            stderr.append(data)
            if let text = String(data: data, encoding: .utf8), !text.isEmpty {
                output?(text)
            }
        }

        let identifier = UUID()
        let cancellationState = CancellationState()
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                process.terminationHandler = { [weak self] finished in
                    stdoutPipe.fileHandleForReading.readabilityHandler = nil
                    stderrPipe.fileHandleForReading.readabilityHandler = nil
                    stdout.append(stdoutPipe.fileHandleForReading.readDataToEndOfFile())
                    stderr.append(stderrPipe.fileHandleForReading.readDataToEndOfFile())
                    self?.unregisterProcess(identifier)

                    if cancellationState.isCancelled {
                        continuation.resume(throwing: CancellationError())
                        return
                    }

                    let result = ProcessResult(
                        standardOutput: stdout.value(),
                        standardError: stderr.value()
                    )
                    guard finished.terminationStatus == 0 else {
                        let detail = result.combinedText.isEmpty
                            ? "No additional details were returned."
                            : String(result.combinedText.suffix(4_000))
                        continuation.resume(
                            throwing: LocalToolInstallerError.processFailed(
                                executableURL.lastPathComponent,
                                finished.terminationStatus,
                                detail
                            )
                        )
                        return
                    }
                    continuation.resume(returning: result)
                }

                do {
                    registerProcess(process, identifier: identifier)
                    try process.run()
                } catch {
                    unregisterProcess(identifier)
                    stdoutPipe.fileHandleForReading.readabilityHandler = nil
                    stderrPipe.fileHandleForReading.readabilityHandler = nil
                    continuation.resume(throwing: error)
                }
            }
        } onCancel: {
            cancellationState.markCancelled()
            if process.isRunning {
                process.terminate()
            }
        }
    }

    private func registerProcess(_ process: Process, identifier: UUID) {
        processLock.lock()
        activeProcesses[identifier] = process
        processLock.unlock()
    }

    private func unregisterProcess(_ identifier: UUID) {
        processLock.lock()
        activeProcesses.removeValue(forKey: identifier)
        processLock.unlock()
    }

    private func isValidApplicationBundle(_ url: URL) -> Bool {
        fileManager.fileExists(atPath: url.path) &&
            Bundle(url: url)?.bundleIdentifier == expectedOllamaBundleIdentifier
    }

    private func findExecutable(named name: String, under root: URL) -> URL? {
        guard let enumerator = fileManager.enumerator(
            at: root,
            includingPropertiesForKeys: [.isRegularFileKey],
            options: [.skipsHiddenFiles]
        ) else { return nil }

        for case let candidate as URL in enumerator where candidate.lastPathComponent == name {
            let values = try? candidate.resourceValues(forKeys: [.isRegularFileKey])
            if values?.isRegularFile == true {
                return candidate
            }
        }
        return nil
    }

    private func removeAppManagedItemIfPresent(at url: URL) throws {
        if fileManager.fileExists(atPath: url.path) {
            try fileManager.removeItem(at: url)
        }
    }

    private func sha256(of url: URL) -> String? {
        guard let data = try? Data(contentsOf: url, options: .mappedIfSafe) else { return nil }
        return SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    private static func lastReadableLine(in output: String) -> String? {
        let clean = output
            .replacingOccurrences(of: "\u{001B}\\[[0-9;?]*[ -/]*[@-~]", with: "", options: .regularExpression)
            .split(whereSeparator: { $0 == "\n" || $0 == "\r" })
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .last(where: { !$0.isEmpty })
        guard let clean else { return nil }
        return clean.count > 180 ? String(clean.prefix(177)) + "..." : clean
    }
}
