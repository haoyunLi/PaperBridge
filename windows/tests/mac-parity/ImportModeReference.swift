import Foundation

// Run the original Mac import entry point and PDFKit. Only the MinerU executable
// is a fixture, so the same parser success and failure can be compared on Windows.
@MainActor
func nativeImportModes(pdf: URL) throws -> [String: [String: Bool]] {
    let files = FileManager.default
    let root = files.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? files.removeItem(at: root) }
    let script = #"""
    #!/bin/sh
    set -eu
    base=$(dirname "$0")
    touch "$base/invoked"
    if [ -e "$base/fail" ]; then
        echo "Calibration parser unavailable" >&2
        exit 23
    fi
    test "$3" = "-o"
    printf '# Calibration\n\nThe ceramic sample was measured at two field strengths.\n' > "$4/calibration.md"
    """#
    let scenarios: [(String, PDFExtractionMode, Bool)] = [
        ("preferredFailure", .minerUPreferred, true), ("strictFailure", .minerUOnly, true),
        ("pdfOnly", .pdfKitOnly, true), ("preferredSuccess", .minerUPreferred, false),
        ("strictSuccess", .minerUOnly, false)
    ]
    let original = try Data(contentsOf: pdf)
    var outcomes: [String: [String: Bool]] = [:]
    for (name, mode, fail) in scenarios {
        let dir = root.appendingPathComponent(name)
        try files.createDirectory(at: dir, withIntermediateDirectories: true)
        let command = dir.appendingPathComponent("mineru")
        try script.write(to: command, atomically: true, encoding: .utf8)
        try files.setAttributes([.posixPermissions: 0o755], ofItemAtPath: command.path)
        if fail { try Data().write(to: dir.appendingPathComponent("fail")) }
        let store = WorkspaceStore(rootURL: dir.appendingPathComponent("workspace"))
        let model = PaperReaderViewModel(workspaceStore: store, minerUService: MinerUService(workspaceRoot: dir.appendingPathComponent("output")))
        model.loadSamplePaper()
        guard let previous = model.loadedPaper else { throw CocoaError(.fileReadCorruptFile) }
        model.toggleBookmark(for: 1)
        model.settings.pdfExtractionMode = mode
        model.settings.minerUExecutablePath = command.path
        model.loadPDF(from: pdf)
        let deadline = Date().addingTimeInterval(30)
        while model.isBusy && Date() < deadline { RunLoop.main.run(until: Date().addingTimeInterval(0.05)) }
        guard !model.isBusy, let paper = model.loadedPaper else { throw CocoaError(.fileReadUnknown) }
        store.flush()
        let kept = paper.checksum == previous.checksum
        let archived = try paper.originalPDFURL.map { try Data(contentsOf: $0) }
        outcomes[name] = [
            "parserCalled": files.fileExists(atPath: dir.appendingPathComponent("invoked").path),
            "keptPrevious": kept, "keptBookmark": store.loadWorkspace(checksum: previous.checksum)?.bookmarkedParagraphIDs.contains(1) == true,
            "structured": paper.extractionEngine == .minerU,
            "readPdfText": !kept && paper.extractionEngine == .pdfKit && !paper.paragraphs.isEmpty,
            "reportedError": model.errorMessage?.isEmpty == false,
            "reportedFallback": paper.extractionWarning?.localizedCaseInsensitiveContains("MinerU") == true,
            "originalAvailable": !kept && archived == original
        ]
    }
    return outcomes
}
