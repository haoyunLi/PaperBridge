import Foundation
import CryptoKit

private struct BundleFixture: Decodable {
    let documents: [String: String]
    let guide: String
    let csv: String
    let imageBase64: String
}

func nativeBundleReference(fixturesDirectory: URL) throws -> [String: Any] {
    let fixture = try JSONDecoder().decode(BundleFixture.self, from: Data(contentsOf: fixturesDirectory.appendingPathComponent("bundle-fixture.json")))
    let fm = FileManager.default
    let work = fm.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
    let source = work.appendingPathComponent("extraction", isDirectory: true)
    let exported = work.appendingPathComponent("export", isDirectory: true)
    let moved = work.appendingPathComponent("Moved journal bundle", isDirectory: true)
    try fm.createDirectory(at: exported, withIntermediateDirectories: true)
    defer { try? fm.removeItem(at: work) }

    let guide = "supplements/guide.md"
    let csv = "data/measurements.csv"
    let figure = "figures/response.png"
    guard let image = Data(base64Encoded: fixture.imageBase64) else { throw CocoaError(.fileReadCorruptFile) }
    let files = [guide: Data(fixture.guide.utf8), csv: Data(fixture.csv.utf8), figure: image,
                 "data/wrapped.csv": Data(fixture.csv.utf8), "figures/wrapped.png": image]
    for (name, content) in files {
        let url = source.appendingPathComponent(name)
        try fm.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try content.write(to: url)
    }
    let result = try MarkdownBundleExporter().export(paperName: "Calibration.pdf", documents: fixture.documents,
                                                     assetSourceDirectory: source, to: exported)
    try fm.moveItem(at: result.directoryURL, to: moved)
    let movedGuide = moved.appendingPathComponent(guide)
    let relativeFiles = [("../data/measurements.csv", csv), ("../figures/response.png", figure)]
    let hashes = try Dictionary(uniqueKeysWithValues: relativeFiles.map { relative, name in
        let bytes = try Data(contentsOf: movedGuide.deletingLastPathComponent().appendingPathComponent(relative))
        return (name, SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined())
    })
    let wrappedHashes = try Dictionary(uniqueKeysWithValues: ["data/wrapped.csv", "figures/wrapped.png"].map { name in
        let bytes = try Data(contentsOf: moved.appendingPathComponent(name))
        return (name, SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined())
    })
    return ["wrapped": wrappedHashes, "copied": result.copiedAssetCount, "missing": result.missingAssetPaths,
            "guide": try String(contentsOf: movedGuide, encoding: .utf8), "targets": hashes]
}
