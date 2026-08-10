import AppKit
import SwiftUI

enum PaperBridgeTheme {
    static let accent = adaptive(
        light: (0.039, 0.349, 0.839),
        dark: (0.36, 0.61, 0.98)
    )
    static let accentDark = adaptive(
        light: (0.027, 0.235, 0.569),
        dark: (0.24, 0.45, 0.83)
    )
    static let accentSoft = adaptive(
        light: (0.863, 0.914, 1.000),
        dark: (0.075, 0.145, 0.255)
    )
    static let translation = adaptive(
        light: (0.910, 0.286, 0.243),
        dark: (1.000, 0.435, 0.376)
    )
    static let translationInk = adaptive(
        light: (0.667, 0.161, 0.137),
        dark: (1.000, 0.435, 0.376)
    )
    static let translationButton = Color(
        red: 0.667,
        green: 0.161,
        blue: 0.137
    )
    static let translationSoft = adaptive(
        light: (0.992, 0.902, 0.875),
        dark: (0.245, 0.100, 0.095)
    )
    static let canvas = adaptive(
        light: (0.953, 0.933, 0.894),
        dark: (0.047, 0.071, 0.102)
    )
    static let surface = adaptive(
        light: (1.000, 0.992, 0.973),
        dark: (0.071, 0.102, 0.137)
    )
    static let inset = adaptive(
        light: (0.898, 0.867, 0.812),
        dark: (0.098, 0.137, 0.180)
    )
    static let border = adaptive(
        light: (0.812, 0.776, 0.722),
        dark: (0.190, 0.255, 0.325)
    )
    static let originalLabel = adaptive(
        light: (0.337, 0.376, 0.424),
        dark: (0.650, 0.720, 0.795)
    )
    static let ink = adaptive(
        light: (0.071, 0.125, 0.200),
        dark: (0.925, 0.945, 0.965)
    )
    static let sidebar = Color(red: 0.071, green: 0.125, blue: 0.200)
    static let sidebarSurface = Color(red: 0.094, green: 0.165, blue: 0.255)
    static let sidebarInput = Color(red: 0.055, green: 0.106, blue: 0.176)
    static let sidebarBorder = Color(red: 0.190, green: 0.286, blue: 0.400)
    static let sidebarAccent = Color(red: 0.420, green: 0.650, blue: 1.000)
    static let paperWhite = Color(red: 1.000, green: 0.992, blue: 0.973)
    static let warning = Color(red: 0.941, green: 0.627, blue: 0.149)
    static let success = Color(red: 0.118, green: 0.553, blue: 0.424)
    static let accentNSColor = NSColor(
        srgbRed: 0.039,
        green: 0.349,
        blue: 0.839,
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
        PaperBridgeLogo()
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }
}

struct PaperBridgeLogo: View {
    var body: some View {
        Canvas { context, size in
            let unit = min(size.width, size.height)
            let bounds = CGRect(
                x: (size.width - unit) / 2,
                y: (size.height - unit) / 2,
                width: unit,
                height: unit
            )

            let tile = Path(
                roundedRect: bounds,
                cornerRadius: unit * 0.235
            )
            context.fill(tile, with: .color(PaperBridgeTheme.accent))

            var leftPage = Path()
            leftPage.move(to: point(0.18, 0.30, in: bounds))
            leftPage.addCurve(
                to: point(0.50, 0.39, in: bounds),
                control1: point(0.30, 0.26, in: bounds),
                control2: point(0.43, 0.31, in: bounds)
            )
            leftPage.addLine(to: point(0.50, 0.75, in: bounds))
            leftPage.addCurve(
                to: point(0.18, 0.65, in: bounds),
                control1: point(0.41, 0.65, in: bounds),
                control2: point(0.29, 0.61, in: bounds)
            )
            leftPage.closeSubpath()

            var rightPage = Path()
            rightPage.move(to: point(0.50, 0.39, in: bounds))
            rightPage.addCurve(
                to: point(0.82, 0.30, in: bounds),
                control1: point(0.57, 0.31, in: bounds),
                control2: point(0.70, 0.26, in: bounds)
            )
            rightPage.addLine(to: point(0.82, 0.65, in: bounds))
            rightPage.addCurve(
                to: point(0.50, 0.75, in: bounds),
                control1: point(0.71, 0.61, in: bounds),
                control2: point(0.59, 0.65, in: bounds)
            )
            rightPage.closeSubpath()

            context.fill(leftPage, with: .color(PaperBridgeTheme.paperWhite))
            context.fill(rightPage, with: .color(PaperBridgeTheme.paperWhite))

            var seam = Path()
            seam.move(to: point(0.50, 0.36, in: bounds))
            seam.addCurve(
                to: point(0.50, 0.75, in: bounds),
                control1: point(0.48, 0.49, in: bounds),
                control2: point(0.48, 0.63, in: bounds)
            )
            context.stroke(
                seam,
                with: .color(PaperBridgeTheme.translation),
                style: StrokeStyle(lineWidth: max(1.5, unit * 0.045), lineCap: .round)
            )

            let lineColor = PaperBridgeTheme.accentDark.opacity(0.42)
            for y in [0.43, 0.51, 0.59] {
                var leftLine = Path()
                leftLine.move(to: point(0.25, y, in: bounds))
                leftLine.addLine(to: point(0.43, y + 0.025, in: bounds))
                context.stroke(
                    leftLine,
                    with: .color(lineColor),
                    lineWidth: max(0.7, unit * 0.018)
                )

                var rightLine = Path()
                rightLine.move(to: point(0.57, y + 0.025, in: bounds))
                rightLine.addLine(to: point(0.75, y, in: bounds))
                context.stroke(
                    rightLine,
                    with: .color(lineColor),
                    lineWidth: max(0.7, unit * 0.018)
                )
            }
        }
    }

    private func point(_ x: CGFloat, _ y: CGFloat, in bounds: CGRect) -> CGPoint {
        CGPoint(
            x: bounds.minX + bounds.width * x,
            y: bounds.minY + bounds.height * y
        )
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
                Text(title)
            }
            .font(.caption.weight(.semibold))
            .foregroundStyle(PaperBridgeTheme.sidebarAccent)

            content
        }
        .padding(14)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(PaperBridgeTheme.sidebarSurface)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
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
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(PaperBridgeTheme.surface)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
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
            PaperBridgeTheme.accentSoft,
            in: RoundedRectangle(cornerRadius: 8, style: .continuous)
        )
    }
}

struct OllamaStatusBadge: View {
    let isRefreshing: Bool
    let isAvailable: Bool

    private var color: Color {
        if isRefreshing { return PaperBridgeTheme.warning }
        return isAvailable ? PaperBridgeTheme.success : .orange
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
