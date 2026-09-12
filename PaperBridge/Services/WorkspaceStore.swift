import Foundation

struct PersistedWorkspace: Codable {
    let version: Int
    let settings: AppSettings
    let paper: PaperDocument
    let paragraphResults: [ParagraphResult]
    let connectedTranslation: ConnectedTranslationResult?
    let summaries: SummaryResult?
    let selectedParagraphID: Int?
    let displayMode: ReaderDisplayMode
    let workspaceMode: ReaderWorkspaceMode
    let explanationLanguage: ReaderLanguage
    let explanationText: String
    let annotations: [PaperAnnotation]
    let bookmarkedParagraphIDs: Set<Int>
    let isInspectorPresented: Bool
    let readingPositions: [String: ReadingPosition]?

    init(
        settings: AppSettings,
        paper: PaperDocument,
        paragraphResults: [ParagraphResult],
        connectedTranslation: ConnectedTranslationResult?,
        summaries: SummaryResult?,
        selectedParagraphID: Int?,
        displayMode: ReaderDisplayMode,
        workspaceMode: ReaderWorkspaceMode,
        explanationLanguage: ReaderLanguage,
        explanationText: String,
        annotations: [PaperAnnotation],
        bookmarkedParagraphIDs: Set<Int>,
        isInspectorPresented: Bool,
        readingPositions: [String: ReadingPosition]? = nil
    ) {
        self.version = 1
        self.settings = settings
        self.paper = paper
        self.paragraphResults = paragraphResults
        self.connectedTranslation = connectedTranslation
        self.summaries = summaries
        self.selectedParagraphID = selectedParagraphID
        self.displayMode = displayMode
        self.workspaceMode = workspaceMode
        self.explanationLanguage = explanationLanguage
        self.explanationText = explanationText
        self.annotations = annotations
        self.bookmarkedParagraphIDs = bookmarkedParagraphIDs
        self.isInspectorPresented = isInspectorPresented
        self.readingPositions = readingPositions
    }
}

final class WorkspaceStore {
    private let fileManager: FileManager
    private let rootURL: URL
    private let workspacesURL: URL
    private let settingsURL: URL
    private let lastWorkspaceURL: URL
    private let libraryURL: URL
    private let glossaryURL: URL
    private let queue = DispatchQueue(label: "com.haoyunli.PaperBridge.workspace-store", qos: .utility)
    var onSaveStatus: ((String?) -> Void)?

    init(fileManager: FileManager = .default, rootURL: URL? = nil) {
        self.fileManager = fileManager

        let applicationSupport = fileManager.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        ).first ?? fileManager.temporaryDirectory
        self.rootURL = rootURL ?? applicationSupport.appendingPathComponent("PaperBridge", isDirectory: true)
        workspacesURL = self.rootURL.appendingPathComponent("Workspaces", isDirectory: true)
        settingsURL = self.rootURL.appendingPathComponent("settings.json")
        lastWorkspaceURL = self.rootURL.appendingPathComponent("last-workspace.json")
        libraryURL = self.rootURL.appendingPathComponent("library.json")
        glossaryURL = self.rootURL.appendingPathComponent("glossary.json")

        createDirectoriesIfNeeded()
    }

    func loadSettings() -> AppSettings? {
        queue.sync {
            decode(AppSettings.self, from: settingsURL)
        }
    }

    func loadLastWorkspace() -> PersistedWorkspace? {
        queue.sync {
            decode(PersistedWorkspace.self, from: lastWorkspaceURL)
        }
    }

    func loadWorkspace(checksum: String) -> PersistedWorkspace? {
        queue.sync {
            decode(PersistedWorkspace.self, from: workspaceURL(for: checksum))
        }
    }

    func saveSettings(_ settings: AppSettings) {
        queue.async { [weak self] in
            guard let self else { return }
            do { try self.encode(settings, to: self.settingsURL) }
            catch { self.onSaveStatus?(error.localizedDescription) }
        }
    }

    func saveWorkspace(_ workspace: PersistedWorkspace) {
        queue.async { [weak self] in
            guard let self else { return }
            do {
                try self.encode(workspace, to: self.workspaceURL(for: workspace.paper.checksum))
                if workspace.paper.libraryStorageID != workspace.paper.checksum {
                    try self.encode(workspace, to: self.workspaceURL(for: workspace.paper.libraryStorageID))
                }
                try self.encode(workspace, to: self.lastWorkspaceURL)
                var entries = self.readLibrary()
                if let index = entries.firstIndex(where: { $0.id == workspace.paper.libraryStorageID }) {
                    entries[index].paragraphCount = workspace.paragraphResults.count
                    entries[index].translatedCount = workspace.paragraphResults.filter { $0.status == .ok }.count
                } else {
                    entries.append(self.libraryEntry(for: workspace, date: Date()))
                }
                try self.encode(entries, to: self.libraryURL)
                self.onSaveStatus?(nil)
            } catch { self.onSaveStatus?(error.localizedDescription) }
        }
    }

    func flush() { queue.sync {} }

    func loadLibrary() -> [LibraryEntry] {
        queue.sync { readLibrary().sorted { $0.lastOpened > $1.lastOpened } }
    }

    func updateLibraryEntry(checksum: String, title: String? = nil, tags: [String]? = nil, opened: Bool = false) throws {
        try queue.sync {
            var entries = readLibrary()
            guard let index = entries.firstIndex(where: { $0.id == checksum }) else { return }
            if let title, !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                entries[index].title = String(title.trimmingCharacters(in: .whitespacesAndNewlines).prefix(200))
            }
            if let tags {
                entries[index].tags = Array(Set(tags.map { String($0.trimmingCharacters(in: .whitespacesAndNewlines).prefix(40)) }
                    .filter { !$0.isEmpty })).sorted().prefix(20).map { $0 }
            }
            if opened { entries[index].lastOpened = Date() }
            try encode(entries, to: libraryURL)
        }
    }

    func loadGlossary() -> [SavedTerm] {
        queue.sync { decode([SavedTerm].self, from: glossaryURL) ?? [] }
    }

    func saveGlossary(_ terms: [SavedTerm]) throws {
        try queue.sync { try encode(terms, to: glossaryURL) }
    }

    private func libraryEntry(for workspace: PersistedWorkspace, date: Date) -> LibraryEntry {
        LibraryEntry(id: workspace.paper.libraryStorageID, title: workspace.paper.name, tags: [], lastOpened: date,
                     paragraphCount: workspace.paragraphResults.count,
                     translatedCount: workspace.paragraphResults.filter { $0.status == .ok }.count)
    }

    private func readLibrary() -> [LibraryEntry] {
        if let entries = decode([LibraryEntry].self, from: libraryURL) { return entries }
        // Discover pre-library workspaces without deleting or rewriting their contents.
        let urls = (try? fileManager.contentsOfDirectory(at: workspacesURL,
            includingPropertiesForKeys: [.contentModificationDateKey])) ?? []
        let entries: [LibraryEntry] = urls.filter { $0.pathExtension == "json" }.compactMap { url in
            guard let workspace = decode(PersistedWorkspace.self, from: url) else { return nil }
            let date = (try? url.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate ?? .distantPast
            return libraryEntry(for: workspace, date: date)
        }
        var seen = Set<String>()
        return entries.sorted { $0.lastOpened > $1.lastOpened }.filter { seen.insert($0.id).inserted }
    }

    func clearAll() {
        queue.sync {
            try? fileManager.removeItem(at: rootURL)
            createDirectoriesIfNeeded()
        }
    }

    private func workspaceURL(for checksum: String) -> URL {
        workspacesURL.appendingPathComponent(checksum + ".json")
    }

    private func createDirectoriesIfNeeded() {
        try? fileManager.createDirectory(
            at: workspacesURL,
            withIntermediateDirectories: true
        )
    }

    private func decode<T: Decodable>(_ type: T.Type, from url: URL) -> T? {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        for candidate in [url, url.appendingPathExtension("backup")] {
            if let data = try? Data(contentsOf: candidate), let value = try? decoder.decode(type, from: data) {
                return value
            }
        }
        return nil
    }

    private func encode<T: Codable>(_ value: T, to url: URL) throws {
        createDirectoriesIfNeeded()

        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let data = try encoder.encode(value)
        // Keep the last readable version. A damaged primary must never replace
        // the good backup when a recovered workspace is saved again.
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        if let previous = try? Data(contentsOf: url), previous != data,
           (try? decoder.decode(T.self, from: previous)) != nil {
            try previous.write(to: url.appendingPathExtension("backup"), options: .atomic)
        }
        try data.write(to: url, options: .atomic)
    }
}
