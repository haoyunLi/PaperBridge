import SwiftUI

struct PaperLibraryView: View {
    @ObservedObject var viewModel: PaperReaderViewModel
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var editing: LibraryEntry?
    @State private var title = ""
    @State private var tags = ""

    private var entries: [LibraryEntry] {
        viewModel.libraryEntries.filter {
            query.isEmpty || ($0.title + " " + $0.tags.joined(separator: " ")).localizedCaseInsensitiveContains(query)
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Text("Your Paper Library").font(.title2.weight(.semibold))
                Spacer()
                Button("Done") { dismiss() }.keyboardShortcut(.cancelAction)
            }
            Text("Saved on this Mac, with each paper's translations, notes, bookmarks, and reading position. This is not a backup.")
                .foregroundStyle(.secondary)
            TextField("Search titles or tags", text: $query).textFieldStyle(.roundedBorder)
            if entries.isEmpty {
                ContentUnavailableView(query.isEmpty ? "No Saved Papers" : "No Matching Papers", systemImage: "books.vertical",
                    description: Text(query.isEmpty ? "Open a PDF or paste text to begin your local library." : "Try a different title or tag."))
            } else {
                List(entries) { entry in
                    HStack(alignment: .center, spacing: 16) {
                        Button { viewModel.openLibraryPaper(entry) } label: {
                            VStack(alignment: .leading, spacing: 5) {
                                Text(entry.title).fontWeight(.semibold).lineLimit(2)
                                Text("\(entry.translatedCount)/\(entry.paragraphCount) translated · \(entry.lastOpened.formatted(date: .abbreviated, time: .omitted))")
                                    .font(.caption).foregroundStyle(.secondary)
                                if !entry.tags.isEmpty { Text(entry.tags.joined(separator: " · ")).font(.caption).foregroundStyle(PaperBridgeTheme.accent) }
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.vertical, 8).contentShape(Rectangle())
                        }
                        .buttonStyle(.plain).disabled(viewModel.isBusy)
                        Button {
                            editing = entry
                            title = entry.title
                            tags = entry.tags.joined(separator: ", ")
                        } label: { Image(systemName: "pencil") }
                        .help("Edit library title and tags")
                    }
                }
                .listStyle(.inset)
            }
            if let editing {
                Divider()
                Text("Library label only; the original document is unchanged.").font(.caption).foregroundStyle(.secondary)
                TextField("Title", text: $title).textFieldStyle(.roundedBorder)
                TextField("Tags, separated by commas", text: $tags).textFieldStyle(.roundedBorder)
                HStack {
                    Button("Cancel Edit") { self.editing = nil }
                    Button("Save Label") {
                        viewModel.updateLibraryMetadata(editing, title: title, tags: tags)
                        self.editing = nil
                    }.disabled(title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
            if viewModel.isBusy { Text("Finish or cancel the current task before opening another paper.").font(.caption) }
            if let error = viewModel.workspaceSaveError { Text(error).foregroundStyle(.red).font(.caption) }
        }
        .padding(24).frame(minWidth: 560, idealWidth: 660, minHeight: 480, idealHeight: 600)
    }
}

struct GlossaryView: View {
    @ObservedObject var viewModel: PaperReaderViewModel
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Text("Saved Terminology").font(.title2.weight(.semibold))
                Spacer()
                Button("Done") { dismiss() }.keyboardShortcut(.cancelAction)
            }
            Text("Select a word or short phrase, translate it, and save your preferred wording. Matching terms guide future requests in the same language direction; models can still make mistakes. Existing translations stay unchanged.")
                .font(.callout).foregroundStyle(.secondary)
            TextField("Search terms", text: $query).textFieldStyle(.roundedBorder)
            List {
                ForEach(viewModel.glossary.filter { query.isEmpty || ($0.source + " " + $0.translation).localizedCaseInsensitiveContains(query) }) { term in
                    HStack {
                        VStack(alignment: .leading, spacing: 5) {
                            Text(term.source).fontWeight(.semibold)
                            Text(term.translation).textSelection(.enabled)
                            Text("\(term.sourceLanguage.displayName) to \(term.targetLanguage.displayName)").font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Button("Remove", role: .destructive) { viewModel.removeTerm(term) }
                    }.padding(.vertical, 6)
                }
            }.overlay {
                if viewModel.glossary.isEmpty { Text("No saved terms yet.").foregroundStyle(.secondary) }
            }
            if let error = viewModel.workspaceSaveError { Text(error).font(.caption).foregroundStyle(.red) }
        }
        .padding(24).frame(width: 580, height: 460)
    }
}
