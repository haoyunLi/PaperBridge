import SwiftUI

struct ReadingGuideView: View {
    let entries: [ReadingGuideEntry]
    let hasText: Bool
    let translatedCount: Int
    let paragraphCount: Int
    let onRead: () -> Void
    let onOpenSource: () -> Void
    let onOpenPassage: (ReadingGuideEntry) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 22) {
            HStack(alignment: .top, spacing: 18) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Find your way into the paper.")
                        .font(.system(size: 30, weight: .semibold, design: .serif))
                    Text("A map of detected sections with exact source excerpts. No model is used, and these passages are not an AI summary.")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
            }
            HStack(spacing: 12) {
                Button("Start Reading", action: onRead)
                    .buttonStyle(.borderedProminent)
                    .disabled(!hasText)
                Button("View Original", action: onOpenSource)
                    .buttonStyle(.bordered)
                Spacer(minLength: 0)
                Text("\(translatedCount) / \(paragraphCount) translated")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
            }
            if entries.isEmpty {
                Text(hasText
                     ? "No suitable section passages were detected. Start in Reader and inspect the source directly."
                     : "This document has no selectable text. You can still view its original pages; use MinerU/OCR to make scanned text readable by the analysis tools.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
            ForEach(entries) { entry in
                VStack(alignment: .leading, spacing: 10) {
                    Divider()
                    HStack(alignment: .firstTextBaseline) {
                        Text(entry.title).font(.title3.weight(.semibold))
                        Spacer()
                        Button {
                            onOpenPassage(entry)
                        } label: {
                            Label("Read paragraph \(entry.paragraphID)", systemImage: "arrow.right")
                        }
                        .buttonStyle(.borderless)
                        .help("Open the exact source passage in Reader")
                    }
                    Text(entry.question).font(.callout).foregroundStyle(.secondary)
                    Text(entry.excerpt)
                        .font(.system(size: 16, design: .serif))
                        .lineSpacing(4)
                        .lineLimit(4)
                        .textSelection(.enabled)
                    Text("SOURCE EXCERPT · \(entry.sectionTitle)")
                        .font(.caption2.weight(.medium))
                        .foregroundStyle(PaperBridgeTheme.originalLabel)
                }
            }
            Text("Missing sections are not invented. Headings and reading order depend on extraction; verify scientific claims against the source.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(24)
        .background(PaperBridgeTheme.surface, in: RoundedRectangle(cornerRadius: 12))
    }
}
