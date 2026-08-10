import AppKit
import Foundation

private let cobalt = NSColor(srgbRed: 0.039, green: 0.349, blue: 0.839, alpha: 1)
private let cobaltDark = NSColor(srgbRed: 0.027, green: 0.235, blue: 0.569, alpha: 1)
private let coral = NSColor(srgbRed: 0.910, green: 0.286, blue: 0.243, alpha: 1)
private let paper = NSColor(srgbRed: 1.000, green: 0.992, blue: 0.973, alpha: 1)

private func point(_ x: CGFloat, _ y: CGFloat, in bounds: NSRect) -> NSPoint {
    NSPoint(
        x: bounds.minX + bounds.width * x,
        y: bounds.maxY - bounds.height * y
    )
}

private func brandImage(size: Int, includesOuterPadding: Bool) -> NSImage {
    let dimension = CGFloat(size)
    let image = NSImage(size: NSSize(width: dimension, height: dimension))

    image.lockFocus()
    defer { image.unlockFocus() }

    NSColor.clear.setFill()
    NSRect(x: 0, y: 0, width: dimension, height: dimension).fill()

    let inset = includesOuterPadding ? dimension * 0.065 : 0
    let tileBounds = NSRect(
        x: inset,
        y: inset,
        width: dimension - inset * 2,
        height: dimension - inset * 2
    )
    let tile = NSBezierPath(
        roundedRect: tileBounds,
        xRadius: tileBounds.width * 0.235,
        yRadius: tileBounds.height * 0.235
    )
    cobalt.setFill()
    tile.fill()

    cobaltDark.withAlphaComponent(0.35).setStroke()
    tile.lineWidth = max(0.7, dimension * 0.006)
    tile.stroke()

    let leftPage = NSBezierPath()
    leftPage.move(to: point(0.18, 0.30, in: tileBounds))
    leftPage.curve(
        to: point(0.50, 0.39, in: tileBounds),
        controlPoint1: point(0.30, 0.26, in: tileBounds),
        controlPoint2: point(0.43, 0.31, in: tileBounds)
    )
    leftPage.line(to: point(0.50, 0.75, in: tileBounds))
    leftPage.curve(
        to: point(0.18, 0.65, in: tileBounds),
        controlPoint1: point(0.41, 0.65, in: tileBounds),
        controlPoint2: point(0.29, 0.61, in: tileBounds)
    )
    leftPage.close()

    let rightPage = NSBezierPath()
    rightPage.move(to: point(0.50, 0.39, in: tileBounds))
    rightPage.curve(
        to: point(0.82, 0.30, in: tileBounds),
        controlPoint1: point(0.57, 0.31, in: tileBounds),
        controlPoint2: point(0.70, 0.26, in: tileBounds)
    )
    rightPage.line(to: point(0.82, 0.65, in: tileBounds))
    rightPage.curve(
        to: point(0.50, 0.75, in: tileBounds),
        controlPoint1: point(0.71, 0.61, in: tileBounds),
        controlPoint2: point(0.59, 0.65, in: tileBounds)
    )
    rightPage.close()

    paper.setFill()
    leftPage.fill()
    rightPage.fill()

    let seam = NSBezierPath()
    seam.move(to: point(0.50, 0.36, in: tileBounds))
    seam.curve(
        to: point(0.50, 0.75, in: tileBounds),
        controlPoint1: point(0.48, 0.49, in: tileBounds),
        controlPoint2: point(0.48, 0.63, in: tileBounds)
    )
    coral.setStroke()
    seam.lineWidth = max(1.2, tileBounds.width * 0.045)
    seam.lineCapStyle = .round
    seam.stroke()

    if size >= 32 {
        cobaltDark.withAlphaComponent(0.42).setStroke()
        for y in [0.43, 0.51, 0.59] as [CGFloat] {
            let leftLine = NSBezierPath()
            leftLine.move(to: point(0.25, y, in: tileBounds))
            leftLine.line(to: point(0.43, y + 0.025, in: tileBounds))
            leftLine.lineWidth = max(0.7, tileBounds.width * 0.018)
            leftLine.lineCapStyle = .round
            leftLine.stroke()

            let rightLine = NSBezierPath()
            rightLine.move(to: point(0.57, y + 0.025, in: tileBounds))
            rightLine.line(to: point(0.75, y, in: tileBounds))
            rightLine.lineWidth = max(0.7, tileBounds.width * 0.018)
            rightLine.lineCapStyle = .round
            rightLine.stroke()
        }
    }

    return image
}

private func writePNG(_ image: NSImage, to url: URL) throws {
    guard
        let tiffData = image.tiffRepresentation,
        let bitmap = NSBitmapImageRep(data: tiffData),
        let pngData = bitmap.representation(using: .png, properties: [:])
    else {
        throw CocoaError(.fileWriteUnknown)
    }

    try pngData.write(to: url, options: .atomic)
}

guard CommandLine.arguments.count == 2 else {
    fputs("Usage: swift scripts/generate_brand_assets.swift <repository-root>\n", stderr)
    exit(2)
}

let root = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
let appIconDirectory = root.appendingPathComponent(
    "PaperBridge/Assets.xcassets/AppIcon.appiconset",
    isDirectory: true
)
let brandDirectory = root.appendingPathComponent(
    "PaperBridge/Assets.xcassets/BrandMark.imageset",
    isDirectory: true
)

let appIcons: [(String, Int)] = [
    ("appicon_16x16.png", 16),
    ("appicon_16x16@2x.png", 32),
    ("appicon_32x32.png", 32),
    ("appicon_32x32@2x.png", 64),
    ("appicon_128x128.png", 128),
    ("appicon_128x128@2x.png", 256),
    ("appicon_256x256.png", 256),
    ("appicon_256x256@2x.png", 512),
    ("appicon_512x512.png", 512),
    ("appicon_512x512@2x.png", 1024),
]

for (filename, size) in appIcons {
    try writePNG(
        brandImage(size: size, includesOuterPadding: true),
        to: appIconDirectory.appendingPathComponent(filename)
    )
}

try writePNG(
    brandImage(size: 128, includesOuterPadding: false),
    to: brandDirectory.appendingPathComponent("brandmark.png")
)
try writePNG(
    brandImage(size: 256, includesOuterPadding: false),
    to: brandDirectory.appendingPathComponent("brandmark@2x.png")
)

print("Generated PaperBridge brand assets.")
