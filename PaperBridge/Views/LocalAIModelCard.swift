import SwiftUI

struct LocalAIModelCard: View {
    let model: RecommendedOllamaModel
    let isInstalled: Bool
    let isSelected: Bool
    let isDownloading: Bool
    let isDisabled: Bool
    let progress: Double?
    let status: String
    let error: String?
    let onAction: () -> Void
    let onCancel: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: model.role == .translation ? "character.book.closed.fill" : "sparkles")
                    .font(.title3)
                    .foregroundStyle(model.role == .translation ? PaperBridgeTheme.accent : PaperBridgeTheme.translation)
                    .frame(width: 34, height: 34)
                    .background(
                        (model.role == .translation ? PaperBridgeTheme.accentSoft : PaperBridgeTheme.translationSoft),
                        in: RoundedRectangle(cornerRadius: 8, style: .continuous)
                    )

                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 7) {
                        Text(model.title)
                            .font(.headline)

                        Text(model.badge)
                            .font(.caption2.weight(.bold))
                            .foregroundStyle(model.role == .translation ? PaperBridgeTheme.accentDark : PaperBridgeTheme.translationInk)
                            .padding(.horizontal, 7)
                            .padding(.vertical, 3)
                            .background(
                                model.role == .translation ? PaperBridgeTheme.accentSoft : PaperBridgeTheme.translationSoft,
                                in: Capsule()
                            )

                        if isSelected {
                            Label("In use", systemImage: "checkmark.circle.fill")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(PaperBridgeTheme.success)
                        } else if isInstalled {
                            Label("Installed", systemImage: "checkmark.circle")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(.secondary)
                        }
                    }

                    Text(model.id)
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(.secondary)
                }

                Spacer(minLength: 8)

                if isDownloading {
                    Button("Cancel", role: .cancel, action: onCancel)
                } else {
                    Button(action: onAction) {
                        Label(actionTitle, systemImage: actionIcon)
                    }
                    .buttonStyle(.bordered)
                    .disabled(isDisabled || isSelected)
                }
            }

            Text(model.detail)
                .font(.callout)
                .foregroundStyle(PaperBridgeTheme.ink)
                .fixedSize(horizontal: false, vertical: true)

            HStack(spacing: 16) {
                Label(model.downloadSize, systemImage: "internaldrive")
                Label(model.macGuidance, systemImage: "memorychip")
            }
            .font(.caption)
            .foregroundStyle(.secondary)

            if isDownloading {
                if let progress {
                    ProgressView(value: progress)
                        .progressViewStyle(.linear)
                } else {
                    ProgressView()
                        .controlSize(.small)
                }

                Text(status)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if let error {
                Label(error, systemImage: "exclamationmark.triangle.fill")
                    .font(.caption)
                    .foregroundStyle(.orange)
                    .fixedSize(horizontal: false, vertical: true)
                    .textSelection(.enabled)
            }
        }
        .padding(14)
        .background(
            PaperBridgeTheme.surface,
            in: RoundedRectangle(cornerRadius: 12, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .strokeBorder(isSelected ? PaperBridgeTheme.success : PaperBridgeTheme.border)
        )
    }

    private var actionTitle: String {
        if isInstalled { return "Use Model" }
        return "Download"
    }

    private var actionIcon: String {
        if isInstalled { return "checkmark.circle" }
        return "arrow.down.circle.fill"
    }
}
