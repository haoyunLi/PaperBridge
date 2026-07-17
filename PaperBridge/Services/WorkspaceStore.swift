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
        isInspectorPresented: Bool
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
    }
}

final class WorkspaceStore {
    private let fileManager: FileManager
    private let rootURL: URL
    private let workspacesURL: URL
    private let settingsURL: URL
    private let lastWorkspaceURL: URL
    private let queue = DispatchQueue(label: "com.haoyunli.PaperBridge.workspace-store", qos: .utility)

    init(fileManager: FileManager = .default) {
        self.fileManager = fileManager

        let applicationSupport = fileManager.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        ).first ?? fileManager.temporaryDirectory
        rootURL = applicationSupport.appendingPathComponent("PaperBridge", isDirectory: true)
        workspacesURL = rootURL.appendingPathComponent("Workspaces", isDirectory: true)
        settingsURL = rootURL.appendingPathComponent("settings.json")
        lastWorkspaceURL = rootURL.appendingPathComponent("last-workspace.json")

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
            self?.encode(settings, to: self?.settingsURL)
        }
    }

    func saveWorkspace(_ workspace: PersistedWorkspace) {
        queue.async { [weak self] in
            guard let self else { return }
            self.encode(workspace, to: self.workspaceURL(for: workspace.paper.checksum))
            self.encode(workspace, to: self.lastWorkspaceURL)
        }
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
        guard let data = try? Data(contentsOf: url) else { return nil }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try? decoder.decode(type, from: data)
    }

    private func encode<T: Encodable>(_ value: T, to url: URL?) {
        guard let url else { return }
        createDirectoriesIfNeeded()

        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        guard let data = try? encoder.encode(value) else { return }
        try? data.write(to: url, options: .atomic)
    }
}
