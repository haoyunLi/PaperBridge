import { useEffect, useRef, useState } from 'react';

export function useWholePdfSelection({ pdf, scroller, statuses, layerFor, capture, onSelect, onError }) {
  const [request, setRequest] = useState(null);
  const activeRequest = useRef(null);
  const selectThrough = request && request.pdf === pdf ? request.through : 0;

  function setPageLimit(through) {
    activeRequest.current = through ? { pdf, through } : null;
    setRequest(activeRequest.current);
  }
  function isPending() {
    return Boolean(activeRequest.current && activeRequest.current.pdf === pdf);
  }
  const copied = useRef(null);
  const deferred = useRef(null);

  function cancelCopy() {
    const request = deferred.current;
    if (request) {
      request.cancelled = true;
      request.reject(new DOMException('PDF selection cancelled', 'AbortError'));
      deferred.current = null;
    }
  }
  useEffect(() => () => {
    if (activeRequest.current?.pdf === pdf) activeRequest.current = null;
    cancelCopy();
    copied.current = null;
  }, [pdf]);

  function cancel() {
    setPageLimit(0);
    cancelCopy();
    copied.current = null;
  }

  function start() {
    if (!pdf || isPending()) return;
    onError('');
    setPageLimit(Math.min(8, pdf.numPages));
  }

  // Remember the printed reading order separately from the original DOM offsets used by saved notes.
  function remember(range, captured) {
    const parts = captured.anchors || [captured];
    if (!parts.every(part => part.pageText?.trim() === part.text && statuses[part.page]?.copyText)) return captured;
    const text = parts.map(part => statuses[part.page].copyText).join('\n');
    copied.current = { range: range.cloneRange(), text };
    return { ...captured, quote: text, context: text };
  }

  useEffect(() => {
    if (!pdf || !selectThrough || activeRequest.current !== request) return;
    const host = scroller.current;
    for (let page = 1; page <= selectThrough; page++) {
      if (typeof statuses[page] === 'string') {
        cancel();
        onError('Could not select all PDF text. Page ' + page + ' could not be read.');
        return;
      }
      if (!statuses[page] || !layerFor(host, page)) return;
    }
    if (selectThrough < pdf.numPages) {
      setPageLimit(Math.min(pdf.numPages, selectThrough + 8));
      return;
    }
    setPageLimit(0);
    const layers = [...host.querySelectorAll('.textLayer[data-page]')].filter(layer => statuses[Number(layer.dataset.page)]?.selectable);
    if (!layers.length) { cancelCopy(); return; }
    const first = layers[0], last = layers.at(-1), range = document.createRange();
    range.setStart(first, 0); range.setEnd(last, last.childNodes.length);
    const captured = capture(host, range);
    if (!captured) { cancelCopy(); return; }
    const selection = window.getSelection();
    selection.removeAllRanges(); selection.addRange(range);
    const complete = remember(range, captured);
    if (deferred.current) {
      deferred.current.resolve(new Blob([complete.quote ?? complete.text], { type: 'text/plain' }));
      deferred.current = null;
    }
    onSelect(complete);
  }, [pdf, scroller, request, selectThrough, statuses, layerFor, capture, onSelect, onError]);

  function queueCopy() {
    if (deferred.current) return;
    if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
      onError('Press Ctrl+C again when the PDF text is selected.');
      return;
    }
    const request = Promise.withResolvers();
    deferred.current = request;
    navigator.clipboard.write([new ClipboardItem({ 'text/plain': request.promise })]).catch(() => {
      if (!request.cancelled && scroller.current) onError('Press Ctrl+C again when the PDF text is selected.');
    });
  }

  function copy(event) {
    if (isPending()) { event.preventDefault(); queueCopy(); return; }
    const recorded = copied.current, selection = window.getSelection();
    if (!recorded || !event.clipboardData || !selection.rangeCount) return;
    const current = selection.getRangeAt(0);
    if (current.collapsed || current.compareBoundaryPoints(Range.START_TO_START, recorded.range) ||
        current.compareBoundaryPoints(Range.END_TO_END, recorded.range)) return;
    event.clipboardData.setData('text/plain', recorded.text);
    event.preventDefault();
  }

  return { selectThrough, isPending, start, cancel, queueCopy, remember, copy };
}
