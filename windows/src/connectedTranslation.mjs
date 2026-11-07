import { referenceBlockIds } from './paper.mjs';
import { protectMarkdown, restoreMarkdown } from './prompts.mjs';

const maxExcerptChars = 4800;
export const connectedBatchVersion = 1;

function splitExcerpt(source) {
  const { text, tokens } = protectMarkdown(source);
  if (text.length <= maxExcerptChars) return [source];

  const protectedRanges = [...text.matchAll(/__PAPERBRIDGE_TOKEN_\d+__/g)].map(match => ({
    start: match.index, end: match.index + match[0].length
  }));
  const pieces = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(start + maxExcerptChars, text.length);
    if (end < text.length) {
      const window = text.slice(start, end);
      const sentence = [...window.matchAll(/[.!?。！？](?:\s+|(?<=[。！？]))/g)].at(-1);
      const space = window.search(/\s\S*$/);
      if (sentence && sentence.index >= maxExcerptChars / 2) end = start + sentence.index + sentence[0].length;
      else if (space >= maxExcerptChars / 2) end = start + space + 1;
      const protectedRange = protectedRanges.find(range => range.start < end && end < range.end);
      if (protectedRange) end = protectedRange.start;
      if (/[\uD800-\uDBFF]/.test(text[end - 1])) end--;
    }
    const piece = text.slice(start, end).trim();
    if (piece) pieces.push(restoreMarkdown(piece, tokens.filter(([token]) => piece.includes(token))));
    start = end;
  }
  return pieces;
}

export function planConnectedBatches(blocks) {
  const references = referenceBlockIds(blocks);
  const batches = [];
  let excerpt = '';
  function flush() {
    if (excerpt) batches.push({ kind: 'translation', source: excerpt });
    excerpt = '';
  }
  for (const block of blocks) {
    const source = (block.sourceMarkdown || block.text || '').trim();
    if (!source) continue;
    if (block.resource || references.has(block.id)) {
      flush();
      batches.push({ kind: 'original', source });
      continue;
    }
    for (const piece of splitExcerpt(source)) {
      const candidate = excerpt ? `${excerpt}\n\n${piece}` : piece;
      if (excerpt && protectMarkdown(candidate).text.length > maxExcerptChars) flush();
      excerpt = excerpt ? candidate : piece;
    }
  }
  flush();
  return batches;
}

export function pendingConnectedBatches(paper) {
  if (paper?.connectedBatchVersion !== connectedBatchVersion || paper.connectedStale) return [];
  return (paper.connectedBlocks || []).filter(batch => batch.kind === 'translation' && batch.status !== 'ok');
}

export function restoreConnectedExcerpt(answer, tokens) {
  const markers = answer.match(/__PAPERBRIDGE_TOKEN_\d+__/g) || [];
  if (markers.length !== tokens.length || tokens.some(([marker], index) => markers[index] !== marker)) {
    throw new Error('The model changed a protected formula, image, or link. Retry this batch.');
  }
  return restoreMarkdown(answer, tokens);
}
