import { isMarkdownView, sameTextAnchor, sameViewAnchor } from './markdownAnchors.mjs';
import { isPdfScope, samePdfSelection } from './pdfAnchors.mjs';

const sideOf = item => item?.kind || (['summaryTarget', 'fullTranslation'].includes(item?.scope) ? 'translation' : 'source');

// A note and its highlight are two stored records for one annotation. Preserve
// that annotation's age when creating the other part, without inventing dates
// for undated legacy records or modifying any existing record.
export function annotationCreationTime(paper, selection) {
  const matches = [];
  const append = (items, predicate) => {
    for (const item of items || []) if (item && !item.needsReview && predicate(item)) matches.push(item);
  };
  if (paper && selection) {
    const kind = sideOf(selection);
    if (isPdfScope(selection.scope)) {
      const exact = item => sideOf(item) === kind && samePdfSelection(item, selection);
      append(paper.pdfNotes, exact);
      append(paper.pdfHighlights, exact);
    } else if (isMarkdownView(selection.scope)) {
      const exact = item => sideOf(item) === kind && sameViewAnchor(item, selection);
      append(paper.viewNotes, exact);
      append(paper.viewHighlights, exact);
    } else if (['reader', 'paper'].includes(selection.scope)) {
      const block = paper.blocks?.find(item => item.id === selection.id);
      const exact = item => (item.scope || 'reader') === selection.scope && sameTextAnchor(item, selection);
      append(block?.notes, item => sideOf(item) === kind && exact(item));
      // Block highlights obtain their language side from their container.
      if (kind === 'source') append(block?.highlights, exact);
      else if (kind === 'translation') append(block?.translationHighlights, exact);
    }
  }
  if (!matches.length) return new Date().toISOString();
  let earliest;
  let earliestTime = Infinity;
  for (const item of matches) {
    const time = typeof item.createdAt === 'string' && item.createdAt.trim() ? Date.parse(item.createdAt) : NaN;
    if (!Number.isFinite(time)) return null;
    if (time < earliestTime) { earliestTime = time; earliest = item.createdAt; }
  }
  return earliest;
}
