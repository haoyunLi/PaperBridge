import SwiftUI

struct ReadingToolsView: View {
    @Binding var appearance: ReadingAppearance
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("Reading Appearance").font(.headline)
            control("Text size", value: $appearance.fontSize, range: 13...24, suffix: "pt")
            control("Line spacing", value: $appearance.lineSpacing, range: 2...12, suffix: "pt")
            control("Reading width", value: $appearance.contentWidth, range: 640...1200, suffix: "pt")
            Text("Applies to Reader and text previews. Original PDF pages keep their own layout and zoom.")
                .font(.caption).foregroundStyle(.secondary)
            Button("Reset Appearance") { appearance = ReadingAppearance() }
        }
        .padding(20)
        .frame(width: 300)
    }

    private func control(_ title: String, value: Binding<Double>, range: ClosedRange<Double>, suffix: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(title)
                Spacer()
                Text("\(Int(value.wrappedValue)) \(suffix)").monospacedDigit().foregroundStyle(.secondary)
            }
            Slider(value: value, in: range, step: 1).accessibilityLabel(title)
        }
    }
}

struct ParagraphQualityView: View {
    @ObservedObject var viewModel: PaperReaderViewModel
    @State private var expanded = false

    var body: some View {
        DisclosureGroup(isExpanded: $expanded) {
            VStack(alignment: .leading, spacing: 14) {
                Text("Suggestions, not corrections. Equations, headings, and captions can legitimately end without a period. No source text has been changed.")
                    .font(.callout).foregroundStyle(.secondary)
                ForEach(viewModel.qualityIssues.prefix(40)) { issue in
                    HStack(alignment: .top, spacing: 16) {
                        VStack(alignment: .leading, spacing: 5) {
                            Text("Paragraph \(issue.paragraphID)").font(.callout.weight(.semibold))
                            Text(issue.reason).font(.callout)
                            if let paragraph = viewModel.paragraphResults.first(where: { $0.id == issue.paragraphID }) {
                                Text(String(paragraph.original.suffix(160))).font(.caption).foregroundStyle(.secondary).lineLimit(3)
                            }
                        }
                        Spacer(minLength: 0)
                        Button("Review") {
                            viewModel.workspaceMode = .reader
                            viewModel.displayMode = .bilingual
                            viewModel.navigateToParagraph(issue.paragraphID)
                        }
                        .buttonStyle(.bordered)
                    }
                    Divider()
                }
                if viewModel.qualityIssues.count > 40 {
                    Text("Showing the first 40 suggestions. Each affected Reader block also shows its warning.")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
            .padding(.top, 12)
        } label: {
            Label("Check \(viewModel.qualityIssues.count) possible extraction issues", systemImage: "text.badge.checkmark")
                .font(.headline)
        }
        .padding(18)
        .background(PaperBridgeTheme.inset, in: RoundedRectangle(cornerRadius: 12))
    }
}
