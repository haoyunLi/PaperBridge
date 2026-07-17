import AppKit
import SwiftUI

struct SelectableAcademicText: NSViewRepresentable {
    let text: String
    let paragraphID: Int
    let side: ReaderTextSide
    let annotations: [PaperAnnotation]
    var font = NSFont(name: "NewYork-Regular", size: 16) ?? NSFont.systemFont(ofSize: 16)
    var textColor = NSColor.labelColor
    var lineSpacing: CGFloat = 5
    var scope: TextSelectionScope = .reader
    var locator: String?
    let onSelection: (ReaderTextSelection) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(parent: self)
    }

    func makeNSView(context: Context) -> IntrinsicTextView {
        let textStorage = NSTextStorage()
        let layoutManager = NSLayoutManager()
        let textContainer = NSTextContainer(
            containerSize: NSSize(width: 0, height: CGFloat.greatestFiniteMagnitude)
        )
        textContainer.widthTracksTextView = true
        textContainer.lineFragmentPadding = 0
        layoutManager.addTextContainer(textContainer)
        textStorage.addLayoutManager(layoutManager)

        let textView = IntrinsicTextView(frame: .zero, textContainer: textContainer)
        textView.delegate = context.coordinator
        textView.drawsBackground = false
        textView.isEditable = false
        textView.isSelectable = true
        textView.isRichText = true
        textView.allowsUndo = false
        textView.isHorizontallyResizable = false
        textView.isVerticallyResizable = true
        textView.autoresizingMask = [NSView.AutoresizingMask.width]
        textView.textContainerInset = NSSize.zero
        textView.setContentCompressionResistancePriority(
            NSLayoutConstraint.Priority.required,
            for: NSLayoutConstraint.Orientation.vertical
        )
        textView.setContentHuggingPriority(
            NSLayoutConstraint.Priority.required,
            for: NSLayoutConstraint.Orientation.vertical
        )
        textView.setAccessibilityLabel(
            side == .original ? "Original paragraph" : "Translated paragraph"
        )
        return textView
    }

    func updateNSView(_ textView: IntrinsicTextView, context: Context) {
        context.coordinator.parent = self

        var hasher = Hasher()
        hasher.combine(text)
        hasher.combine(annotations)
        hasher.combine(font.fontName)
        hasher.combine(font.pointSize)
        hasher.combine(lineSpacing)
        let contentSignature = hasher.finalize()

        guard textView.contentSignature != contentSignature else {
            textView.invalidateIntrinsicContentSize()
            return
        }

        let paragraphStyle = NSMutableParagraphStyle()
        paragraphStyle.lineSpacing = lineSpacing
        paragraphStyle.paragraphSpacing = 0

        let attributedText = NSMutableAttributedString(
            string: text,
            attributes: [
                .font: font,
                .foregroundColor: textColor,
                .paragraphStyle: paragraphStyle
            ]
        )

        for annotation in annotations {
            guard let range = annotation.resolvedRange(in: text),
                  NSMaxRange(range) <= attributedText.length else {
                continue
            }

            if let highlightColor = annotation.highlightColor {
                attributedText.addAttribute(
                    .backgroundColor,
                    value: highlightColor.nsColor,
                    range: range
                )
            }

            if !annotation.note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                attributedText.addAttributes(
                    [
                        .underlineStyle: NSUnderlineStyle.single.rawValue,
                        .underlineColor: PaperBridgeTheme.accentNSColor
                    ],
                    range: range
                )
            }
        }

        let previousSelection = textView.selectedRange()
        context.coordinator.isApplyingContent = true
        textView.textStorage?.setAttributedString(attributedText)
        if NSMaxRange(previousSelection) <= attributedText.length {
            textView.setSelectedRange(previousSelection)
        }
        textView.contentSignature = contentSignature
        context.coordinator.isApplyingContent = false
        textView.invalidateIntrinsicContentSize()
    }

    final class Coordinator: NSObject, NSTextViewDelegate {
        var parent: SelectableAcademicText
        var isApplyingContent = false

        init(parent: SelectableAcademicText) {
            self.parent = parent
        }

        func textViewDidChangeSelection(_ notification: Notification) {
            guard !isApplyingContent,
                  let textView = notification.object as? NSTextView else {
                return
            }

            let range = textView.selectedRange()
            let nsText = parent.text as NSString
            guard range.location != NSNotFound,
                  range.length > 0,
                  NSMaxRange(range) <= nsText.length else {
                return
            }

            let selectedText = nsText.substring(with: range)
            guard !selectedText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                return
            }

            parent.onSelection(
                ReaderTextSelection(
                    scope: parent.scope,
                    paragraphID: parent.paragraphID,
                    side: parent.side,
                    text: selectedText,
                    context: parent.text,
                    rangeLocation: range.location,
                    rangeLength: range.length,
                    locator: parent.locator
                )
            )
        }
    }
}

final class IntrinsicTextView: NSTextView {
    var contentSignature = 0
    private var measuredWidth: CGFloat = 0

    override var intrinsicContentSize: NSSize {
        guard let layoutManager, let textContainer else {
            return NSSize(width: NSView.noIntrinsicMetric, height: 1)
        }

        layoutManager.ensureLayout(for: textContainer)
        let usedRect = layoutManager.usedRect(for: textContainer)
        return NSSize(
            width: NSView.noIntrinsicMetric,
            height: max(1, ceil(usedRect.height + textContainerInset.height * 2))
        )
    }

    override func setFrameSize(_ newSize: NSSize) {
        super.setFrameSize(newSize)
        if abs(newSize.width - measuredWidth) > 0.5 {
            measuredWidth = newSize.width
            invalidateIntrinsicContentSize()
        }
    }
}

extension PaperHighlightColor {
    var nsColor: NSColor {
        switch self {
        case .amber:
            return NSColor.systemYellow.withAlphaComponent(0.30)
        case .teal:
            return NSColor(
                srgbRed: 0.22,
                green: 0.66,
                blue: 0.57,
                alpha: 0.26
            )
        case .coral:
            return NSColor.systemOrange.withAlphaComponent(0.24)
        }
    }

    var color: Color {
        Color(nsColor: nsColor.withAlphaComponent(1))
    }
}
