import Foundation

struct MinerUToolStatus: Equatable {
    let executablePath: String?
    let message: String

    var isAvailable: Bool { executablePath != nil }
}

struct MinerUExtraction {
    let markdown: String
    let markdownURL: URL
    let resourceDirectoryURL: URL
    let usedCachedOutput: Bool
}

enum MinerUServiceError: LocalizedError {
    case executableNotFound
    case configuredExecutableInvalid(String)
    case failedToPrepareWorkspace(String)
    case processFailed(Int32, String)
    case noMarkdownOutput(String)
    case unreadableMarkdown(String)

    var errorDescription: String? {
        switch self {
        case .executableNotFound:
            return "MinerU was not found. Install mineru[all], or set its executable path in PaperBridge Settings > Document Parsing."
        case .configuredExecutableInvalid(let path):
            return "The configured MinerU executable is missing or cannot be run: \(path)"
        case .failedToPrepareWorkspace(let details):
            return "PaperBridge could not prepare the local MinerU workspace. \(details)"
        case .processFailed(let status, let details):
            return "MinerU stopped with exit code \(status). \(details)"
        case .noMarkdownOutput(let details):
            return "MinerU finished without producing a readable Markdown file. \(details)"
        case .unreadableMarkdown(let path):
            return "MinerU produced Markdown, but PaperBridge could not read it at \(path)."
        }
    }
}

final class MinerUService {
    private let fileManager: FileManager
    private let workspaceRootOverride: URL?
    private let processLock = NSLock()
    private var activeProcess: Process?

    init(
        fileManager: FileManager = .default,
        workspaceRoot: URL? = nil
    ) {
        self.fileManager = fileManager
        workspaceRootOverride = workspaceRoot
    }

    func status(configuredPath: String) -> MinerUToolStatus {
        do {
            let executable = try resolveExecutable(configuredPath: configuredPath)
            return MinerUToolStatus(
                executablePath: executable.path,
                message: "Ready at \(executable.path)"
            )
        } catch {
            return MinerUToolStatus(executablePath: nil, message: error.localizedDescription)
        }
    }

    func cancelCurrentRun() {
        processLock.lock()
        let process = activeProcess
        processLock.unlock()
        if process?.isRunning == true {
            process?.terminate()
        }
    }

    func extract(
        pdfData: Data,
        originalFilename: String,
        checksum: String,
        configuredPath: String,
        backend: MinerUBackend,
        onProgress: (@Sendable (String) async -> Void)? = nil
    ) async throws -> MinerUExtraction {
        let executable = try resolveExecutable(configuredPath: configuredPath)
        let workspace = try workspaceURLs(
            originalFilename: originalFilename,
            checksum: checksum,
            backend: backend
        )

        if fileManager.fileExists(atPath: workspace.completionMarker.path) {
            if let cached = try findMainMarkdown(
                under: workspace.output,
                preferredStem: workspace.input.deletingPathExtension().lastPathComponent
            ), let extraction = try? loadExtraction(
                markdownURL: cached,
                usedCachedOutput: true
            ) {
                try preserveOriginalPDF(pdfData, beside: cached)
                return extraction
            }
            try? fileManager.removeItem(at: workspace.completionMarker)
        }

        do {
            try fileManager.createDirectory(
                at: workspace.root,
                withIntermediateDirectories: true
            )
            if fileManager.fileExists(atPath: workspace.output.path) {
                try fileManager.removeItem(at: workspace.output)
            }
            try fileManager.createDirectory(
                at: workspace.output,
                withIntermediateDirectories: true
            )
            try pdfData.write(to: workspace.input, options: .atomic)
            if !fileManager.fileExists(atPath: workspace.log.path) {
                fileManager.createFile(atPath: workspace.log.path, contents: nil)
            }
        } catch {
            throw MinerUServiceError.failedToPrepareWorkspace(error.localizedDescription)
        }

        var arguments = ["-p", workspace.input.path, "-o", workspace.output.path]
        if let backendValue = backend.commandLineValue {
            arguments.append(contentsOf: ["-b", backendValue])
        }

        let terminationStatus = try await run(
            executable: executable,
            arguments: arguments,
            logURL: workspace.log,
            onProgress: onProgress
        )
        try Task.checkCancellation()

        guard terminationStatus == 0 else {
            throw MinerUServiceError.processFailed(
                terminationStatus,
                logTail(from: workspace.log)
            )
        }

        guard let markdownURL = try findMainMarkdown(
            under: workspace.output,
            preferredStem: workspace.input.deletingPathExtension().lastPathComponent
        ) else {
            throw MinerUServiceError.noMarkdownOutput(logTail(from: workspace.log))
        }

        try preserveOriginalPDF(pdfData, beside: markdownURL)
        try Data(markdownURL.path.utf8).write(
            to: workspace.completionMarker,
            options: .atomic
        )

        return try loadExtraction(markdownURL: markdownURL, usedCachedOutput: false)
    }

    private func run(
        executable: URL,
        arguments: [String],
        logURL: URL,
        onProgress: (@Sendable (String) async -> Void)?
    ) async throws -> Int32 {
        let process = Process()
        process.executableURL = executable
        process.arguments = arguments
        process.environment = processEnvironment()

        let logHandle = try FileHandle(forWritingTo: logURL)
        try logHandle.truncate(atOffset: 0)
        process.standardOutput = logHandle
        process.standardError = logHandle

        // Read a bounded tail off the main actor; tqdm uses CRs and some workers leave NUL gaps.
        let progressTask = Task.detached(priority: .utility) {
            guard let onProgress else { return }
            var previous: String?
            while !Task.isCancelled {
                if let message = Self.progressMessage(logURL: logURL), message != previous {
                    previous = message
                    await onProgress(message)
                }
                do { try await Task.sleep(for: .seconds(1)) }
                catch { return }
            }
        }
        defer { progressTask.cancel() }

        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                process.terminationHandler = { [weak self] finishedProcess in
                    try? logHandle.close()
                    self?.clearActiveProcess(finishedProcess)
                    continuation.resume(returning: finishedProcess.terminationStatus)
                }

                do {
                    try Task.checkCancellation()
                    setActiveProcess(process)
                    try process.run()
                    if Task.isCancelled { process.terminate() }
                } catch {
                    clearActiveProcess(process)
                    try? logHandle.close()
                    continuation.resume(throwing: error)
                }
            }
        } onCancel: {
            if process.isRunning {
                process.terminate()
            }
        }
    }

    private static func progressMessage(logURL: URL) -> String? {
        guard let handle = try? FileHandle(forReadingFrom: logURL) else { return nil }
        defer { try? handle.close() }
        do {
            let end = try handle.seekToEnd()
            try handle.seek(toOffset: end > 65_536 ? end - 65_536 : 0)
            let data = try handle.read(upToCount: 65_536) ?? Data()
            return progressMessage(in: String(decoding: data, as: UTF8.self))
        } catch { return nil }
    }

    static func progressMessage(in log: String) -> String? {
        let cleaned = log.replacingOccurrences(of: "\u{0}", with: "")
            .replacingOccurrences(of: #"\x1B\[[0-9;?]*[ -/]*[@-~]"#, with: "", options: .regularExpression)
        for line in cleaned.components(separatedBy: .newlines).reversed() {
            let stages = [
                ("Layout Predict", "Recognizing page layout"),
                ("MFR Predict", "Recognizing formulas"),
                ("OCR-det", "Locating text"),
                ("OCR-rec", "Recognizing text"),
                ("Table Predict", "Recognizing tables"),
                ("Processing pages", "Assembling pages")
            ]
            if let stage = stages.first(where: { line.contains($0.0) }) {
                // These are stage counts, not an overall document percentage.
                let counter = line.range(of: #"\b\d+\s*/\s*\d+\b"#, options: .regularExpression)
                    .map { " (\(line[$0]))" } ?? ""
                return "MinerU: \(stage.1)\(counter)..."
            }
            if line.contains("Completed batch") {
                return "MinerU: Finishing document reconstruction..."
            }
            if line.contains("DocAnalysis init") || line.contains("Loading weights") {
                return "MinerU: Loading recognition models..."
            }
            if line.contains("Submitting batch") || line.contains("Started local mineru-api") {
                return "MinerU: Preparing pages for recognition..."
            }
        }
        return nil
    }

    private func resolveExecutable(configuredPath: String) throws -> URL {
        let trimmedPath = configuredPath.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmedPath.isEmpty {
            let expandedPath = NSString(string: trimmedPath).expandingTildeInPath
            guard fileManager.isExecutableFile(atPath: expandedPath) else {
                throw MinerUServiceError.configuredExecutableInvalid(expandedPath)
            }
            return URL(fileURLWithPath: expandedPath)
        }

        let home = fileManager.homeDirectoryForCurrentUser.path
        let pathCandidates = (processEnvironment()["PATH"] ?? "")
            .split(separator: ":")
            .map { String($0) + "/mineru" }
        let commonCandidates = [
            "/opt/homebrew/bin/mineru",
            "/usr/local/bin/mineru",
            "\(home)/.local/bin/mineru",
            "\(home)/.paperbridge-mineru/bin/mineru",
            "\(home)/Library/Python/3.13/bin/mineru",
            "\(home)/Library/Python/3.12/bin/mineru",
            "\(home)/Library/Python/3.11/bin/mineru",
            "\(home)/Library/Python/3.10/bin/mineru"
        ]

        for candidate in pathCandidates + commonCandidates where fileManager.isExecutableFile(atPath: candidate) {
            return URL(fileURLWithPath: candidate)
        }
        throw MinerUServiceError.executableNotFound
    }

    private func workspaceURLs(
        originalFilename: String,
        checksum: String,
        backend: MinerUBackend
    ) throws -> (root: URL, input: URL, output: URL, log: URL, completionMarker: URL) {
        let safeStem = sanitizedFilename(
            URL(fileURLWithPath: originalFilename).deletingPathExtension().lastPathComponent
        )
        let workspaceRoot = workspaceRootOverride ?? defaultWorkspaceRoot()
        let root = workspaceRoot
            .appendingPathComponent(checksum, isDirectory: true)
            .appendingPathComponent(backend.rawValue, isDirectory: true)
        return (
            root,
            root.appendingPathComponent(safeStem + ".pdf"),
            root.appendingPathComponent("output", isDirectory: true),
            root.appendingPathComponent("mineru.log"),
            root.appendingPathComponent(".complete")
        )
    }

    private func defaultWorkspaceRoot() -> URL {
        let applicationSupport = fileManager.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        ).first ?? fileManager.temporaryDirectory
        return applicationSupport
            .appendingPathComponent("PaperBridge", isDirectory: true)
            .appendingPathComponent("MinerU", isDirectory: true)
    }

    private func findMainMarkdown(under root: URL, preferredStem: String) throws -> URL? {
        guard fileManager.fileExists(atPath: root.path),
              let enumerator = fileManager.enumerator(
                at: root,
                includingPropertiesForKeys: [.isRegularFileKey, .fileSizeKey],
                options: [.skipsHiddenFiles]
              ) else { return nil }

        var candidates: [(url: URL, score: Int, size: Int)] = []
        for case let fileURL as URL in enumerator {
            guard fileURL.pathExtension.lowercased() == "md" else { continue }
            let values = try? fileURL.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey])
            guard values?.isRegularFile == true else { continue }
            let stem = fileURL.deletingPathExtension().lastPathComponent.lowercased()
            var score = values?.fileSize ?? 0
            if stem == preferredStem.lowercased() { score += 10_000_000 }
            if stem.contains("full") || stem.contains("content") { score += 1_000_000 }
            candidates.append((fileURL, score, values?.fileSize ?? 0))
        }

        return candidates
            .filter { $0.size > 0 }
            .max { left, right in left.score < right.score }?
            .url
    }

    private func loadExtraction(markdownURL: URL, usedCachedOutput: Bool) throws -> MinerUExtraction {
        guard let markdown = try? String(contentsOf: markdownURL, encoding: .utf8),
              !markdown.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw MinerUServiceError.unreadableMarkdown(markdownURL.path)
        }
        return MinerUExtraction(
            markdown: markdown,
            markdownURL: markdownURL,
            resourceDirectoryURL: markdownURL.deletingLastPathComponent(),
            usedCachedOutput: usedCachedOutput
        )
    }

    private func preserveOriginalPDF(_ pdfData: Data, beside markdownURL: URL) throws {
        let originalPDFURL = markdownURL
            .deletingLastPathComponent()
            .appendingPathComponent("original.pdf")
        if let existing = try? Data(contentsOf: originalPDFURL), existing == pdfData {
            return
        }

        do {
            try pdfData.write(to: originalPDFURL, options: .atomic)
        } catch {
            throw MinerUServiceError.failedToPrepareWorkspace(
                "The exact original PDF could not be preserved beside the MinerU Markdown: \(error.localizedDescription)"
            )
        }
    }

    private func processEnvironment() -> [String: String] {
        var environment = ProcessInfo.processInfo.environment
        let commonPath = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
        if let currentPath = environment["PATH"], !currentPath.isEmpty {
            environment["PATH"] = currentPath + ":" + commonPath
        } else {
            environment["PATH"] = commonPath
        }
        environment["PYTHONUNBUFFERED"] = "1"
        return environment
    }

    private func sanitizedFilename(_ value: String) -> String {
        let sanitized = value
            .replacingOccurrences(of: #"[^A-Za-z0-9._-]+"#, with: "_", options: .regularExpression)
            .trimmingCharacters(in: CharacterSet(charactersIn: "._-"))
        return sanitized.isEmpty ? "paper" : sanitized
    }

    private func logTail(from url: URL) -> String {
        guard let data = try? Data(contentsOf: url), !data.isEmpty else {
            return "Open Settings to verify the MinerU executable and backend."
        }
        let tail = data.suffix(6_000)
        return String(data: tail, encoding: .utf8)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? "MinerU did not provide a readable error log."
    }

    private func setActiveProcess(_ process: Process) {
        processLock.lock()
        activeProcess = process
        processLock.unlock()
    }

    private func clearActiveProcess(_ process: Process) {
        processLock.lock()
        if activeProcess === process {
            activeProcess = nil
        }
        processLock.unlock()
    }
}
