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
        var positions: [(token: String, x: CGFloat)] = []
        for token in sample.tokens {
            let range = (sample.text as NSString).range(of: token)
            guard range.location != NSNotFound else { throw CocoaError(.fileReadCorruptFile) }
            let glyphs = layout.glyphRange(forCharacterRange: range, actualCharacterRange: nil)
            let rect = layout.boundingRect(forGlyphRange: glyphs, in: container)
            guard rect.width > 0 else { throw CocoaError(.fileReadCorruptFile) }
            positions.append((token, rect.midX))
        }
        let used = layout.lineFragmentUsedRect(forGlyphAt: 0, effectiveRange: nil)
        let line = layout.lineFragmentRect(forGlyphAt: 0, effectiveRange: nil)
        let edge = used.midX > line.midX ? "right" : "left"
        result.append(["text": sample.text, "tokensFromLeft": positions.sorted { $0.x < $1.x }.map { $0.token },
                       "alignedEdge": edge])
    }
    return result
}

