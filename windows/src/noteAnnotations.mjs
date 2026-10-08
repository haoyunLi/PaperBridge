import { anchorText } from './academicMarkdown.mjs';

const viewScopes = new Set(['summarySource', 'summaryTarget', 'fullTranslation']);
const pdfScopes = new Set(['pdf', 'paperPdf']);

export function noteSelectionIdentity(paperId, selection) {
  if (!paperId || !selection) return '';
  return JSON.stringify([paperId, selection.scope, selection.id ?? null, selection.page ?? null, selection.kind || 'source', selection.offset, selection.text]);
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
  if (!paper || !selection || !selection.text || !Number.isInteger(selection.offset) || selection.offset < 0) return false;
  if (pdfScopes.has(selection.scope)) {
    return Number.isInteger(selection.page) && selection.page > 0
      && typeof selection.pageText === 'string'
      && selection.pageText.slice(selection.offset, selection.offset + selection.text.length) === selection.text;
  }
  if (viewScopes.has(selection.scope)) {
    return viewText(paper, selection.scope).slice(selection.offset, selection.offset + selection.text.length) === selection.text;
  }
  if (!['reader', 'paper'].includes(selection.scope)) return false;
  const block = paper.blocks?.find(item => item.id === selection.id);
  return Boolean(block) && anchorText(block, selection.kind || 'source').slice(selection.offset, selection.offset + selection.text.length) === selection.text;
}

function matches(selection, item) {
  if (!item || item.needsReview) return false;
  if (pdfScopes.has(selection.scope)) return (item.scope || 'pdf') === selection.scope && item.page === selection.page && item.offset === selection.offset && item.text === selection.text;
  if (viewScopes.has(selection.scope)) return item.scope === selection.scope && item.offset === selection.offset && item.text === selection.text;
  return (item.scope || 'reader') === selection.scope && item.offset === selection.offset && item.text === selection.text && (item.kind || 'source') === (selection.kind || 'source');
}

export function findSelectionNote(paper, selection) {
  if (!paper || !selection) return null;
  if (pdfScopes.has(selection.scope)) return (paper.pdfNotes || []).find(item => matches(selection, item)) || null;
  if (viewScopes.has(selection.scope)) return (paper.viewNotes || []).find(item => matches(selection, item)) || null;
  const block = paper.blocks?.find(item => item.id === selection.id);
  return block?.notes?.find(item => matches(selection, item)) || null;
}

function updateNotes(notes, selection, body, makeId, extra = {}) {
  const current = notes || [];
  const existing = current.find(item => matches(selection, item));
  if (body === '') return existing ? current.filter(item => item !== existing) : current;
  if (existing) {
    if (existing.body === body && (selection.displayOffset == null || existing.displayOffset === selection.displayOffset)) return current;
    return current.map(item => item === existing ? { ...item, body, ...(selection.displayOffset == null ? {} : { displayOffset: selection.displayOffset }) } : item);
  }
  return [...current, {
    id: makeId(), text: selection.text, offset: selection.offset, body,
    ...(selection.displayOffset == null ? {} : { displayOffset: selection.displayOffset }),
    ...extra
  }];
}

export function applySelectionNote(paper, selection, body, makeId = () => crypto.randomUUID()) {
  if (!validNoteSelection(paper, selection) || typeof body !== 'string') return paper;
  if (pdfScopes.has(selection.scope)) {
    const pdfNotes = updateNotes(paper.pdfNotes, selection, body, makeId, { page: selection.page, scope: selection.scope });
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
