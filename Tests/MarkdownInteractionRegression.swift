import AppKit
import WebKit

@main
struct MarkdownInteractionRegression {
    @MainActor
    static func main() async throws {
        _ = NSApplication.shared
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.userContentController.addUserScript(WKUserScript(
            source: MarkdownPreviewView.Coordinator.selectionBridgeScript,
            injectionTime: .atDocumentEnd, forMainFrameOnly: true
        ))
        let view = WKWebView(frame: NSRect(x: 0, y: 0, width: 700, height: 400), configuration: configuration)
        let paragraphs = (0..<80).map { "<p id='p\($0)'>Paragraph \($0) has a repeated gene then gene.</p>" }.joined()
        view.loadHTMLString("<html><style>p { height: 60px }</style><article>\(paragraphs)</article></html>", baseURL: nil)
        for _ in 0..<100 {
            try await Task.sleep(for: .milliseconds(50))
            if !view.isLoading { break }
        }
        let result = try await view.callAsyncJavaScript(#"""
        const p = document.getElementById('p40');
        const context = p.textContent;
        const entry = { quote: 'gene', context, locator: paperBridge.locator(p),
                        rangeLocation: context.lastIndexOf('gene'), rangeLength: 4,
                        side: 'original', highlight: 'amber', hasNote: true };
        if (!paperBridge.navigate(entry)) throw Error('Cannot navigate to a valid anchor');
        if (getSelection().getRangeAt(0).startOffset !== entry.rangeLocation) throw Error('Wrong repeated word');
        const position = paperBridge.snapshot();
        const positionBlock = [...document.querySelectorAll('p')].find(b => b.textContent === position.blockText);
        const selected = getSelection().toString();
        paperBridge.applyAnnotations([entry]);
        if (getSelection().toString() !== selected) throw Error('Highlight destroyed the selection');
        if (Math.abs(window.scrollY - position.y) > 2) throw Error('Highlight moved the reading position');
        const extra = document.createElement('p'); extra.textContent = 'Inserted translation';
        document.querySelector('article').prepend(extra);
        if (!paperBridge.navigate(entry)) throw Error('Stable anchor failed after insertion');
        if (getSelection().anchorNode.parentElement !== p) throw Error('Anchor jumped to another block');
        window.scrollTo(0, 0);
        paperBridge.restore(position);
        if (Math.abs(positionBlock.getBoundingClientRect().top - position.offset) > 2) throw Error('Block-relative position did not restore');
        const ambiguous = { ...entry, locator: 'web:missing', context: 'not in document' };
        if (paperBridge.navigate(ambiguous)) throw Error('Missing anchor silently chose an arbitrary match');
        const emoji = document.createElement('p'); emoji.textContent = 'A 🧬 gene then gene';
        document.querySelector('article').append(emoji);
        const unicodeEntry = { ...entry, context: emoji.textContent, locator: paperBridge.locator(emoji),
                               rangeLocation: emoji.textContent.lastIndexOf('gene') };
        if (!paperBridge.navigate(unicodeEntry) || getSelection().toString() !== 'gene') throw Error('UTF-16 range mismatch');
        paperBridge.setDefaultSide('translation');
        const translatedEntry = { ...unicodeEntry, locator: 'web:missing', side: 'translation' };
        if (!paperBridge.navigate(translatedEntry)) throw Error('Translation-only context could not recover');
        if (!paperBridge.locator(emoji).startsWith('web:block:t:')) throw Error('Translation-only anchor used original side');
        return true;
        """#, in: nil, contentWorld: .page)
        precondition(result as? Bool == true)
        view.stopLoading()
        print("Markdown interaction regression tests passed (navigation, repeated words, incremental highlights, position, changed layout, Unicode).")
    }
}
