import { anchorText } from './academicMarkdown.mjs';
import { blockMarkdown, paperArticleAnchorAvailable, textAnchorAvailable } from './markdownAnchors.mjs';
import { pdfPageLabel } from './pdfAnchors.mjs';

export function annotationsMarkdown(paper) {
  const notes = [];
  const highlights = [];
  const bookmarks = [];
  const quote = text => String(text || '').replace(/\r?\n/g, '\n> ');
  function append(list, label, item, source, markdown) {
    const review = item.needsReview || (source !== undefined && !textAnchorAvailable(item, source, markdown)) ? ' · source changed, review needed' : '';
    list.push(`### ${label}${item.color ? ` · ${item.color}` : ''}${review}\n\n> ${quote(item.quote ?? item.text)}${item.body ? `\n\n${item.body}` : ''}`);
  }
  for (const block of paper.blocks) {
    if (block.bookmark) bookmarks.push(`- Block ${block.id}${block.page ? ` · page ${block.page}` : ''}: ${block.text}`);
    for (const note of block.notes || []) {
      const kind = note.kind || 'source';
      append(notes, `${note.scope === 'paper' ? 'Paper' : 'Reader'} · Block ${block.id} · ${kind}`, note, anchorText(block, kind), blockMarkdown(block, kind));
    }
    for (const item of block.highlights || []) append(highlights, `${item.scope === 'paper' ? 'Paper' : 'Reader'} · Block ${block.id} · source`, item, anchorText(block, 'source'), blockMarkdown(block, 'source'));
    for (const item of block.translationHighlights || []) append(highlights, `${item.scope === 'paper' ? 'Paper' : 'Reader'} · Block ${block.id} · translation`, item, anchorText(block, 'translation'), blockMarkdown(block, 'translation'));
  }
  for (const [items, destination] of [[paper.pdfNotes, notes], [paper.pdfHighlights, highlights]]) {
    for (const item of items || []) append(destination, `${item.scope === 'paperPdf' ? 'Paper · exact PDF' : 'Original PDF'} · ${pdfPageLabel(item)}`, item);
  }
  const scopes = { summarySource: ['Summary · source', paper.summary?.source], summaryTarget: ['Summary · translation', paper.summary?.target], fullTranslation: ['Full Translation', paper.connectedTranslation] };
  for (const [items, destination] of [[paper.viewNotes, notes], [paper.viewHighlights, highlights]]) {
    for (const item of items || []) {
      if (item.scope === 'paperArticle') {
        append(destination, 'Paper · document preview', { ...item, needsReview: item.needsReview || !paperArticleAnchorAvailable(paper, item) });
        continue;
      }
      const [label, source] = scopes[item.scope] || [item.scope, ''];
      append(destination, label, item, source || '', source);
    }
  }
  return [['Bookmarks', bookmarks], ['Highlights', highlights], ['Notes', notes]]
    .map(([name, entries]) => `## ${name}\n\n${entries.join('\n\n') || 'None saved.'}`).join('\n\n');
}
