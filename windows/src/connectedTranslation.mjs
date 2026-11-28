import { referenceBlockIds } from './references.mjs';
import { protectStructuredMarkdown } from './academicMarkdown.mjs';
import { pdfFootnoteMarker, sourceExcerpts } from './text.mjs';
import { countCharacters } from './sectionHeadings.mjs';
import { isLikelyOverexpandedSelection, protectMarkdown, restoreMarkdown } from './prompts.mjs';

const maxExcerptChars = 4800;
export const connectedBatchVersion = 3;
export const supportsConnectedBatchVersion = version => version === 1 || version === 2 || version === connectedBatchVersion;

// Partition the original bytes. Only the translated Markdown needs explicit link delimiters.
const protectSource = source => protectStructuredMarkdown(source, { boundLinks: false });

// Keep the original partition when resuming or exporting a saved version 1 draft.
function splitLegacyExcerpt(source) {
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

function splitSourceExcerpt(source, protect) {
  const { text, tokens } = protect(source);
  if (text.length <= maxExcerptChars) return [source];
  return sourceExcerpts(text, maxExcerptChars).map(piece => restoreMarkdown(piece, tokens.filter(([marker]) => piece.includes(marker))));
}

export function planConnectedBatches(blocks, version = connectedBatchVersion) {
  const protect = version < 3 ? protectMarkdown : protectSource;
  const splitExcerpt = version === 1 ? splitLegacyExcerpt : source => splitSourceExcerpt(source, protect);
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
    const marker = pdfFootnoteMarker(block);
    if (marker) {
      flush();
      const [first, ...rest] = splitExcerpt(source);
      batches.push({ kind: 'translation', source: first, pdfFootnoteMarker: marker });
      for (const piece of rest) batches.push({ kind: 'translation', source: piece });
      continue;
    }
    for (const piece of splitExcerpt(source)) {
      const candidate = excerpt ? `${excerpt}\n\n${piece}` : piece;
      if (excerpt) {
        const masked = protect(candidate).text;
        if (masked.length > maxExcerptChars && (version === 1 || countCharacters(masked, maxExcerptChars + 1) > maxExcerptChars)) flush();
      }
      excerpt = excerpt ? candidate : piece;
    }
  }
  flush();
  return batches;
}

export function pendingConnectedBatches(paper) {
  if (!supportsConnectedBatchVersion(paper?.connectedBatchVersion) || paper.connectedStale) return [];
  return (paper.connectedBlocks || []).filter(batch => batch.kind === 'translation' && batch.status !== 'ok');
}

export function localConnectedRetry(batch, saved, provider) {
  if (provider !== 'ollama' || saved?.source !== batch.source || saved.status !== 'failed') return null;
  // Existing drafts store Ollama's generation error as a message.
  if (saved.retryShortExcerpts || /token repeat limit reached|model response was cut off/i.test(saved.error || '')) return 'short';
  if (saved.retryProtectedMarkup === true || saved.errorCode === 'PROTECTED_MARKDOWN_CHANGED' ||
      saved.error === 'The model changed a protected formula, figure, or link. Retry this batch.') return 'markup';
  return null;
}

// On an explicit retry, smaller paragraph groups help local models keep every marker.
export function connectedRetryExcerpts(batch, localRetry, authorSource = '') {
  const source = batch.pdfFootnoteMarker ? batch.source.slice(batch.pdfFootnoteMarker.length).trimStart() : batch.source;
  const pieces = [{ source, separator: '' }];
  const containsByline = Boolean(authorSource && source.includes(authorSource));
  if (!localRetry && !containsByline) return pieces;

  const { text, tokens } = protectSource(source);
  const retryMarkup = localRetry && tokens.length > 0;
  const shorter = localRetry === 'short';
  if (!shorter && !retryMarkup && !containsByline) return pieces;
  // Mask code and equations before looking for paragraph boundaries inside a batch.
  const paragraphs = text.split(/(\r?\n(?:[ \t]*\r?\n)+)/);
  const groups = [];
  let content = paragraphs[0];
  let separator = '';
  const restore = piece => restoreMarkdown(piece, tokens.filter(([marker]) => piece.includes(marker)));
  const isByline = piece => containsByline && restore(piece) === authorSource;
  let preserve = isByline(content);
  function flush() {
    if (!shorter || preserve || content.length <= 1000) {
      groups.push({ source: restore(content), separator, ...(preserve && { preserve: true }) });
      return;
    }
    // Match each masked excerpt back to its original span to keep the whitespace
    // between translations and keep a protected formula or link in one request.
    let end = 0;
    for (const piece of sourceExcerpts(content, 1000)) {
      const start = content.indexOf(piece, end);
      groups.push({ source: restore(piece), separator: (end === 0 ? separator : '') + content.slice(end, start) });
      end = start + piece.length;
    }
    if (end < content.length) groups.push({ source: content.slice(end), separator: '', preserve: true });
  }
  for (let i = 1; i < paragraphs.length; i += 2) {
    const gap = paragraphs[i], paragraph = paragraphs[i + 1];
    const marked = content.includes('__PAPERBRIDGE_TOKEN_') || paragraph.includes('__PAPERBRIDGE_TOKEN_');
    const nextIsByline = isByline(paragraph);
    if (content && paragraph && (preserve || nextIsByline || ((retryMarkup && marked) || ((shorter || retryMarkup) && content.length + gap.length + paragraph.length > 1200)))) {
      flush();
      content = paragraph;
      preserve = nextIsByline;
      separator = gap;
    } else content += gap + paragraph;
  }
  flush();
  return groups;
}

// A model can still omit an equation from a single sentence. Translate just the
// surrounding prose in this last resort and take all Markdown bytes from the source.
export async function translateAroundMarkup(excerpt, translate) {
  const originals = new Map(excerpt.tokens);
  const spans = excerpt.text.split(/(__PAPERBRIDGE_TOKEN_\d+__|\r?\n(?:[ \t]*\r?\n)+)/);
  for (let i = 1; i < spans.length; i += 2) {
    spans[i] = originals.get(spans[i]) ?? spans[i];
    // An extraction may underline only a suffix, e.g. pre-so<u>ftmax</u>.
    if (!/^<(?:u|em|i|b|strong|sub|sup)>$/i.test(spans[i])) continue;
    const left = spans[i - 1].match(/[a-z0-9-]+$/i)?.[0];
    const right = spans[i + 1].match(/^[a-z0-9-]+/i)?.[0];
    if (left && right) {
      spans[i - 1] = spans[i - 1].slice(0, -left.length);
      spans[i + 1] = spans[i + 1].slice(right.length);
      spans[i] = left + spans[i] + right;
    }
  }
  for (let i = 0; i < spans.length; i += 2) {
    const selection = spans[i].trim();
    if (!/\p{L}/u.test(selection)) continue;
    const heading = selection.match(/^(#{1,6}[ \t]+)([^\n]+)$/);
    const translated = (await translate(heading ? heading[2] : selection)).trim();
    if (!translated || protectSource(translated).tokens.length) throw new Error('The local model could not translate the text surrounding the protected markup.');
    spans[i] = spans[i].replace(selection, () => (heading?.[1] || '') + translated);
  }
  return spans.join('');
}

export function restoreConnectedExcerpt(answer, tokens, source = '') {
  if (/^#{1,6}[ \t]+[^\n]+$/.test(source) && isLikelyOverexpandedSelection(answer, source)) {
    throw Object.assign(new Error('The model expanded a section heading into prose. Retry this batch.'),
      { code: 'PROTECTED_MARKDOWN_CHANGED' });
  }
  // All protected source markup reached the model as a placeholder. A new
  // literal equation, code fence, or link in its answer has no source anchor.
  if (protectSource(answer).tokens.some(([, value]) => !/^__PAPERBRIDGE_TOKEN_\d+__$/.test(value))) {
    throw Object.assign(new Error('The model added markup that was absent from this excerpt. Retry this batch.'),
      { code: 'PROTECTED_MARKDOWN_CHANGED' });
  }
  return restoreMarkdown(answer, tokens, 'batch');
}
