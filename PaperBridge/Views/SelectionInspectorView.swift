import SwiftUI

struct SelectionInspectorView: View {
    @ObservedObject var viewModel: PaperReaderViewModel
    @State private var noteDraft = ""

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                inspectorHeader

                if let selection = viewModel.activeTextSelection {
                    selectionPanel(selection)
                } else {
                    selectionEmptyState
                }

                Divider()

                paragraphExplanationPanel

                if !viewModel.annotations.isEmpty {
                    Divider()
                    savedAnnotationsPanel
                }
            }
            .padding(18)
        }
        .scrollIndicators(.visible)
        .background(PaperBridgeTheme.surface)
        .onAppear(perform: syncNoteDraft)
        .onChange(of: viewModel.activeTextSelection) { _, _ in
            syncNoteDraft()
        }
    }

    private var inspectorHeader: some View {
        HStack(alignment: .center, spacing: 10) {
            VStack(alignment: .leading, spacing: 3) {
                Text("RESEARCH INSPECTOR")
                    .font(.caption2.weight(.bold))
                    .tracking(1)
                    .foregroundStyle(PaperBridgeTheme.accent)

                Text("Selection & Notes")
                    .font(.title3.weight(.semibold))
            }

            Spacer()

            Button {
                viewModel.isInspectorPresented = false
            } label: {
                Image(systemName: "sidebar.right")
            }
            .buttonStyle(.borderless)
            .help("Hide inspector")
        }
    }

    private func selectionPanel(_ selection: ReaderTextSelection) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Label(
                    "Paragraph \(selection.paragraphID)",
                    systemImage: selection.side == .original
                        ? "doc.text"
                        : "character.book.closed"
                )
                .font(.caption.weight(.semibold))

                Spacer()

                Text(selection.side.displayName)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Text(selection.text)
                .font(.system(size: 15, weight: .regular, design: .serif))
                .lineLimit(8)
                .textSelection(.enabled)
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(
                    PaperBridgeTheme.inset,
                    in: RoundedRectangle(cornerRadius: 9, style: .continuous)
                )

            HStack(spacing: 8) {
                Button {
                    viewModel.translateTextSelection()
                } label: {
                    Label("Translate", systemImage: "character.book.closed")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .disabled(!viewModel.canLookupSelection)

                Button {
                    viewModel.explainTextSelection()
                } label: {
                    Label("Explain", systemImage: "lightbulb")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .disabled(!viewModel.canLookupSelection)
            }

            if viewModel.isSelectionLookupBusy {
                HStack(spacing: 8) {
                    ProgressView()
                        .controlSize(.small)
                    Text(viewModel.selectionLookupStatus)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Spacer()
                    Button("Cancel") {
                        viewModel.cancelSelectionLookup()
                    }
                    .buttonStyle(.borderless)
                }
            } else if let error = viewModel.selectionLookupError {
                Label(error, systemImage: "exclamationmark.triangle.fill")
                    .font(.caption)
                    .foregroundStyle(.orange)
                    .fixedSize(horizontal: false, vertical: true)
            } else if !viewModel.selectionLookupStatus.isEmpty {
                Text(viewModel.selectionLookupStatus)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            if !viewModel.selectionTranslation.isEmpty {
                resultPanel(
                    title: "Translation",
                    icon: "character.book.closed.fill",
                    text: viewModel.selectionTranslation
                )
            }

            if !viewModel.selectionExplanation.isEmpty {
                resultPanel(
                    title: "Simple Explanation",
                    icon: "lightbulb.fill",
                    text: viewModel.selectionExplanation
                )
            }

            VStack(alignment: .leading, spacing: 9) {
                Text("HIGHLIGHT")
                    .font(.caption2.weight(.bold))
                    .tracking(0.8)
                    .foregroundStyle(.secondary)

                HStack(spacing: 10) {
                    ForEach(PaperHighlightColor.allCases) { color in
                        Button {
                            viewModel.applyHighlight(color)
                        } label: {
                            Circle()
                                .fill(color.color)
                                .frame(width: 20, height: 20)
                                .overlay(
                                    Circle()
                                        .strokeBorder(
                                            viewModel.activeSelectionAnnotation?.highlightColor == color
                                                ? Color.primary
                                                : Color.primary.opacity(0.16),
                                            lineWidth: viewModel.activeSelectionAnnotation?.highlightColor == color
                                                ? 2
                                                : 1
                                        )
                                )
                        }
                        .buttonStyle(.plain)
                        .help("\(color.displayName) highlight")
                        .accessibilityLabel("\(color.displayName) highlight")
                    }

                    Spacer()

                    if viewModel.activeSelectionAnnotation != nil {
                        Button("Remove") {
                            viewModel.removeSelectionAnnotation()
                            noteDraft = ""
                        }
                        .buttonStyle(.borderless)
                        .foregroundStyle(.red)
                    }
                }
            }

            VStack(alignment: .leading, spacing: 8) {
                Text("NOTE")
                    .font(.caption2.weight(.bold))
                    .tracking(0.8)
                    .foregroundStyle(.secondary)

                TextEditor(text: $noteDraft)
                    .font(.body)
                    .scrollContentBackground(.hidden)
                    .padding(8)
                    .frame(minHeight: 76)
                    .background(
                        PaperBridgeTheme.inset,
                        in: RoundedRectangle(cornerRadius: 8, style: .continuous)
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .strokeBorder(PaperBridgeTheme.border)
                    )

                HStack {
                    Spacer()
                    Button("Save Note") {
                        viewModel.saveSelectionNote(noteDraft)
                    }
                    .buttonStyle(.bordered)
                }
            }
        }
    }

    private var selectionEmptyState: some View {
        VStack(alignment: .leading, spacing: 10) {
            Image(systemName: "text.cursor")
                .font(.system(size: 24, weight: .medium))
                .foregroundStyle(PaperBridgeTheme.accent)

            Text("Select any text in the original or translation.")
                .font(.headline)

            Text("PaperBridge will capture the exact range so you can translate, explain, highlight, or attach a note without leaving the reader.")
                .font(.callout)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(14)
        .background(
            PaperBridgeTheme.inset,
            in: RoundedRectangle(cornerRadius: 10, style: .continuous)
        )
    }

    private var paragraphExplanationPanel: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("PARAGRAPH EXPLANATION")
                .font(.caption2.weight(.bold))
                .tracking(0.9)
                .foregroundStyle(PaperBridgeTheme.accent)

            if let paragraph = viewModel.selectedParagraph {
                HStack {
                    Text("Paragraph \(paragraph.id)")
                        .font(.headline)
                    Spacer()
                    Picker("Language", selection: $viewModel.explanationLanguage) {
                        ForEach(ReaderLanguage.allCases) { language in
                            Text(language.displayName).tag(language)
                        }
                    }
                    .labelsHidden()
                    .frame(maxWidth: 150)
                }

                Text(paragraph.previewText)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(4)

                Button {
                    viewModel.explainSelectedParagraph()
                } label: {
                    Label("Explain Full Paragraph", systemImage: "sparkles")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .disabled(!viewModel.canExplain)

                if !viewModel.explanationText.isEmpty {
                    resultPanel(
                        title: viewModel.explanationLanguage.displayName,
                        icon: "text.bubble",
                        text: viewModel.explanationText
                    )
                }
            } else {
                Text("Choose a paragraph's lightbulb button to explain the full paragraph.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var savedAnnotationsPanel: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("SAVED ANNOTATIONS")
                    .font(.caption2.weight(.bold))
                    .tracking(0.9)
                    .foregroundStyle(PaperBridgeTheme.accent)
                Spacer()
                Text("\(viewModel.annotations.count)")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
            }

            ForEach(viewModel.annotations.sorted { $0.createdAt > $1.createdAt }) { annotation in
                Button {
                    viewModel.activateAnnotation(annotation)
                    syncNoteDraft()
                } label: {
                    VStack(alignment: .leading, spacing: 5) {
                        HStack {
                            Text("P\(annotation.paragraphID) · \(annotation.side.displayName)")
                                .font(.caption.weight(.semibold))
                            Spacer()
                            if let color = annotation.highlightColor {
                                Circle()
                                    .fill(color.color)
                                    .frame(width: 9, height: 9)
                            }
                        }

                        Text(annotation.quote)
                            .font(.caption)
                            .lineLimit(2)
                            .multilineTextAlignment(.leading)

                        if !annotation.note.isEmpty {
                            Text(annotation.note)
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                                .lineLimit(2)
                                .multilineTextAlignment(.leading)
                        }
                    }
                    .padding(9)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(
                        PaperBridgeTheme.inset,
                        in: RoundedRectangle(cornerRadius: 8, style: .continuous)
                    )
                }
                .buttonStyle(.plain)
                .contextMenu {
                    Button("Delete Annotation", role: .destructive) {
                        viewModel.removeAnnotation(id: annotation.id)
                    }
                }
            }
        }
    }

    private func resultPanel(title: String, icon: String, text: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(title, systemImage: icon)
                .font(.caption.weight(.semibold))
                .foregroundStyle(PaperBridgeTheme.accent)

            Text(text)
                .font(.callout)
                .lineSpacing(3)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            PaperBridgeTheme.inset,
            in: RoundedRectangle(cornerRadius: 9, style: .continuous)
        )
    }

    private func syncNoteDraft() {
        noteDraft = viewModel.activeSelectionAnnotation?.note ?? ""
    }
}
