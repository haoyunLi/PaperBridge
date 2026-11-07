import { anchorText } from './academicMarkdown.mjs';
import { blockMarkdown, paperArticleAnchorAvailable, textAnchorAvailable } from './markdownAnchors.mjs';
import { pdfAnchorKey, pdfPageLabel } from './pdfAnchors.mjs';

function timestamp(value) {
  const parsed = typeof value === 'string' && value.trim() ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function chronological(entries) {
  // Old Windows records have no creation time. Keep their relative order rather
  // than inventing dates; dated records can still be ordered like Mac annotations.
  return [...entries].sort((a, b) => a.time === null || b.time === null
    ? a.time === b.time ? a.order - b.order : a.time === null ? 1 : -1
    : a.time - b.time || a.order - b.order);
}

function textAnchor(item, order) {
  if (item.renderedAnchor && Number.isInteger(item.renderedAnchor.offset) && item.renderedAnchor.offset >= 0 &&
      typeof item.renderedAnchor.before === 'string' && typeof item.renderedAnchor.after === 'string') {
    const { offset, before, after } = item.renderedAnchor;
    return ['rendered', item.text, offset, before, after];
  }
  if (!item.renderedAnchor && typeof item.text === 'string' && item.text && Number.isInteger(item.offset) && item.offset >= 0) return ['text', item.text, item.offset];
  // A quote alone cannot distinguish two occurrences. Only an explicit common
  // record ID can merge records whose saved range is unavailable.
  return ['unresolved', item.id || order];
}

function annotationRecords(paper) {
  const records = new Map();
  let order = 0;
  function append(label, item, category, identity, source, markdown, blockId) {
    const sequence = order++;
    const review = Boolean(item.needsReview || (source !== undefined && !textAnchorAvailable(item, source, markdown)));
    const scope = item.scope || 'reader';
    const key = JSON.stringify([...identity, review]);
    let record = records.get(key);
    const time = timestamp(item.createdAt);
    if (!record) {
      record = { label, scope, blockId, review, quote: item.quote ?? item.text, colors: [], noteColors: [], notes: [],
        hasHighlight: false, hasNote: false, time, order: sequence };
      records.set(key, record);
    } else record.time = record.time === null || time === null ? null : Math.min(record.time, time);
    record.hasHighlight ||= category === 'highlight';
    record.hasNote ||= category === 'note' || Boolean(item.body);
    if (item.color && !record.colors.includes(item.color)) record.colors.push(item.color);
    if (category === 'note' && item.color && !record.noteColors.includes(item.color)) record.noteColors.push(item.color);
    if (typeof item.body === 'string' && item.body && !record.notes.some(note => note.body === item.body)) {
      record.notes.push({ body: item.body, time, order: sequence });
    }
  }
  for (const block of paper.blocks) {
    for (const [items, category, side] of [[block.notes, 'note'], [block.highlights, 'highlight', 'source'], [block.translationHighlights, 'highlight', 'translation']]) {
      for (const item of items || []) {
        const kind = side || item.kind || 'source';
        const scope = item.scope || 'reader';
        const label = `${scope === 'reader' ? 'Reader' : scope === 'paper' ? 'Paper' : scope} · Block ${block.id} · ${kind}`;
        append(label, item, category, ['block', block.id, scope, kind, textAnchor(item, order)], anchorText(block, kind), blockMarkdown(block, kind), block.id);
      }
    }
  }
  for (const [items, category] of [[paper.pdfNotes, 'note'], [paper.pdfHighlights, 'highlight']]) {
    for (const item of items || []) {
      const scope = item.scope === 'paperPdf' ? 'paperPdf' : 'pdf';
      const anchors = pdfAnchorKey(item);
      const anchor = anchors.length && anchors.every(([page, offset, text]) => Number.isInteger(page) && page > 0 && Number.isInteger(offset) && offset >= 0 && typeof text === 'string' && text)
        ? anchors : ['unresolved', item.id || order];
      append(`${scope === 'paperPdf' ? 'Paper · exact PDF' : 'Original PDF'} · ${pdfPageLabel(item)}`, { ...item, scope }, category, ['pdf', scope, anchor]);
    }
  }
  const scopes = { summarySource: ['Summary · source', paper.summary?.source], summaryTarget: ['Summary · translation', paper.summary?.target], fullTranslation: ['Full Translation', paper.connectedTranslation] };
  for (const [items, category] of [[paper.viewNotes, 'note'], [paper.viewHighlights, 'highlight']]) {
    for (const item of items || []) {
      const identity = ['view', item.scope, item.kind || 'source', item.sourceMode, item.displayMode, textAnchor(item, order)];
      if (item.scope === 'paperArticle') {
        append('Paper · document preview', { ...item, needsReview: item.needsReview || !paperArticleAnchorAvailable(paper, item) }, category, identity);
        continue;
      }
      const [label, source] = scopes[item.scope] || [item.scope, ''];
      append(label, item, category, identity, source || '', source);
    }
  }
  return chronological([...records.values()]);
}

function renderAnnotation(record, level = 3, { includeNotes = true, includeColors = true, analysis = false } = {}) {
  const review = record.review ? ' · source changed, review needed' : '';
  const colors = includeColors && record.colors.length ? ` · ${record.colors.join(', ')}` : '';
  const warning = analysis && record.review ? '> Source changed: this note was preserved, but its location could not be verified.\n\n' : '';
  const quote = String(record.quote || '').replace(/\r?\n/g, '\n> ');
  const notes = includeNotes ? chronological(record.notes).map(note => `${analysis ? 'Note: ' : ''}${note.body}`).join('\n\n') : '';
  return `${'#'.repeat(level)} ${record.label}${colors}${review}\n\n${warning}> ${quote}${notes ? `\n\n${notes}` : ''}`;
}

const bookmarkMarkdown = block => `- Block ${block.id}${block.page ? ` · page ${block.page}` : ''}: ${block.text}`;

export function annotationsMarkdown(paper) {
  const records = annotationRecords(paper);
  const bookmarks = paper.blocks.filter(block => block.bookmark).map(bookmarkMarkdown);
  const highlights = records.filter(record => record.hasHighlight).map(record => renderAnnotation(record, 3, { includeNotes: false }));
  const notes = records.filter(record => record.hasNote).map(record => renderAnnotation({ ...record, colors: record.noteColors }));
  return [['Bookmarks', bookmarks], ['Highlights', highlights], ['Notes', notes]]
    .map(([name, entries]) => `## ${name}\n\n${entries.join('\n\n') || 'None saved.'}`).join('\n\n');
}

export function analysisAnnotations(paper, paragraphIds) {
  const paragraphs = new Map();
  const other = [];
  for (const record of annotationRecords(paper)) {
    if (record.scope === 'reader' && !record.review && paragraphIds.has(record.blockId)) {
      const entries = paragraphs.get(record.blockId) || [];
      entries.push(renderAnnotation(record, 5, { analysis: true }));
      paragraphs.set(record.blockId, entries);
    } else other.push(renderAnnotation(record, 3, { analysis: true }));
  }
  const otherBookmarks = paper.blocks.filter(block => block.bookmark && !paragraphIds.has(block.id)).map(bookmarkMarkdown);
  if (otherBookmarks.length) other.push(`### Other Bookmarks\n\n${otherBookmarks.join('\n\n')}`);
  return {
    paragraphs: new Map([...paragraphs].map(([id, entries]) => [id, `#### Highlights and Notes\n\n${entries.join('\n\n')}`])),
    appendix: other.length ? `## Other Saved Highlights and Notes\n\n${other.join('\n\n')}` : ''
  };
}
