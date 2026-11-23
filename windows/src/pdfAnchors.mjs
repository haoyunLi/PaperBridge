export const isPdfScope = scope => scope === 'pdf' || scope === 'paperPdf';
export const pdfAnnotationScope = item => item?.scope === 'paperPdf' ? 'paperPdf' : 'pdf';

export function pdfAnchors(item) {
  if (item?.anchors != null) return Array.isArray(item.anchors) && item.anchors.every(anchor => anchor && typeof anchor === 'object') ? item.anchors : [];
  return item ? [{ page: item.page, offset: item.offset, text: item.text, pageText: item.pageText }] : [];
}

export function resolvedPdfOffset(item, anchor, pageText) {
  if (item.needsReview || typeof anchor.text !== 'string' || !anchor.text) return null;
  const { offset, text } = anchor;
  if (Number.isSafeInteger(offset) && offset >= 0 && pageText.startsWith(text, offset)) return offset;
  if (item.anchors != null) return null;
  // Older notes stored a single page and quote. Only that same page can recover a unique match.
  const first = pageText.indexOf(text);
  return first >= 0 && first === pageText.lastIndexOf(text) ? first : null;
}

export function pdfAnchorKey(item) {
  return pdfAnchors(item).map(({ page, offset, text }) => [page, offset, text]);
}

export function samePdfSelection(item, selection) {
  if (pdfAnnotationScope(item) !== pdfAnnotationScope(selection)) return false;
  const left = pdfAnchors(item);
  const right = pdfAnchors(selection);
  return left.length > 0 && left.length === right.length && left.every(({ page, offset, text }, index) =>
    page === right[index].page && offset === right[index].offset && text === right[index].text
  );
}

export function storedPdfAnchors(selection) {
  return selection.anchors?.map(({ page, offset, text }) => ({ page, offset, text }));
}

export function validPdfSelection(selection) {
  if (!isPdfScope(selection?.scope)) return false;
  const anchors = pdfAnchors(selection);
  return anchors.length > 0 && anchors[0].page === selection.page && anchors.every(({ page, offset, text, pageText }, index) =>
    Number.isInteger(page) && page > (anchors[index - 1]?.page ?? 0) &&
    Number.isInteger(offset) && offset >= 0 && typeof text === 'string' && Boolean(text) &&
    typeof pageText === 'string' && pageText.slice(offset, offset + text.length) === text
  );
}

export function pdfPageLabel(item) {
  const end = pdfAnchors(item).at(-1)?.page;
  return end > item.page ? `pages ${item.page}–${end}` : `page ${item.page}`;
}
