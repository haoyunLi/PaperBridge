import Foundation

// Exercise the production range actions in two languages. Only the parser
// output and the Ollama HTTP responses are controlled.
private final class RangeModelResponse: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func stopLoading() {}
    override func startLoading() {
        guard let url = request.url, let client else { return }
        let payload: [String: Any]
        let status: Int
        switch (request.httpMethod, url.path) {
        case ("GET", "/api/tags"):
            status = 200
            payload = ["models": [["name": "range-model:local"]]]
        case ("POST", "/api/generate"):
            status = 200
            payload = ["done": true, "response": "已经完成这段的翻译。"]
        default:
            status = 404
            payload = ["error": "Unexpected fixture request"]
        }
        let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1",
                                       headerFields: ["Content-Type": "application/json"])!
        client.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        do { client.urlProtocol(self, didLoad: try JSONSerialization.data(withJSONObject: payload)) }
        catch { client.urlProtocol(self, didFailWithError: error); return }
        client.urlProtocolDidFinishLoading(self)
    }
}

@MainActor
func nativeTranslationRanges(fixtures: URL) throws -> [String: Any] {
    func failure(_ text: String) -> NSError {
        NSError(domain: "TranslationRanges", code: 1, userInfo: [NSLocalizedDescriptionKey: text])
    }
    let files = FileManager.default
    let dir = files.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try files.createDirectory(at: dir, withIntermediateDirectories: true)
    defer { try? files.removeItem(at: dir) }
    let parser = dir.appendingPathComponent("mineru")
    try files.copyItem(at: fixtures.appendingPathComponent("range-article.md"), to: dir.appendingPathComponent("source.md"))
    let parserSource = #"""
    #!/bin/sh
    set -eu
    test "$3" = "-o"
    cp "$(dirname "$0")/source.md" "$4/article.md"
    """#
    try parserSource.write(to: parser, atomically: true, encoding: .utf8)
    try files.setAttributes([.posixPermissions: 0o755], ofItemAtPath: parser.path)
    let config = URLSessionConfiguration.ephemeral
    config.protocolClasses = [RangeModelResponse.self]
    let session = URLSession(configuration: config)
    defer { session.invalidateAndCancel() }
    let root = dir.appendingPathComponent("workspace")
    func makeModel() -> PaperReaderViewModel {
        PaperReaderViewModel(workspaceStore: WorkspaceStore(rootURL: root), ollamaClient: OllamaClient(session: session),
                             minerUService: MinerUService(workspaceRoot: dir.appendingPathComponent("output")))
    }
    func finish(_ model: PaperReaderViewModel) throws {
        let deadline = Date().addingTimeInterval(30)
        while model.isBusy && Date() < deadline { RunLoop.main.run(until: Date().addingTimeInterval(0.03)) }
        if model.isBusy || model.errorMessage != nil { throw failure(model.errorMessage ?? "Range task timed out") }
    }
    func completed(_ model: PaperReaderViewModel) -> [String] {
        model.paragraphResults.filter { $0.status == .ok && !$0.translation.isEmpty }.map(\.original)
    }
    let model = makeModel()
    model.settings.pdfExtractionMode = .minerUOnly
    model.settings.minerUExecutablePath = parser.path
    model.settings.aiProvider = .ollama
    model.settings.sourceLanguage = .english
    model.settings.targetLanguage = .simplifiedChinese
    model.settings.translationModel = "range-model:local"
    model.loadPDF(from: fixtures.appendingPathComponent("emcee-v3.pdf"))
    try finish(model)
    guard let paper = model.loadedPaper, let abstract = model.paperSections.first(where: { $0.title == "Abstract" }),
          let results = model.paperSections.first(where: { $0.title == "Results" }),
          let resource = model.visibleReaderItems.first(where: { if case .resource = $0 { return true }; return false }),
          let selected = abstract.paragraphIDs.last else { throw failure("The structured article did not import") }
    model.selectParagraphForExplanation(selected)
    model.updateReadingPosition(ReadingPosition(paragraphID: results.id, readerItemID: "paragraph-\(results.id)"),
                                key: "reader", paperChecksum: paper.checksum)
    guard let atParagraph = model.currentReadingSection?.title else { throw failure("No section at a visible paragraph") }
    model.updateReadingPosition(ReadingPosition(readerItemID: resource.id), key: "reader", paperChecksum: paper.checksum)
    guard let atResource = model.currentReadingSection else { throw failure("No section at a visible table") }
    model.translatePaper(paragraphIDs: atResource.paragraphIDs)
    try finish(model)
    let afterCurrent = completed(model)
    model.translatePaper(paragraphIDs: PaperReadingAnalysis.overviewParagraphIDs(in: model.paperSections))
    try finish(model)
    let afterOverview = completed(model)
    model.flushPendingSaves()
    let reopened = makeModel()
    guard let entry = reopened.libraryEntries.first(where: { $0.id == paper.checksum }) else { throw failure("Missing saved article") }
    reopened.openLibraryPaper(entry)
    let restored = completed(reopened)
    guard restored == afterOverview else { throw failure("Saved translations changed across reopening") }
    guard let methods = reopened.paperSections.first(where: { $0.title == "Methods" }) else { throw failure("Missing chosen section") }
    reopened.translatePaper(paragraphIDs: methods.paragraphIDs)
    try finish(reopened)
    return ["paragraphSection": atParagraph, "resourceSection": atResource.title, "afterCurrent": afterCurrent,
            "afterOverview": afterOverview, "restored": restored, "afterChosen": completed(reopened)]
}
