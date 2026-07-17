import AppKit
import SwiftUI
import WebKit

struct MarkdownPreviewView: NSViewRepresentable {
    let markdown: String
    let title: String
    let resourceDirectory: URL?
    var presentation: MarkdownPreviewPresentation = .document
    var selectionScope: TextSelectionScope?
    var defaultSelectionSide: ReaderTextSide = .original
    var annotations: [PaperAnnotation] = []
    var onSelection: ((ReaderTextSelection) -> Void)?

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeNSView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true

        let mathConfiguration = """
        window.MathJax = {
          tex: {
            inlineMath: [['$', '$'], ['\\\\(', '\\\\)']],
            displayMath: [['$$', '$$'], ['\\\\[', '\\\\]']],
            processEscapes: true
          },
          svg: { fontCache: 'local' },
          options: { skipHtmlTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code'] }
        };
        """
        configuration.userContentController.addUserScript(
            WKUserScript(
                source: mathConfiguration,
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true
            )
        )
        configuration.userContentController.add(
            context.coordinator,
            name: Coordinator.selectionMessageName
        )
        configuration.userContentController.addUserScript(
            WKUserScript(
                source: Coordinator.selectionBridgeScript,
                injectionTime: .atDocumentEnd,
                forMainFrameOnly: true
            )
        )

        if let mathJaxURL = Bundle.main.url(
            forResource: "tex-svg-full",
            withExtension: "js"
        ), let mathJaxSource = try? String(contentsOf: mathJaxURL, encoding: .utf8) {
            configuration.userContentController.addUserScript(
                WKUserScript(
                    source: mathJaxSource,
                    injectionTime: .atDocumentEnd,
                    forMainFrameOnly: true
                )
            )
        }

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.setValue(false, forKey: "drawsBackground")
        webView.allowsMagnification = true
        webView.magnification = 1
        webView.isInspectable = false
        return webView
    }

    func updateNSView(_ webView: WKWebView, context: Context) {
        context.coordinator.selectionScope = selectionScope
        context.coordinator.defaultSelectionSide = defaultSelectionSide
        context.coordinator.onSelection = onSelection
        context.coordinator.annotations = annotations

        let annotationSignature = annotations.map {
            "\($0.id.uuidString)|\($0.highlightColor?.rawValue ?? "")|\($0.note)|\($0.quote)|\($0.rangeLocation)|\($0.rangeLength)"
        }.joined(separator: "|")
        let fingerprint = Hashing.sha256(
            markdown + "|" + title + "|" + (resourceDirectory?.path ?? "") + "|" +
                presentation.rawValue + "|" + annotationSignature
        )
        guard context.coordinator.lastFingerprint != fingerprint else { return }
        context.coordinator.lastFingerprint = fingerprint

        let html = MarkdownPreviewHTMLRenderer.render(
            markdown: markdown,
            title: title,
            presentation: presentation
        )
        let root = usableResourceDirectory() ?? previewCacheDirectory()
        context.coordinator.allowedRoot = root.standardizedFileURL

        do {
            try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
            let previewURL = root.appendingPathComponent(
                ".paperbridge-preview-\(fingerprint.prefix(16)).html"
            )
            try Data(html.utf8).write(to: previewURL, options: .atomic)
            webView.loadFileURL(previewURL, allowingReadAccessTo: root)
        } catch {
            webView.loadHTMLString(html, baseURL: root)
        }
    }

    static func dismantleNSView(_ webView: WKWebView, coordinator: Coordinator) {
        webView.stopLoading()
        webView.navigationDelegate = nil
        webView.configuration.userContentController.removeScriptMessageHandler(
            forName: Coordinator.selectionMessageName
        )
    }

    private func usableResourceDirectory() -> URL? {
        guard let resourceDirectory,
              FileManager.default.fileExists(atPath: resourceDirectory.path) else { return nil }
        return resourceDirectory
    }

    private func previewCacheDirectory() -> URL {
        let cacheRoot = FileManager.default.urls(
            for: .cachesDirectory,
            in: .userDomainMask
        ).first ?? FileManager.default.temporaryDirectory
        return cacheRoot
            .appendingPathComponent("PaperBridge", isDirectory: true)
            .appendingPathComponent("MarkdownPreview", isDirectory: true)
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        static let selectionMessageName = "paperBridgeSelection"
        static let selectionBridgeScript = #"""
        (() => {
          if (window.__paperBridgeSelectionBridgeInstalled) return;
          window.__paperBridgeSelectionBridgeInstalled = true;
          const blockSelector = 'p,h1,h2,h3,h4,h5,h6,blockquote,td,th,figcaption,.list-item,pre';

          function elementFor(node) {
            return node && node.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
          }

          function captureSelection() {
            const selection = window.getSelection();
            if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;
            const text = selection.toString();
            if (!text || !text.trim()) return;

            const range = selection.getRangeAt(0);
            const article = document.querySelector('article');
            if (!article || !article.contains(range.commonAncestorContainer)) return;

            const startElement = elementFor(range.startContainer);
            const endElement = elementFor(range.endContainer);
            let block = startElement?.closest(blockSelector) || article;
            if (!block.contains(endElement)) block = article;

            const prefix = document.createRange();
            prefix.selectNodeContents(block);
            prefix.setEnd(range.startContainer, range.startOffset);
            const blocks = Array.from(document.querySelectorAll(blockSelector));
            const blockIndex = blocks.indexOf(block);

            window.webkit?.messageHandlers?.paperBridgeSelection?.postMessage({
              text,
              context: block.textContent || text,
              rangeLocation: prefix.toString().length,
              rangeLength: text.length,
              locator: block === article ? 'web:article' : `web:${blockIndex}`,
              translationRegion: !!startElement?.closest('.paperbridge-translation')
            });
          }

          document.addEventListener('mouseup', () => setTimeout(captureSelection, 0), true);
          document.addEventListener('keyup', event => {
            if (event.shiftKey || event.key.startsWith('Arrow')) {
              setTimeout(captureSelection, 0);
            }
          }, true);
        })();
        """#

        var lastFingerprint: String?
        var allowedRoot: URL?
        var selectionScope: TextSelectionScope?
        var defaultSelectionSide: ReaderTextSide = .original
        var onSelection: ((ReaderTextSelection) -> Void)?
        var annotations: [PaperAnnotation] = []

        func userContentController(
            _ userContentController: WKUserContentController,
            didReceive message: WKScriptMessage
        ) {
            guard message.name == Self.selectionMessageName,
                  let scope = selectionScope,
                  let payload = message.body as? [String: Any],
                  let text = payload["text"] as? String,
                  let context = payload["context"] as? String,
                  let rangeLocation = payload["rangeLocation"] as? Int,
                  let rangeLength = payload["rangeLength"] as? Int,
                  !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                return
            }

            let isTranslationRegion = payload["translationRegion"] as? Bool ?? false
            let side: ReaderTextSide = isTranslationRegion ? .translation : defaultSelectionSide
            onSelection?(
                ReaderTextSelection(
                    scope: scope,
                    paragraphID: 0,
                    side: side,
                    text: text,
                    context: context,
                    rangeLocation: rangeLocation,
                    rangeLength: rangeLength,
                    locator: payload["locator"] as? String
                )
            )
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation?) {
            applyAnnotations(in: webView)
        }

        private func applyAnnotations(in webView: WKWebView) {
            let visibleAnnotations = annotations.filter {
                $0.highlightColor != nil ||
                    !$0.note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            }
            let objects: [[String: Any]] = visibleAnnotations.map { annotation in
                [
                    "quote": annotation.quote,
                    "context": annotation.context as Any? ?? NSNull(),
                    "locator": annotation.locator as Any? ?? NSNull(),
                    "rangeLocation": annotation.rangeLocation,
                    "rangeLength": annotation.rangeLength,
                    "highlight": annotation.highlightColor?.rawValue as Any? ?? NSNull(),
                    "hasNote": !annotation.note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                ]
            }
            guard JSONSerialization.isValidJSONObject(objects),
                  let data = try? JSONSerialization.data(withJSONObject: objects),
                  let payload = String(data: data, encoding: .utf8) else {
                return
            }

            let script = #"""
            (() => {
              if (!window.CSS || !CSS.highlights || typeof Highlight === 'undefined') return;
              const names = ['paperbridge-amber', 'paperbridge-teal', 'paperbridge-coral', 'paperbridge-note'];
              names.forEach(name => CSS.highlights.delete(name));
              const entries = \#(payload);
              if (!entries.length) return;

              const selector = 'p,h1,h2,h3,h4,h5,h6,blockquote,td,th,figcaption,.list-item,pre';
              const article = document.querySelector('article');
              const blocks = Array.from(document.querySelectorAll(selector));
              const buckets = { amber: [], teal: [], coral: [], note: [] };

              function textRange(root, start, length) {
                const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
                const end = start + length;
                let offset = 0;
                let startNode = null;
                let startOffset = 0;
                let endNode = null;
                let endOffset = 0;
                let node;
                while ((node = walker.nextNode())) {
                  const next = offset + node.nodeValue.length;
                  if (!startNode && start >= offset && start <= next) {
                    startNode = node;
                    startOffset = Math.min(start - offset, node.nodeValue.length);
                  }
                  if (startNode && end >= offset && end <= next) {
                    endNode = node;
                    endOffset = Math.min(end - offset, node.nodeValue.length);
                    break;
                  }
                  offset = next;
                }
                if (!startNode || !endNode) return null;
                const range = document.createRange();
                range.setStart(startNode, startOffset);
                range.setEnd(endNode, endOffset);
                return range;
              }

              function rootFor(entry) {
                let root = null;
                if (entry.locator === 'web:article') root = article;
                else if (entry.locator?.startsWith('web:')) {
                  const index = Number(entry.locator.slice(4));
                  if (Number.isInteger(index) && index >= 0 && index < blocks.length) root = blocks[index];
                }
                if (root && entry.context && root.textContent !== entry.context) root = null;
                if (!root && entry.context) {
                  root = blocks.find(block => block.textContent === entry.context) || null;
                }
                return root || article;
              }

              entries.forEach(entry => {
                let root = rootFor(entry);
                if (!root) return;
                let source = root.textContent || '';
                let location = entry.rangeLocation;
                if (source.slice(location, location + entry.rangeLength) !== entry.quote) {
                  location = source.indexOf(entry.quote);
                }
                if (location < 0 && root !== article && article) {
                  root = article;
                  source = article.textContent || '';
                  location = source.indexOf(entry.quote);
                }
                if (location < 0) return;
                const range = textRange(root, location, entry.quote.length);
                if (!range) return;
                if (entry.highlight && buckets[entry.highlight]) buckets[entry.highlight].push(range);
                if (entry.hasNote) buckets.note.push(range);
              });

              Object.entries(buckets).forEach(([name, ranges]) => {
                if (ranges.length) CSS.highlights.set(`paperbridge-${name}`, new Highlight(...ranges));
              });
            })();
            """#
            webView.evaluateJavaScript(script)
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            guard navigationAction.navigationType == .linkActivated,
                  let url = navigationAction.request.url else {
                decisionHandler(.allow)
                return
            }

            if url.isFileURL,
               let allowedRoot,
               url.standardizedFileURL.path.hasPrefix(allowedRoot.path + "/") {
                if url.pathExtension.lowercased() == "pdf" {
                    NSWorkspace.shared.open(url)
                    decisionHandler(.cancel)
                } else {
                    decisionHandler(.allow)
                }
                return
            }

            if ["https", "http", "mailto"].contains(url.scheme?.lowercased() ?? "") {
                NSWorkspace.shared.open(url)
            }
            decisionHandler(.cancel)
        }
    }
}
