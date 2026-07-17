import AppKit
import SwiftUI

enum PaperBridgeTheme {
    static let accent = adaptive(
        light: (0.07, 0.41, 0.35),
        dark: (0.35, 0.78, 0.68)
    )
    static let canvas = adaptive(
        light: (0.94, 0.93, 0.90),
        dark: (0.07, 0.08, 0.09)
    )
    static let surface = adaptive(
        light: (0.99, 0.98, 0.96),
        dark: (0.09, 0.11, 0.12)
    )
    static let inset = adaptive(
        light: (0.91, 0.90, 0.87),
        dark: (0.12, 0.15, 0.16)
    )
    static let border = adaptive(
        light: (0.81, 0.80, 0.76),
        dark: (0.19, 0.23, 0.24)
    )
    static let originalLabel = adaptive(
        light: (0.35, 0.37, 0.36),
        dark: (0.65, 0.69, 0.68)
    )
    static let sidebar = Color(red: 0.055, green: 0.075, blue: 0.078)
    static let sidebarSurface = Color(red: 0.085, green: 0.115, blue: 0.118)
    static let sidebarInput = Color(red: 0.065, green: 0.090, blue: 0.093)
    static let sidebarBorder = Color(red: 0.16, green: 0.21, blue: 0.21)
    static let sidebarAccent = Color(red: 0.35, green: 0.78, blue: 0.68)
    static let warning = Color(red: 0.89, green: 0.57, blue: 0.20)
    static let accentNSColor = NSColor(
        srgbRed: 0.07,
        green: 0.41,
        blue: 0.35,
        alpha: 1
    )

    private static func adaptive(
        light: (CGFloat, CGFloat, CGFloat),
        dark: (CGFloat, CGFloat, CGFloat)
    ) -> Color {
        Color(
            nsColor: NSColor(name: nil) { appearance in
                let values = appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
                    ? dark
                    : light
                return NSColor(
                    srgbRed: values.0,
                    green: values.1,
                    blue: values.2,
                    alpha: 1
                )
            }
        )
    }
}

struct PaperBridgeBackground: View {
    var body: some View {
        PaperBridgeTheme.canvas
            .ignoresSafeArea()
    }
}

struct AppIconBadge: View {
    let size: CGFloat

    var body: some View {
        Image("BrandMark")
            .resizable()
            .interpolation(.high)
            .scaledToFit()
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }
}

struct SidebarCard<Content: View>: View {
    let title: String
    let icon: String
    let content: Content

    init(title: String, icon: String, @ViewBuilder content: () -> Content) {
        self.title = title
        self.icon = icon
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Image(systemName: icon)
                Text(title.uppercased())
                    .tracking(1.1)
            }
            .font(.caption.weight(.bold))
            .foregroundStyle(PaperBridgeTheme.sidebarAccent)

            content
        }
        .padding(14)
        .background(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(PaperBridgeTheme.sidebarSurface)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .strokeBorder(PaperBridgeTheme.sidebarBorder)
        )
    }
}

struct SurfaceCard<Content: View>: View {
    var isHighlighted = false
    var accent: Color = .accentColor
    var contentPadding: CGFloat = 22
    let content: Content

    init(
        isHighlighted: Bool = false,
        accent: Color = .accentColor,
        contentPadding: CGFloat = 22,
        @ViewBuilder content: () -> Content
    ) {
        self.isHighlighted = isHighlighted
        self.accent = accent
        self.contentPadding = contentPadding
        self.content = content()
    }

    var body: some View {
        content
            .padding(contentPadding)
            .background(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(PaperBridgeTheme.surface)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .strokeBorder(
                        isHighlighted ? accent : PaperBridgeTheme.border,
                        lineWidth: isHighlighted ? 2 : 1
                    )
            )
    }
}

struct MetricPill: View {
    let title: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(value)
                .font(.headline)
        }
        .padding(.horizontal, 13)
        .padding(.vertical, 9)
        .background(
            PaperBridgeTheme.inset,
            in: RoundedRectangle(cornerRadius: 8, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .strokeBorder(PaperBridgeTheme.border)
        )
    }
}

struct OllamaStatusBadge: View {
    let isRefreshing: Bool
    let isAvailable: Bool

    private var color: Color {
        if isRefreshing { return PaperBridgeTheme.warning }
        return isAvailable ? .green : .orange
    }

    private var label: String {
        if isRefreshing { return "Checking Ollama" }
        return isAvailable ? "Ollama Ready" : "Ollama Offline"
    }

    var body: some View {
        HStack(spacing: 7) {
            if isRefreshing {
                ProgressView()
                    .controlSize(.mini)
            } else {
                Circle()
                    .fill(color)
                    .frame(width: 7, height: 7)
            }

            Text(label)
                .font(.caption.weight(.semibold))
        }
        .foregroundStyle(color)
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(
            color.opacity(0.10),
            in: RoundedRectangle(cornerRadius: 6, style: .continuous)
        )
    }
}

struct ParagraphEditorSheet: View {
    let paragraphID: Int?
    @Binding var text: String
    let onCancel: () -> Void
    let onSave: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(alignment: .top, spacing: 14) {
                Image(systemName: "text.badge.checkmark")
                    .font(.system(size: 28, weight: .semibold))
                    .foregroundStyle(.tint)
                    .frame(width: 48, height: 48)
                    .background(
                        Color.accentColor.opacity(0.12),
                        in: RoundedRectangle(cornerRadius: 14)
                    )

                VStack(alignment: .leading, spacing: 5) {
                    Text("Repair Paragraph \(paragraphID.map(String.init) ?? "")")
                        .font(.title2.weight(.bold))

                    Text("Fix extraction errors directly. Insert a blank line wherever this text should become a new paragraph.")
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            TextEditor(text: $text)
                .font(.system(size: 15, weight: .regular, design: .serif))
                .lineSpacing(5)
                .scrollContentBackground(.hidden)
                .padding(12)
                .background(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(PaperBridgeTheme.surface)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .strokeBorder(PaperBridgeTheme.border)
                )

            HStack {
                Text("\(text.count) characters. Changes invalidate only affected translation output.")
                    .font(.caption)
                    .foregroundStyle(.secondary)

                Spacer()

                Button("Cancel", action: onCancel)
                    .keyboardShortcut(.cancelAction)

                Button("Save", action: onSave)
                    .buttonStyle(.borderedProminent)
                    .keyboardShortcut(.defaultAction)
                    .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(24)
        .frame(minWidth: 700, minHeight: 500)
    }
}
