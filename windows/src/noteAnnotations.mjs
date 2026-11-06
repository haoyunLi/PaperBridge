import { anchorText } from './academicMarkdown.mjs';
import { isPdfScope, pdfAnchorKey, samePdfSelection, storedPdfAnchors, validPdfSelection } from './pdfAnchors.mjs';
import { blockMarkdown, sameTextAnchor, validTextSelection } from './markdownAnchors.mjs';

const viewScopes = new Set(['summarySource', 'summaryTarget', 'fullTranslation']);

export function noteSelectionIdentity(paperId, selection) {
  if (!paperId || !selection) return '';
  return JSON.stringify([paperId, selection.scope, selection.id ?? null, selection.page ?? null, selection.kind || 'source', selection.offset, selection.text, selection.anchors && pdfAnchorKey(selection), selection.renderedAnchor]);
}

export function sameNoteSelection(paperId, selection, identity) {
  return Boolean(identity) && noteSelectionIdentity(paperId, selection) === identity;
}

export function viewText(paper, scope) {
  return scope === 'summarySource' ? paper?.summary?.source || ''
    : scope === 'summaryTarget' ? paper?.summary?.target || ''
      : scope === 'fullTranslation' ? paper?.connectedTranslation || '' : '';
}

export function validNoteSelection(paper, selection) {
  if (!paper || !selection?.text) return false;
  if (isPdfScope(selection.scope)) return validPdfSelection(selection);
  if (viewScopes.has(selection.scope)) {
    const source = viewText(paper, selection.scope);
    return validTextSelection(selection, source, source);
  }
  if (!['reader', 'paper'].includes(selection.scope)) return false;
  const block = paper.blocks?.find(item => item.id === selection.id);
  return Boolean(block) && validTextSelection(selection, anchorText(block, selection.kind), blockMarkdown(block, selection.kind));
}

function matches(selection, item) {
  if (!item || item.needsReview) return false;
  if (isPdfScope(selection.scope)) return samePdfSelection(item, selection);
  if (viewScopes.has(selection.scope)) return item.scope === selection.scope && sameTextAnchor(item, selection);
  return (item.scope || 'reader') === selection.scope && sameTextAnchor(item, selection) && (item.kind || 'source') === (selection.kind || 'source');
}

export function findSelectionNote(paper, selection) {
  if (!paper || !selection) return null;
  if (isPdfScope(selection.scope)) return (paper.pdfNotes || []).find(item => matches(selection, item)) || null;
  if (viewScopes.has(selection.scope)) return (paper.viewNotes || []).find(item => matches(selection, item)) || null;
  const block = paper.blocks?.find(item => item.id === selection.id);
  return block?.notes?.find(item => matches(selection, item)) || null;
}

function updateNotes(notes, selection, body, makeId, extra = {}) {
  const current = notes || [];
  const existing = current.find(item => matches(selection, item));
  if (body === '') return existing ? current.filter(item => item !== existing) : current;
  const display = {
    ...(selection.displayOffset == null ? {} : { displayOffset: selection.displayOffset }),
    ...(selection.renderedAnchor && { renderedAnchor: selection.renderedAnchor }),
    ...(isPdfScope(selection.scope) && selection.quote != null ? { quote: selection.quote } : {})
  };
  if (existing) {
    if (existing.body === body && Object.entries(display).every(([key, value]) => key === 'renderedAnchor' || existing[key] === value)) return current;
    return current.map(item => item === existing ? { ...item, body, ...display } : item);
  }
  return [...current, {
    id: makeId(), text: selection.text, offset: selection.offset, body,
    ...display,
    ...extra
  }];
}

export function applySelectionNote(paper, selection, body, makeId = () => crypto.randomUUID()) {
  if (!validNoteSelection(paper, selection) || typeof body !== 'string') return paper;
  if (isPdfScope(selection.scope)) {
    const pdfNotes = updateNotes(paper.pdfNotes, selection, body, makeId, {
      page: selection.page, scope: selection.scope, ...(selection.anchors && { anchors: storedPdfAnchors(selection) })
    });
    return pdfNotes === (paper.pdfNotes || []) ? paper : { ...paper, pdfNotes };
  }
  if (viewScopes.has(selection.scope)) {
    const viewNotes = updateNotes(paper.viewNotes, selection, body, makeId, { scope: selection.scope });
    return viewNotes === (paper.viewNotes || []) ? paper : { ...paper, viewNotes };
  }
  const index = paper.blocks.findIndex(item => item.id === selection.id);
  const block = paper.blocks[index];
  const notes = updateNotes(block.notes, selection, body, makeId, { kind: selection.kind || 'source', scope: selection.scope });
  if (notes === (block.notes || [])) return paper;
  const blocks = [...paper.blocks];
  blocks[index] = { ...block, notes };
  return { ...paper, blocks };
}
