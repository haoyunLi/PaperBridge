import Foundation

struct MarkdownBundleExportResult {
    let directoryURL: URL
    let copiedAssetCount: Int
    let missingAssetPaths: [String]
}

enum MarkdownBundleExporterError: LocalizedError {
    case noDocuments
    case failed(String)

    var errorDescription: String? {
        switch self {
        case .noDocuments:
            return "There is no Markdown content to export."
        case .failed(let details):
            return "The Markdown bundle could not be exported. \(details)"
        }
    }
}

struct MarkdownBundleExporter {
    private let fileManager: FileManager

    init(fileManager: FileManager = .default) {
        self.fileManager = fileManager
    }

    func export(
        paperName: String,
        documents: [String: String],
        assetSourceDirectory: URL?,
        to parentDirectory: URL
    ) throws -> MarkdownBundleExportResult {
        let nonemptyDocuments = documents.filter {
            !$0.value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
        guard !nonemptyDocuments.isEmpty else {
            throw MarkdownBundleExporterError.noDocuments
        }

        let folderStem = sanitizedFilename(
            URL(fileURLWithPath: paperName).deletingPathExtension().lastPathComponent
        ) + "_PaperBridge"
        let destination = uniqueDirectory(
            parent: parentDirectory,
            preferredName: folderStem
        )

        do {
            try fileManager.createDirectory(at: destination, withIntermediateDirectories: true)
            for (filename, markdown) in nonemptyDocuments {
                let safeFilename = sanitizedMarkdownFilename(filename)
                try Data(markdown.utf8).write(
                    to: destination.appendingPathComponent(safeFilename),
                    options: .atomic
                )
            }

            var assetPaths = nonemptyDocuments.values.reduce(into: Set<String>()) { result, markdown in
                result.formUnion(AcademicMarkdownProcessor.localAssetPaths(in: markdown))
            }
            if let assetSourceDirectory,
               fileManager.fileExists(
                   atPath: assetSourceDirectory.appendingPathComponent("original.pdf").path
               ) {
                assetPaths.insert("original.pdf")
            }
            let assetResult = try copyAssets(
                assetPaths,
                from: assetSourceDirectory,
                to: destination
            )
            return MarkdownBundleExportResult(
                directoryURL: destination,
                copiedAssetCount: assetResult.copied,
                missingAssetPaths: assetResult.missing.sorted()
            )
        } catch let error as MarkdownBundleExporterError {
            throw error
        } catch {
            throw MarkdownBundleExporterError.failed(error.localizedDescription)
        }
    }

    private func copyAssets(
        _ relativePaths: Set<String>,
        from sourceDirectory: URL?,
        to destinationDirectory: URL
    ) throws -> (copied: Int, missing: [String]) {
        guard !relativePaths.isEmpty else { return (0, []) }
        guard let sourceDirectory else { return (0, Array(relativePaths)) }

        let sourceRoot = sourceDirectory.standardizedFileURL
        let destinationRoot = destinationDirectory.standardizedFileURL
        var copied = 0
        var missing: [String] = []

        for relativePath in relativePaths {
            let cleanPath = relativePath
                .components(separatedBy: "#").first?
                .components(separatedBy: "?").first ?? relativePath
            let source = sourceRoot.appendingPathComponent(cleanPath).standardizedFileURL
            let destination = destinationRoot.appendingPathComponent(cleanPath).standardizedFileURL
            guard isDescendant(source, of: sourceRoot),
                  isDescendant(destination, of: destinationRoot),
                  fileManager.fileExists(atPath: source.path) else {
                missing.append(relativePath)
                continue
            }

            try fileManager.createDirectory(
                at: destination.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            if fileManager.fileExists(atPath: destination.path) {
                try fileManager.removeItem(at: destination)
            }
            try fileManager.copyItem(at: source, to: destination)
            copied += 1
        }
        return (copied, missing)
    }

    private func uniqueDirectory(parent: URL, preferredName: String) -> URL {
        let preferred = parent.appendingPathComponent(preferredName, isDirectory: true)
        guard fileManager.fileExists(atPath: preferred.path) else { return preferred }

        for suffix in 2...999 {
            let candidate = parent.appendingPathComponent(
                "\(preferredName)-\(suffix)",
                isDirectory: true
            )
            if !fileManager.fileExists(atPath: candidate.path) {
                return candidate
            }
        }
        return parent.appendingPathComponent(
            preferredName + "-" + UUID().uuidString,
            isDirectory: true
        )
    }

    private func isDescendant(_ candidate: URL, of root: URL) -> Bool {
        candidate.path == root.path || candidate.path.hasPrefix(root.path + "/")
    }

    private func sanitizedFilename(_ value: String) -> String {
        let sanitized = value
            .replacingOccurrences(of: #"[^A-Za-z0-9._-]+"#, with: "_", options: .regularExpression)
            .trimmingCharacters(in: CharacterSet(charactersIn: "._-"))
        return sanitized.isEmpty ? "paper" : sanitized
    }

    private func sanitizedMarkdownFilename(_ value: String) -> String {
        let stem = sanitizedFilename(
            URL(fileURLWithPath: value).deletingPathExtension().lastPathComponent
        )
        return stem + ".md"
    }
}
