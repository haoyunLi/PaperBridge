import PDFKit
import SwiftUI

struct PDFDocumentView: NSViewRepresentable {
    let pdfURL: URL
    var annotations: [PaperAnnotation] = []
    var navigationRequest: AnnotationNavigationRequest?
    var readingPosition: ReadingPosition?
    var onPositionChange: ((ReadingPosition) -> Void)?
    var onNavigationFailure: (() -> Void)?
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
            if let index = readingPosition?.pageIndex, let page = pdfView.document?.page(at: index) {
                pdfView.go(to: page)
            }
        }

        var hasher = Hasher()
        hasher.combine(annotations)
        let signature = hasher.finalize()
        if context.coordinator.annotationSignature != signature {
            context.coordinator.annotationSignature = signature
            context.coordinator.applyAnnotations(to: pdfView)
        }
        context.coordinator.navigateIfNeeded(in: pdfView)
    }

    static func dismantleNSView(_ pdfView: PDFView, coordinator: Coordinator) {
        coordinator.detach()
    }

    static func anchors(for selection: PDFSelection, in document: PDFDocument) -> [PDFTextAnchor] {
        selection.pages.flatMap { page in
            (0..<selection.numberOfTextRanges(on: page)).compactMap { index in
                let range = selection.range(at: index, on: page)
                guard let text = page.string as NSString?, range.location != NSNotFound,
                      range.location <= text.length, range.length > 0,
                      range.length <= text.length - range.location else { return nil }
                return PDFTextAnchor(pageIndex: document.index(for: page), location: range.location,
                                     length: range.length, quote: text.substring(with: range))
            }
        }
    }

    static func selection(for annotation: PaperAnnotation, in document: PDFDocument) -> PDFSelection? {
        if let anchors = annotation.pdfAnchors, !anchors.isEmpty {
            let result = PDFSelection(document: document)
            for anchor in anchors {
                guard let page = document.page(at: anchor.pageIndex), let text = page.string as NSString?,
                      anchor.location >= 0, anchor.length > 0, anchor.location <= text.length,
                      anchor.length <= text.length - anchor.location,
                      text.substring(with: NSRange(location: anchor.location, length: anchor.length)) == anchor.quote,
                      let part = page.selection(for: NSRange(location: anchor.location, length: anchor.length)) else {
                    return nil
                }
                result.add(part)
            }
            return result
        }
        // Legacy annotations can be recovered only when their text location is unambiguous.
        guard let locator = annotation.locator, locator.hasPrefix("pdf-page-"),
              let index = Int(locator.dropFirst("pdf-page-".count)),
              let page = document.page(at: index), let text = page.string,
              let range = annotation.resolvedRange(in: text) else { return nil }
        return page.selection(for: range)
    }

    final class Coordinator {
        var parent: PDFDocumentView
        var loadedPath: String?
        var annotationSignature: Int?
        private var selectionObserver: NSObjectProtocol?
        private var pageObserver: NSObjectProtocol?
        private var lastNavigationID: UUID?
        private var isNavigating = false
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
            pageObserver = NotificationCenter.default.addObserver(
                forName: Notification.Name.PDFViewPageChanged, object: pdfView, queue: .main
            ) { [weak self, weak pdfView] _ in
                guard let self, let pdfView, let page = pdfView.currentPage,
                      let document = pdfView.document else { return }
                let position = ReadingPosition(pageIndex: document.index(for: page))
                DispatchQueue.main.async { self.parent.onPositionChange?(position) }
            }
        }

        func detach() {
            if let selectionObserver {
                NotificationCenter.default.removeObserver(selectionObserver)
            }
            selectionObserver = nil
            if let pageObserver { NotificationCenter.default.removeObserver(pageObserver) }
            pageObserver = nil
            removeRenderedAnnotations()
        }

        private func captureSelection(from pdfView: PDFView) {
            guard !isNavigating, let selection = pdfView.currentSelection,
                  let selectedText = selection.string,
                  !selectedText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  let document = pdfView.document,
                  let page = selection.pages.first else {
                return
            }

            let pageIndex = document.index(for: page)
            let pageText = page.string ?? selectedText
            let anchors = PDFDocumentView.anchors(for: selection, in: document)
            guard let first = anchors.first else { return }

            parent.onSelection?(
                ReaderTextSelection(
                    scope: .paper,
                    paragraphID: 0,
                    side: .original,
                    text: selectedText,
                    context: anchors.count == 1 ? pageText : selectedText,
                    rangeLocation: first.location,
                    rangeLength: first.length,
                    locator: "pdf-page-\(pageIndex)",
                    pdfAnchors: anchors
                )
            )
        }

        func navigateIfNeeded(in pdfView: PDFView) {
            guard let request = parent.navigationRequest,
                  request.annotation.locator?.hasPrefix("pdf-page-") == true,
                  request.id != lastNavigationID else { return }
            lastNavigationID = request.id
            DispatchQueue.main.async { [weak self, weak pdfView] in
                guard let self, let pdfView, self.lastNavigationID == request.id,
                      let document = pdfView.document else { return }
                guard let selection = PDFDocumentView.selection(for: request.annotation, in: document) else {
                    self.parent.onNavigationFailure?()
                    return
                }
                self.isNavigating = true
                pdfView.go(to: selection)
                pdfView.setCurrentSelection(selection, animate: false)
                self.isNavigating = false
            }
        }

        func applyAnnotations(to pdfView: PDFView) {
            removeRenderedAnnotations()
            guard let document = pdfView.document else { return }

            for annotation in parent.annotations where
                annotation.resolvedScope == .paper && annotation.side == .original {
                guard let selection = PDFDocumentView.selection(for: annotation, in: document) else { continue }

                for line in selection.selectionsByLine() {
                    guard let page = line.pages.first else { continue }
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
