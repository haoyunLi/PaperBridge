import { anchorText } from './academicMarkdown.mjs';

export function annotationsMarkdown(paper) {
  const notes = [];
  const highlights = [];
  const bookmarks = [];
  const quote = text => String(text || '').replace(/\r?\n/g, '\n> ');
  function append(list, label, item, source) {
    const exact = Number.isInteger(item.offset) && source?.slice(item.offset, item.offset + item.text.length) === item.text;
    const review = item.needsReview || (source !== undefined && !exact) ? ' · source changed, review needed' : '';
    list.push(`### ${label}${item.color ? ` · ${item.color}` : ''}${review}\n\n> ${quote(item.text)}${item.body ? `\n\n${item.body}` : ''}`);
  }
  for (const block of paper.blocks) {
    if (block.bookmark) bookmarks.push(`- Block ${block.id}${block.page ? ` · page ${block.page}` : ''}: ${block.text}`);
    for (const note of block.notes || []) append(notes, `${note.scope === 'paper' ? 'Paper' : 'Reader'} · Block ${block.id} · ${note.kind || 'source'}`, note, anchorText(block, note.kind || 'source'));
    for (const item of block.highlights || []) append(highlights, `${item.scope === 'paper' ? 'Paper' : 'Reader'} · Block ${block.id} · source`, item, anchorText(block, 'source'));
    for (const item of block.translationHighlights || []) append(highlights, `${item.scope === 'paper' ? 'Paper' : 'Reader'} · Block ${block.id} · translation`, item, anchorText(block, 'translation'));
  }
  for (const [items, destination] of [[paper.pdfNotes, notes], [paper.pdfHighlights, highlights]]) {
    for (const item of items || []) append(destination, `Original PDF · page ${item.page}`, item);
  }
  const scopes = { summarySource: ['Summary · source', paper.summary?.source], summaryTarget: ['Summary · translation', paper.summary?.target], fullTranslation: ['Full Translation', paper.connectedTranslation] };
  for (const [items, destination] of [[paper.viewNotes, notes], [paper.viewHighlights, highlights]]) {
    for (const item of items || []) {
      const [label, source] = scopes[item.scope] || [item.scope, ''];
      append(destination, label, item, source || '');
    }
  }
  return [['Bookmarks', bookmarks], ['Highlights', highlights], ['Notes', notes]]
    .map(([name, entries]) => `## ${name}\n\n${entries.join('\n\n') || 'None saved.'}`).join('\n\n');
}
