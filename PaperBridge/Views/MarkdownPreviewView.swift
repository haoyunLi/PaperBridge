import AppKit
import SwiftUI
import WebKit

struct MarkdownPreviewView: NSViewRepresentable {
    @Environment(\.readingAppearance) private var readingAppearance
    let markdown: String
    let title: String
    let resourceDirectory: URL?
    var presentation: MarkdownPreviewPresentation = .document
    var selectionScope: TextSelectionScope?
    var defaultSelectionSide: ReaderTextSide = .original
    var annotations: [PaperAnnotation] = []
    var navigationRequest: AnnotationNavigationRequest?
    var readingPosition: ReadingPosition?
    var onPositionChange: ((ReadingPosition) -> Void)?
    var onNavigationFailure: (() -> Void)?
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
                source: Coordinator.selectionBridgeScript + "\nwindow.paperBridge?.setDefaultSide('\(defaultSelectionSide.rawValue)');",
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
        context.coordinator.navigationRequest = navigationRequest
        context.coordinator.onNavigationFailure = onNavigationFailure
        context.coordinator.onPositionChange = onPositionChange
        if context.coordinator.lastFingerprint == nil {
            context.coordinator.savedPosition = readingPosition
        }

        let annotationSignature = annotations.map {
            "\($0.id.uuidString)|\($0.highlightColor?.rawValue ?? "")|\($0.note)|\($0.quote)|\($0.rangeLocation)|\($0.rangeLength)"
        }.joined(separator: "|")
        let fingerprint = Hashing.sha256(
            markdown + "|" + title + "|" + (resourceDirectory?.path ?? "") + "|" +
                presentation.rawValue + "|\(readingAppearance?.clamped.fontSize ?? 17)|\(readingAppearance?.clamped.lineSpacing ?? 5)|\(readingAppearance?.clamped.contentWidth ?? 920)"
        )
        let annotationsChanged = context.coordinator.annotationSignature != annotationSignature
        context.coordinator.annotationSignature = annotationSignature
        guard context.coordinator.lastFingerprint != fingerprint else {
            if annotationsChanged, !context.coordinator.isLoading { context.coordinator.applyAnnotations(in: webView) }
            context.coordinator.navigateIfNeeded(in: webView)
            return
        }
        context.coordinator.lastFingerprint = fingerprint

        let html = MarkdownPreviewHTMLRenderer.render(
            markdown: markdown,
            title: title,
            presentation: presentation,
            appearance: readingAppearance
        )
        let root = usableResourceDirectory() ?? previewCacheDirectory()
        context.coordinator.allowedRoot = root.standardizedFileURL

        let coordinator = context.coordinator
        let load = {
            guard coordinator.lastFingerprint == fingerprint else { return }
            coordinator.isLoading = true
            do {
                try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
                let previewURL = root.appendingPathComponent(".paperbridge-preview-\(fingerprint.prefix(16)).html")
                try Data(html.utf8).write(to: previewURL, options: .atomic)
                webView.loadFileURL(previewURL, allowingReadAccessTo: root)
            } catch {
                webView.loadHTMLString(html, baseURL: root)
            }
        }
        if webView.url != nil, !coordinator.isLoading {
            webView.evaluateJavaScript("window.paperBridge?.snapshot()") { value, _ in
                guard coordinator.lastFingerprint == fingerprint else { return }
                if let position = Coordinator.decodePosition(value) { coordinator.savedPosition = position }
                load()
            }
        } else {
            load()
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
            window.webkit?.messageHandlers?.paperBridgeSelection?.postMessage({
              text,
              context: block.textContent || text,
              rangeLocation: prefix.toString().length,
              rangeLength: text.length,
              locator: block === article ? 'web:article' : window.paperBridge.locator(block),
              translationRegion: !!startElement?.closest('.paperbridge-translation')
            });
          }

          document.addEventListener('mouseup', () => setTimeout(captureSelection, 0), true);
          document.addEventListener('keyup', event => {
            if (event.shiftKey || event.key.startsWith('Arrow')) {
              setTimeout(captureSelection, 0);
            }
          }, true);

          const blocks = () => Array.from(document.querySelectorAll(blockSelector));
          let defaultSide = 'original';
          const isTranslation = block => defaultSide === 'translation' || !!block.closest('.paperbridge-translation');
          function key(block) {
            let hash = 2166136261;
            for (const char of block.textContent || '') hash = Math.imul(hash ^ char.codePointAt(0), 16777619);
            return `${isTranslation(block) ? 't' : 'o'}:${hash >>> 0}`;
          }
          function locator(block) {
            return locators().get(block);
          }
          function locators() {
            const counts = new Map(), result = new Map();
            blocks().forEach(block => {
              const hash = key(block), ordinal = counts.get(hash) || 0;
              counts.set(hash, ordinal + 1);
              result.set(block, `web:block:${hash}:${ordinal}`);
            });
            return result;
          }
          function textRange(root, start, length) {
            if (start < 0 || length <= 0) return null;
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
            let offset = 0, first = null, last = null, firstOffset = 0, lastOffset = 0, node;
            while ((node = walker.nextNode())) {
              const next = offset + node.nodeValue.length;
              if (!first && start >= offset && start < next) { first = node; firstOffset = start - offset; }
              if (first && start + length <= next) { last = node; lastOffset = start + length - offset; break; }
              offset = next;
            }
            if (!first || !last) return null;
            const range = document.createRange();
            range.setStart(first, firstOffset); range.setEnd(last, lastOffset);
            return range;
          }
          function resolve(entry) {
            const article = document.querySelector('article');
            const candidates = blocks();
            let root = null;
            if (entry.locator === 'web:article') root = article;
            else if (entry.locator?.startsWith('web:block:')) {
              const ids = locators();
              root = candidates.find(b => ids.get(b) === entry.locator);
            }
            else if (/^web:\d+$/.test(entry.locator || '')) root = candidates[Number(entry.locator.slice(4))];
            if (root && entry.context && root.textContent !== entry.context) root = null;
            if (!root && entry.context) {
              const matches = candidates.filter(b => b.textContent === entry.context && isTranslation(b) === (entry.side === 'translation'));
              if (matches.length === 1) root = matches[0];
            }
            if (!root) return null;
            const source = root.textContent || '';
            let start = entry.rangeLocation;
            if (source.slice(start, start + entry.rangeLength) !== entry.quote) {
              start = source.indexOf(entry.quote);
              if (start < 0 || source.indexOf(entry.quote, start + 1) >= 0) return null;
            }
            return textRange(root, start, entry.quote.length);
          }
          function snapshot() {
            const candidates = blocks();
            const index = candidates.findIndex(b => b.getBoundingClientRect().bottom > 0);
            const block = candidates[index];
            return { x: window.scrollX, y: window.scrollY, blockIndex: index,
                     blockText: block?.textContent || null, offset: block?.getBoundingClientRect().top || 0 };
          }
          function restore(position) {
            if (!position) return;
            const candidates = blocks();
            let block = candidates[position.blockIndex];
            if (!block || block.textContent !== position.blockText) {
              const matches = candidates.filter(b => b.textContent === position.blockText);
              block = matches.length === 1 ? matches[0] : null;
            }
            const y = block ? window.scrollY + block.getBoundingClientRect().top - (position.offset || 0) : position.y;
            window.scrollTo(position.x || 0, y || 0);
          }
          window.paperBridge = {
            locator, snapshot, restore,
            setDefaultSide(side) { defaultSide = side; },
            applyAnnotations(entries) {
              if (!window.CSS?.highlights || typeof Highlight === 'undefined') return;
              const buckets = { amber: [], teal: [], coral: [], note: [] };
              Object.keys(buckets).forEach(name => CSS.highlights.delete(`paperbridge-${name}`));
              entries.forEach(entry => {
                const range = resolve(entry);
                if (!range) return;
                if (buckets[entry.highlight]) buckets[entry.highlight].push(range);
                if (entry.hasNote) buckets.note.push(range);
              });
              Object.entries(buckets).forEach(([name, ranges]) => {
                if (ranges.length) CSS.highlights.set(`paperbridge-${name}`, new Highlight(...ranges));
              });
            },
            navigate(entry) {
              const range = resolve(entry);
              if (!range) return false;
              const rect = range.getBoundingClientRect();
              window.scrollTo(window.scrollX, window.scrollY + rect.top - window.innerHeight * 0.25);
              const selection = window.getSelection();
              selection.removeAllRanges(); selection.addRange(range);
              return true;
            }
          };
          let scrollTimer;
          window.addEventListener('scroll', () => {
            clearTimeout(scrollTimer);
            scrollTimer = setTimeout(() => {
              window.webkit?.messageHandlers?.paperBridgeSelection?.postMessage({ position: snapshot() });
            }, 180);
          }, { passive: true });
        })();
        """#

        var lastFingerprint: String?
        var allowedRoot: URL?
        var selectionScope: TextSelectionScope?
        var defaultSelectionSide: ReaderTextSide = .original
        var onSelection: ((ReaderTextSelection) -> Void)?
        var annotations: [PaperAnnotation] = []
        var annotationSignature: String?
        var navigationRequest: AnnotationNavigationRequest?
        var lastNavigationID: UUID?
        var savedPosition: ReadingPosition?
        var onPositionChange: ((ReadingPosition) -> Void)?
        var onNavigationFailure: (() -> Void)?
        var isLoading = false

        static func decodePosition(_ value: Any?) -> ReadingPosition? {
            guard let object = value as? [String: Any], JSONSerialization.isValidJSONObject(object),
                  let data = try? JSONSerialization.data(withJSONObject: object) else { return nil }
            return try? JSONDecoder().decode(ReadingPosition.self, from: data)
        }

        func userContentController(
            _ userContentController: WKUserContentController,
            didReceive message: WKScriptMessage
        ) {
            if let body = message.body as? [String: Any],
               let position = Self.decodePosition(body["position"]), !isLoading {
                savedPosition = position
                onPositionChange?(position)
                return
            }
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
            isLoading = false
            applyAnnotations(in: webView)
            let fingerprint = lastFingerprint
            if let position = savedPosition, let data = try? JSONEncoder().encode(position),
               let object = try? JSONSerialization.jsonObject(with: data) {
                webView.callAsyncJavaScript(
                    "await window.MathJax?.startup?.promise; window.paperBridge?.restore(position);",
                    arguments: ["position": object], in: nil, in: .page
                ) { [weak self, weak webView] _ in
                    guard let self, let webView, self.lastFingerprint == fingerprint else { return }
                    self.navigateIfNeeded(in: webView)
                }
            } else {
                navigateIfNeeded(in: webView)
            }
        }

        func navigateIfNeeded(in webView: WKWebView) {
            guard !isLoading, let request = navigationRequest, request.id != lastNavigationID,
                  request.annotation.resolvedScope == selectionScope,
                  request.annotation.locator?.hasPrefix("web:") == true else { return }
            lastNavigationID = request.id
            let object = annotationObject(request.annotation)
            webView.callAsyncJavaScript(
                "await window.MathJax?.startup?.promise; return window.paperBridge?.navigate(entry) ?? false;",
                arguments: ["entry": object], in: nil, in: .page
            ) { [weak self] result in
                guard let self, self.lastNavigationID == request.id else { return }
                if case .success(let value) = result, value as? Bool == true { return }
                self.onNavigationFailure?()
            }
        }

        private func annotationObject(_ annotation: PaperAnnotation) -> [String: Any] {
            ["quote": annotation.quote, "context": annotation.context as Any? ?? NSNull(),
             "locator": annotation.locator as Any? ?? NSNull(), "side": annotation.side.rawValue,
             "rangeLocation": annotation.rangeLocation, "rangeLength": annotation.rangeLength,
             "highlight": annotation.highlightColor?.rawValue as Any? ?? NSNull(), "hasNote": !annotation.note.isEmpty]
        }

        func applyAnnotations(in webView: WKWebView) {
            let visibleAnnotations = annotations.filter {
                $0.highlightColor != nil ||
                    !$0.note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            }
            webView.callAsyncJavaScript(
                "await window.MathJax?.startup?.promise; window.paperBridge?.applyAnnotations(entries);",
                arguments: ["entries": visibleAnnotations.map(annotationObject)], in: nil, in: .page
            ) { _ in }
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
