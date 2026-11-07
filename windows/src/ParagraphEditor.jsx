import React, { useEffect, useId, useMemo, useRef } from 'react';
import { ListChecks } from 'lucide-react';
import './paragraph-editor.css';

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

export default function ParagraphEditor({ edit, onChange, onCancel, onSave, busy = false }) {
  const dialog = useRef(null);
  const textarea = useRef(null);
  const cancelling = useRef(false);
  const composing = useRef(false);
  const ignoreCompositionCancel = useRef(false);
  const titleId = useId();
  const instructionsId = `${titleId}-instructions`;
  const text = edit.text;
  const canSave = !busy && Boolean(text.trim());
  const characterCount = useMemo(() => {
    let count = 0;
    for (const segment of graphemes.segment(text)) count++;
    return count;
  }, [text]);

  useEffect(() => {
    const popup = dialog.current;
    const previousFocus = document.activeElement;
    cancelling.current = false;
    if (!popup.open) popup.showModal();
    textarea.current?.focus({ preventScroll: true });
    return () => {
      if (popup.open) popup.close();
      if (previousFocus?.isConnected && !previousFocus.closest('[inert]') && !previousFocus.matches(':disabled')) {
        previousFocus.focus({ preventScroll: true });
      }
    };
  }, [edit.id]);

  function cancel() {
    if (cancelling.current) return;
    cancelling.current = true;
    onCancel();
  }

  function handleKey(event) {
    if (composing.current || event.isComposing || event.nativeEvent?.isComposing) {
      event.stopPropagation();
      if (event.key === 'Escape') {
        // Let the IME handle Escape, but suppress any dialog cancel emitted by
        // that same keystroke after the composition-end event.
        ignoreCompositionCancel.current = true;
        setTimeout(() => { ignoreCompositionCancel.current = false; }, 0);
      }
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation(); cancel(); return;
    }
    if (event.key === 'Enter' && event.ctrlKey && !event.altKey && !event.shiftKey) {
      event.preventDefault(); event.stopPropagation();
      if (canSave) onSave();
      return;
    }
    if (event.key !== 'Tab') return;
    event.stopPropagation();
    const items = [...dialog.current.querySelectorAll('textarea, button, [tabindex]')]
      .filter(element => !element.disabled && element.tabIndex >= 0 && element.getClientRects().length);
    const first = items[0], last = items.at(-1), active = document.activeElement;
    if (event.shiftKey && (active === first || !items.includes(active))) {
      event.preventDefault(); last?.focus();
    } else if (!event.shiftKey && (active === last || !items.includes(active))) {
      event.preventDefault(); first?.focus();
    }
  }

  return <dialog ref={dialog} className="paragraph-editor" aria-labelledby={titleId} aria-describedby={instructionsId}
    onKeyDown={handleKey} onCancel={event => {
      event.preventDefault(); event.stopPropagation();
      if (!composing.current && !ignoreCompositionCancel.current) cancel();
    }}>
    <form className="paragraph-editor-body" aria-busy={Boolean(busy)} onSubmit={event => {
      event.preventDefault(); event.stopPropagation();
      if (canSave) onSave();
    }}>
      <header className="paragraph-editor-header">
        <span className="paragraph-editor-icon" aria-hidden="true"><ListChecks size={28} /></span>
        <div>
          <h2 id={titleId}>Repair Paragraph {edit.id}</h2>
          <p id={instructionsId}>Fix extraction errors directly. Insert a blank line wherever this text should become a new paragraph.</p>
        </div>
      </header>
      <textarea ref={textarea} aria-label="Paragraph source" aria-describedby={instructionsId} value={text}
        spellCheck={false} onChange={event => onChange(event.target.value)}
        onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} />
      <footer className="paragraph-editor-footer">
        <div className="paragraph-editor-details">
          <p><span className="paragraph-editor-count" aria-live="polite">{characterCount} characters.</span> Changes invalidate only affected translation output.</p>
          <span className="paragraph-editor-shortcut">Ctrl+Enter to save</span>
        </div>
        <div className="paragraph-editor-buttons">
          <button type="button" className="button outline" onClick={cancel}>Cancel</button>
          <button type="submit" className="button blue" disabled={!canSave} aria-keyshortcuts="Control+Enter">Save</button>
        </div>
      </footer>
    </form>
  </dialog>;
}
