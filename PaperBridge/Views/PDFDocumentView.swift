import PDFKit
import SwiftUI

struct PDFDocumentView: NSViewRepresentable {
    let pdfURL: URL
    var annotations: [PaperAnnotation] = []
    var onSelection: ((ReaderTextSelection) -> Void)?

    func makeCoordinator() -> Coordinator {
        Coordinator(parent: self)
    }

    func makeNSView(context: Context) -> PDFView {
        let pdfView = PDFView()
        pdfView.autoScales = true
        pdfView.displayMode = .singlePageContinuous
        pdfView.displayDirection = .vertical
        pdfView.displaysPageBreaks = true
        pdfView.pageBreakMargins = NSEdgeInsets(top: 14, left: 14, bottom: 14, right: 14)
        pdfView.backgroundColor = .windowBackgroundColor
        context.coordinator.attach(to: pdfView)
        return pdfView
    }

    func updateNSView(_ pdfView: PDFView, context: Context) {
        context.coordinator.parent = self
        let path = pdfURL.standardizedFileURL.path
        if context.coordinator.loadedPath != path {
            context.coordinator.loadedPath = path
            pdfView.document = PDFDocument(url: pdfURL)
            pdfView.autoScales = true
            context.coordinator.annotationSignature = nil
        }

        var hasher = Hasher()
        hasher.combine(annotations)
        let signature = hasher.finalize()
        if context.coordinator.annotationSignature != signature {
            context.coordinator.annotationSignature = signature
            context.coordinator.applyAnnotations(to: pdfView)
        }
    }

    static func dismantleNSView(_ pdfView: PDFView, coordinator: Coordinator) {
        coordinator.detach()
    }

    final class Coordinator {
        var parent: PDFDocumentView
        var loadedPath: String?
        var annotationSignature: Int?
        private var selectionObserver: NSObjectProtocol?
        private var renderedAnnotations: [(page: PDFPage, annotation: PDFAnnotation)] = []

        init(parent: PDFDocumentView) {
            self.parent = parent
        }

        func attach(to pdfView: PDFView) {
            detach()
            selectionObserver = NotificationCenter.default.addObserver(
                forName: Notification.Name.PDFViewSelectionChanged,
                object: pdfView,
                queue: .main
            ) { [weak self, weak pdfView] _ in
                guard let self, let pdfView else { return }
                self.captureSelection(from: pdfView)
            }
        }

        func detach() {
            if let selectionObserver {
                NotificationCenter.default.removeObserver(selectionObserver)
            }
            selectionObserver = nil
            removeRenderedAnnotations()
        }

        private func captureSelection(from pdfView: PDFView) {
            guard let selection = pdfView.currentSelection,
                  let selectedText = selection.string,
                  !selectedText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  let document = pdfView.document,
                  let page = selection.pages.first else {
                return
            }

            let pageIndex = document.index(for: page)
            let pageText = page.string ?? selectedText
            let foundRange = (pageText as NSString).range(of: selectedText)
            let range = foundRange.location == NSNotFound
                ? NSRange(location: 0, length: (selectedText as NSString).length)
                : foundRange
            let context = foundRange.location == NSNotFound ? selectedText : pageText

            parent.onSelection?(
                ReaderTextSelection(
                    scope: .paper,
                    paragraphID: 0,
                    side: .original,
                    text: selectedText,
                    context: context,
                    rangeLocation: range.location,
                    rangeLength: range.length,
                    locator: "pdf-page-\(pageIndex)"
                )
            )
        }

        func applyAnnotations(to pdfView: PDFView) {
            removeRenderedAnnotations()
            guard let document = pdfView.document else { return }

            for annotation in parent.annotations where
                annotation.resolvedScope == .paper && annotation.side == .original {
                guard let locator = annotation.locator,
                      locator.hasPrefix("pdf-page-"),
                      let pageIndex = Int(locator.dropFirst("pdf-page-".count)),
                      let page = document.page(at: pageIndex),
                      let pageText = page.string,
                      let selection = page.selection(for: annotation.resolvedRange(in: pageText) ?? NSRange()) else {
                    continue
                }

                for line in selection.selectionsByLine() {
                    let bounds = line.bounds(for: page)
                    guard !bounds.isEmpty else { continue }

                    if let color = annotation.highlightColor {
                        addAnnotation(
                            PDFAnnotation(bounds: bounds, forType: .highlight, withProperties: nil),
                            color: color.nsColor,
                            to: page
                        )
                    }

                    if !annotation.note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        addAnnotation(
                            PDFAnnotation(bounds: bounds, forType: .underline, withProperties: nil),
                            color: PaperBridgeTheme.accentNSColor,
                            to: page
                        )
                    }
                }
            }
            pdfView.layoutDocumentView()
        }

        private func addAnnotation(
            _ annotation: PDFAnnotation,
            color: NSColor,
            to page: PDFPage
        ) {
            annotation.color = color
            page.addAnnotation(annotation)
            renderedAnnotations.append((page, annotation))
        }

        private func removeRenderedAnnotations() {
            for rendered in renderedAnnotations {
                rendered.page.removeAnnotation(rendered.annotation)
            }
            renderedAnnotations.removeAll()
        }
    }
}
