import Foundation

@main
struct MinerUServiceRegression {
    static func main() async throws {
        let fileManager = FileManager.default
        let testRoot = fileManager.temporaryDirectory.appendingPathComponent(
            "paperbridge-mineru-regression-" + UUID().uuidString,
            isDirectory: true
        )
        defer { try? fileManager.removeItem(at: testRoot) }

        try fileManager.createDirectory(at: testRoot, withIntermediateDirectories: true)
        let executable = testRoot.appendingPathComponent("fake-mineru")
        try Data(fakeMinerUScript.utf8).write(to: executable, options: .atomic)
        try fileManager.setAttributes(
            [.posixPermissions: NSNumber(value: Int16(0o755))],
            ofItemAtPath: executable.path
        )

        let service = MinerUService(
            fileManager: fileManager,
            workspaceRoot: testRoot.appendingPathComponent("workspace", isDirectory: true)
        )
        let input = Data("fake-pdf".utf8)
        let defaultSettings = AppSettings()
        require(
            defaultSettings.translationModel == AppSettings.recommendedLocalModel &&
                defaultSettings.summaryModel == AppSettings.recommendedLocalModel &&
                defaultSettings.explainModel == AppSettings.recommendedLocalModel &&
                defaultSettings.quickLookupModel == AppSettings.recommendedLocalModel,
            "Fresh settings should use the recommended local model for every AI task"
        )
        require(
            defaultSettings.minerUBackend == .pipeline,
            "Pipeline should be the safe default backend for a fresh installation"
        )

        let first = try await service.extract(
            pdfData: input,
            originalFilename: "paper.pdf",
            checksum: "cache-regression",
            configuredPath: executable.path,
            backend: .automatic
        )
        require(!first.usedCachedOutput, "First MinerU run unexpectedly used a cache")
        require(first.markdown.contains("Structured result"), "MinerU Markdown was not loaded")
        require(
            fileManager.fileExists(
                atPath: first.resourceDirectoryURL.appendingPathComponent("images/figure.png").path
            ),
            "MinerU asset directory was not retained"
        )
        let originalPDFURL = first.resourceDirectoryURL.appendingPathComponent("original.pdf")
        require(
            (try? Data(contentsOf: originalPDFURL)) == input,
            "MinerU output did not retain an exact copy of the source PDF"
        )

        let runRoot = first.resourceDirectoryURL
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let runCountURL = runRoot.appendingPathComponent("run-count")
        require(readCount(at: runCountURL) == 1, "Fake MinerU did not run exactly once")

        try Data("stale-copy".utf8).write(to: originalPDFURL, options: .atomic)

        let cached = try await service.extract(
            pdfData: input,
            originalFilename: "paper.pdf",
            checksum: "cache-regression",
            configuredPath: executable.path,
            backend: .automatic
        )
        require(cached.usedCachedOutput, "Completed MinerU output was not reused")
        require(readCount(at: runCountURL) == 1, "Cache reuse launched MinerU again")
        require(
            (try? Data(contentsOf: originalPDFURL)) == input,
            "Cache reuse did not repair the preserved original PDF"
        )

        try Data().write(to: first.markdownURL, options: .atomic)
        try Data().write(to: runRoot.appendingPathComponent("fail-next"), options: .atomic)

        do {
            _ = try await service.extract(
                pdfData: input,
                originalFilename: "paper.pdf",
                checksum: "cache-regression",
                configuredPath: executable.path,
                backend: .automatic
            )
            require(false, "A failed MinerU process unexpectedly succeeded")
        } catch MinerUServiceError.processFailed(let status, _) {
            require(status == 9, "MinerU failure returned the wrong exit status")
        }

        let recovered = try await service.extract(
            pdfData: input,
            originalFilename: "paper.pdf",
            checksum: "cache-regression",
            configuredPath: executable.path,
            backend: .automatic
        )
        require(!recovered.usedCachedOutput, "Partial Markdown from a failed run was reused")
        require(recovered.markdown.contains("Structured result"), "MinerU did not recover after failure")
        require(readCount(at: runCountURL) == 3, "MinerU recovery did not perform a clean rerun")

        print("MinerU service regression tests passed.")
    }

    private static var fakeMinerUScript: String {
        #"""
        #!/bin/zsh
        set -euo pipefail

        output=""
        while (( $# > 0 )); do
          case "$1" in
            -o)
              output="$2"
              shift 2
              ;;
            *)
              shift
              ;;
          esac
        done

        root="$(dirname "$output")"
        count_file="$root/run-count"
        count=0
        if [[ -f "$count_file" ]]; then
          count="$(cat "$count_file")"
        fi
        print $((count + 1)) > "$count_file"

        mkdir -p "$output/result/images"
        if [[ -f "$root/fail-next" ]]; then
          rm "$root/fail-next"
          print '# Partial output' > "$output/result/paper.md"
          exit 9
        fi

        print '# Structured result\n\n![Figure](images/figure.png)\n\nA complete paragraph.' > "$output/result/paper.md"
        print 'png' > "$output/result/images/figure.png"
        """#
    }

    private static func readCount(at url: URL) -> Int? {
        guard let value = try? String(contentsOf: url, encoding: .utf8) else { return nil }
        return Int(value.trimmingCharacters(in: .whitespacesAndNewlines))
    }

    private static func require(
        _ condition: @autoclosure () -> Bool,
        _ message: String
    ) {
        guard condition() else {
            fputs("FAIL: \(message)\n", stderr)
            exit(1)
        }
    }
}
