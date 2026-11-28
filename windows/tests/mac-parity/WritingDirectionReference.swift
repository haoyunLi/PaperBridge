import AppKit
import SwiftUI

@MainActor
func nativeWritingDirections(fixtures: URL) throws -> [[String: Any]] {
    struct Sample: Decodable { let text: String; let tokens: [String] }
    let data = try Data(contentsOf: fixtures.appendingPathComponent("mixed-direction-notes.json"))
    let samples = try JSONDecoder().decode([Sample].self, from: data)
    func textView(_ view: NSView) -> NSTextView? {
        if let text = view as? NSTextView { return text }
        for child in view.subviews { if let text = textView(child) { return text } }
        return nil
    }
    var result: [[String: Any]] = []
    for sample in samples {
        let content = SelectableAcademicText(text: sample.text, paragraphID: 1, side: .original,
                                             annotations: [], onSelection: { _ in })
        let host = NSHostingView(rootView: content)
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 620, height: 120),
                              styleMask: [.borderless], backing: .buffered, defer: false)
        window.contentView = host
        window.orderFront(nil)
        defer { window.orderOut(nil) }
        let deadline = Date().addingTimeInterval(10)
        while textView(host)?.string != sample.text && Date() < deadline {
            RunLoop.main.run(until: Date().addingTimeInterval(0.03))
        }
        host.layoutSubtreeIfNeeded()
        guard let view = textView(host), view.string == sample.text,
              let layout = view.layoutManager, let container = view.textContainer else { throw CocoaError(.fileReadCorruptFile) }
        layout.ensureLayout(for: container)
        var positions: [(token: String, rect: NSRect)] = []
        for token in sample.tokens {
            let range = (sample.text as NSString).range(of: token)
            guard range.location != NSNotFound else { throw CocoaError(.fileReadCorruptFile) }
            let glyphs = layout.glyphRange(forCharacterRange: range, actualCharacterRange: nil)
            let rect = layout.boundingRect(forGlyphRange: glyphs, in: container)
            guard rect.width > 0 else { throw CocoaError(.fileReadCorruptFile) }
            positions.append((token, rect))
        }
        let line = layout.lineFragmentRect(forGlyphAt: 0, effectiveRange: nil)
        guard let left = positions.map({ $0.rect.minX }).min(), let right = positions.map({ $0.rect.maxX }).max() else {
            throw CocoaError(.fileReadCorruptFile)
        }
        let leftGap = left - line.minX, rightGap = line.maxX - right
        result.append(["text": sample.text, "tokensFromLeft": positions.sorted { $0.rect.midX < $1.rect.midX }.map { $0.token },
                       "alignedEdge": leftGap > rightGap ? "right" : "left", "leftGap": leftGap, "rightGap": rightGap])
    }
    return result
}

