import { anchorText } from './academicMarkdown.mjs';
import { blockMarkdown, paperArticleAnchorAvailable, textAnchorAvailable } from './markdownAnchors.mjs';
import { isPdfScope, pdfAnchorKey, pdfAnnotationScope, pdfPageLabel } from './pdfAnchors.mjs';

const sideOf = (item, kind) => ['source', 'translation'].includes(kind) ? kind
  : ['source', 'translation'].includes(item?.kind) ? item.kind
    : ['summaryTarget', 'fullTranslation'].includes(item?.scope) ? 'translation' : 'source';
const sideLabel = kind => kind === 'translation' ? 'Translation' : 'Original';

export function annotationLabel(item, { blockId, location, kind } = {}) {
  const scope = item?.scope;
  if (location === 'pdf' || isPdfScope(scope)) {
    return `${pdfAnnotationScope(item) === 'paperPdf' ? 'Paper · exact PDF' : 'Original PDF'} · ${pdfPageLabel(item)}`;
  }
  const side = sideLabel(sideOf(item, kind));
  const paragraph = blockId ?? (Number.isSafeInteger(item?.id) ? item.id : undefined);
  if (location === 'block' || paragraph !== undefined && (!scope || ['reader', 'paper'].includes(scope))) {
    return `${scope === 'paper' ? 'Paper' : 'Reader'} · Block ${paragraph} · ${side}`;
  }
  const label = { summarySource: 'Source Summary', summaryTarget: 'Target Summary',
    fullTranslation: 'Full Translation', paperArticle: 'Paper · document preview' }[scope] || 'Saved passage';
  return `${label} · ${side}`;
}

function textIdentity(item) {
  if (typeof item.text !== 'string' || !item.text) return null;
  const anchor = item.renderedAnchor;
  if (anchor) return Number.isSafeInteger(anchor.offset) && anchor.offset >= 0 &&
    typeof anchor.before === 'string' && typeof anchor.after === 'string'
    ? ['rendered', item.text, anchor.offset, anchor.before, anchor.after] : null;
  return Number.isSafeInteger(item.offset) && item.offset >= 0 ? ['text', item.text, item.offset] : null;
}

function pdfIdentity(item) {
  const anchors = pdfAnchorKey(item);
  return anchors.length && anchors[0][0] === item.page && anchors.every(([page, offset, text], index) =>
    Number.isSafeInteger(page) && page > (anchors[index - 1]?.[0] ?? 0) &&
    Number.isSafeInteger(offset) && offset >= 0 && typeof text === 'string' && text)
    ? anchors : null;
}

const timestamp = value => {
  const time = typeof value === 'string' && value.trim() ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? time : null;
};

// This is an Inspector projection, not a storage migration or export format.
// Keep every original record, including duplicate IDs and historical note bodies.
export function savedAnnotations(paper) {
  if (!paper) return [];
  const entries = new Map();
  let order = 0;
  function append(item, category, location, block, forcedKind) {
    const sequence = order++;
    const kind = sideOf(item, forcedKind);
    const scope = location === 'pdf' ? pdfAnnotationScope(item) : item.scope || (location === 'block' ? 'reader' : '');
    const anchor = location === 'pdf' ? pdfIdentity(item) : textIdentity(item);
    let review = Boolean(item.needsReview);
    if (location === 'block') review ||= !textAnchorAvailable(item, anchorText(block, kind), blockMarkdown(block, kind));
    else if (location === 'view') {
      if (scope === 'paperArticle') review ||= !paperArticleAnchorAvailable(paper, item);
      else {
        const source = { summarySource: paper.summary?.source, summaryTarget: paper.summary?.target,
          fullTranslation: paper.connectedTranslation }[scope] || '';
        review ||= !textAnchorAvailable(item, source, source);
      }
    } else review ||= !anchor;
    const quote = item.quote ?? item.text ?? '';
    // Unresolved ranges never merge, even if old records reuse an ID or quote.
    const key = JSON.stringify([location, block?.id ?? null, scope, kind, item.sourceMode ?? null,
      item.displayMode ?? null, anchor || ['unresolved', sequence], quote, review]);
    const ref = { item, category, location, ...(block && { blockId: block.id }), kind,
      key: JSON.stringify([location, block?.id ?? null, category, kind, item.id ?? null, sequence]) };
    const time = timestamp(item.createdAt);
    let entry = entries.get(key);
    if (!entry) {
      entry = { key, label: annotationLabel(item, { blockId: block?.id, location, kind }), quote,
        notes: [], highlights: [], records: [], review, time, order: sequence };
      entries.set(key, entry);
    } else entry.time = entry.time === null || time === null ? null : Math.min(entry.time, time);
    entry.records.push(ref);
    entry[category === 'note' ? 'notes' : 'highlights'].push(ref);
  }
  // Preserve the previous Inspector's traversal order for undated legacy items.
  for (const block of paper.blocks || []) for (const item of block.notes || []) append(item, 'note', 'block', block);
  for (const block of paper.blocks || []) {
    for (const item of block.highlights || []) append(item, 'highlight', 'block', block, 'source');
    for (const item of block.translationHighlights || []) append(item, 'highlight', 'block', block, 'translation');
  }
  for (const [location, category, field] of [['view', 'note', 'viewNotes'], ['view', 'highlight', 'viewHighlights'],
    ['pdf', 'note', 'pdfNotes'], ['pdf', 'highlight', 'pdfHighlights']]) {
    for (const item of paper[field] || []) append(item, category, location);
  }
  return [...entries.values()].sort((a, b) => a.time === null || b.time === null
    ? a.time === b.time ? a.order - b.order : a.time === null ? 1 : -1
    : b.time - a.time || a.order - b.order);
}

// A stale UI ref cannot delete a replacement record that happens to reuse its ID.
export function removeSavedAnnotationRecords(paper, refs) {
  if (!paper || !refs?.length) return paper;
  const removals = new Map();
  const slot = (location, blockId, field) => JSON.stringify([location, blockId ?? null, field]);
  for (const ref of refs) {
    if (!ref?.item || !['note', 'highlight'].includes(ref.category)) continue;
    let field;
    if (ref.location === 'block') field = ref.category === 'note' ? 'notes'
      : ref.kind === 'translation' ? 'translationHighlights' : 'highlights';
    else if (['view', 'pdf'].includes(ref.location)) field = `${ref.location}${ref.category === 'note' ? 'Notes' : 'Highlights'}`;
    else continue;
    const key = slot(ref.location, ref.blockId, field);
    if (!removals.has(key)) removals.set(key, new Set());
    removals.get(key).add(ref.item);
  }
  let result = paper;
  function filtered(items, location, blockId, field) {
    const remove = removals.get(slot(location, blockId, field));
    return remove && items?.some(item => remove.has(item)) ? items.filter(item => !remove.has(item)) : items;
  }
  const blocks = (paper.blocks || []).map(block => {
    let next = block;
    for (const field of ['notes', 'highlights', 'translationHighlights']) {
      const items = filtered(block[field], 'block', block.id, field);
      if (items !== block[field]) next = { ...next, [field]: items };
    }
    return next;
  });
  if (blocks.some((block, index) => block !== paper.blocks[index])) result = { ...result, blocks };
  for (const location of ['view', 'pdf']) for (const category of ['Notes', 'Highlights']) {
    const field = `${location}${category}`;
    const items = filtered(paper[field], location, undefined, field);
    if (items !== paper[field]) result = { ...result, [field]: items };
  }
  return result;
}
