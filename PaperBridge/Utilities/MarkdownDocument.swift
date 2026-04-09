import SwiftUI
import UniformTypeIdentifiers

extension UTType {
    static var markdownText: UTType {
        UTType(filenameExtension: "md") ?? .plainText
    }
}

struct MarkdownDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.markdownText, .plainText] }

    var text: String

    init(text: String = "") {
        self.text = text
    }

    init(configuration: ReadConfiguration) throws {
        guard let data = configuration.file.regularFileContents,
              let text = String(data: data, encoding: .utf8) else {
            self.text = ""
            return
        }

        self.text = text
    }

    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        FileWrapper(regularFileWithContents: Data(text.utf8))
    }
}
