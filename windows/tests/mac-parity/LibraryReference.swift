import Foundation

private struct LabelEdit: Decodable {
    let name: String
    let title: String
    let tags: [String]
}

func nativeLibraryReference(fixturesDirectory: URL) throws -> [String: Any] {
    let fm = FileManager.default
    let root = fm.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
    let store = WorkspaceStore(rootURL: root)
    defer { try? fm.removeItem(at: root) }
    let first = String(repeating: "a", count: 64)
    let recent = String(repeating: "b", count: 64)
    let entries = [first, recent].enumerated().map { index, id in
        LibraryEntry(id: id, title: "Paper", tags: [], lastOpened: Date(timeIntervalSince1970: Double(index)),
                     paragraphCount: 7 + index, translatedCount: 3)
    }
    let encoder = JSONEncoder()
    encoder.dateEncodingStrategy = .iso8601
    try encoder.encode(entries).write(to: root.appendingPathComponent("library.json"))
    // Only the independent index is present. Listing and label edits must still work.
    let listed = store.loadLibrary()
    let fixture = try Data(contentsOf: fixturesDirectory.appendingPathComponent("library-labels.json"))
    let edits = try JSONDecoder().decode([LabelEdit].self, from: fixture)
    let labels: [[String: Any]] = try edits.map { edit in
        try store.updateLibraryEntry(checksum: first, title: edit.title, tags: edit.tags)
        guard let updated = store.loadLibrary().first(where: { $0.id == first }) else { throw CocoaError(.fileReadCorruptFile) }
        return ["name": edit.name, "title": updated.title, "tags": updated.tags]
    }
    return ["ids": listed.map(\.id), "counts": listed.map(\.paragraphCount), "labels": labels]
}
