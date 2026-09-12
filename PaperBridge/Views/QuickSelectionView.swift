import SwiftUI

struct QuickSelectionView: View {
    @ObservedObject var viewModel: PaperReaderViewModel
    @State private var preferredTranslation = ""
    @State private var isSavingTerm = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top) {
                Text(viewModel.activeTextSelection?.text ?? "").font(.callout.weight(.semibold)).lineLimit(2)
                Spacer()
                Button { viewModel.isQuickLookupPresented = false } label: { Image(systemName: "xmark") }
                    .buttonStyle(.borderless).accessibilityLabel("Close quick lookup")
            }
            HStack(spacing: 8) {
                Button("Translate", action: viewModel.translateTextSelection)
                Button("Explain", action: viewModel.explainTextSelection)
                Menu("Highlight") {
                    ForEach(PaperHighlightColor.allCases) { color in
                        Button(color.displayName) { viewModel.applyHighlight(color) }
                    }
                }
                .fixedSize()
            }
            .disabled(viewModel.isSelectionLookupBusy)
            if viewModel.isSelectionLookupBusy {
                HStack {
                    ProgressView().controlSize(.small)
                    Text(viewModel.selectionLookupStatus).font(.caption)
                    Spacer()
                    Button("Cancel", action: viewModel.cancelSelectionLookup)
                }
            }
            if !viewModel.selectionTranslation.isEmpty || !viewModel.selectionExplanation.isEmpty {
                ScrollView {
                    VStack(alignment: .leading, spacing: 12) {
                        if !viewModel.selectionTranslation.isEmpty { Text(viewModel.selectionTranslation).textSelection(.enabled) }
                        if !viewModel.selectionExplanation.isEmpty { Text(viewModel.selectionExplanation).textSelection(.enabled) }
                    }.frame(maxWidth: .infinity, alignment: .leading)
                }.frame(maxHeight: 160)
            }
            if let error = viewModel.selectionLookupError {
                Text(error).font(.caption).foregroundStyle(.red).lineLimit(4)
            }
            if isSavingTerm {
                TextField("Preferred translation", text: $preferredTranslation).textFieldStyle(.roundedBorder)
                HStack {
                    Button("Save Term") {
                        if viewModel.saveSelectedTerm(translation: preferredTranslation) { isSavingTerm = false }
                    }.disabled(preferredTranslation.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    Button("Cancel") { isSavingTerm = false }
                }
            } else {
                HStack {
                    Button("Save Term...") {
                        preferredTranslation = viewModel.selectionTranslation
                        isSavingTerm = true
                    }.disabled((viewModel.activeTextSelection?.text.count ?? 0) > 160)
                    Spacer()
                    Button("Notes & More") {
                        viewModel.isQuickLookupPresented = false
                        viewModel.isInspectorPresented = true
                    }
                }
            }
            if !viewModel.isSelectionLookupBusy && !viewModel.selectionLookupStatus.isEmpty {
                Text(viewModel.selectionLookupStatus).font(.caption).foregroundStyle(.secondary).lineLimit(3)
            }
        }
        .padding(16).frame(width: 370)
        .background(PaperBridgeTheme.surface, in: RoundedRectangle(cornerRadius: 14))
        .shadow(color: .black.opacity(0.16), radius: 20, x: 0, y: 8)
        .onChange(of: viewModel.activeTextSelection?.identity) { _, _ in isSavingTerm = false }
    }
}
