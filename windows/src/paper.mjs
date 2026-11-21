import { isHeading, joinPdfText } from './text.mjs';
import { countCharacters, detectedSectionTitle } from './documentOutline.mjs';
import { referenceBlockIds } from './references.mjs';
import { markdownBlockKind } from './academicMarkdown.mjs';

export { referenceBlockIds };

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

function characterPrefix(text, limit) {
  if (text.length <= limit) return text;
  for (const { index } of graphemes.segment(text)) {
    if (limit-- === 0) return text.slice(0, index);
  }
  return text;
}

export function libraryLabel(title, tags) {
  return {
    libraryTitle: characterPrefix(title.trim(), 200),
    tags: [...new Set(tags.split(',').map(tag => characterPrefix(tag.trim(), 40)).filter(Boolean))].sort().slice(0, 20)
  };
}

export { sectionRanges } from './documentOutline.mjs';

export function overviewSectionIds(sections) {
  const overviewTitle = /(?<![\p{Alphabetic}\p{M}\p{Nd}\p{Pc}\u200C\u200D])(?:abstract|conclusions?|concluding remarks)(?![\p{Alphabetic}\p{M}\p{Nd}\p{Pc}\u200C\u200D])|摘要|结论/iu;
  return sections.filter(section => overviewTitle.test(section.title))
    .flatMap(section => section.ids);
}

export function translationRangeIds(blocks, requestedIds = null, excluded = referenceBlockIds(blocks), retryId = null) {
  const requested = Array.isArray(requestedIds) ? new Set(requestedIds) : null;
  return blocks.filter(block => (!requested || requested.has(block.id)) && (block.status !== 'ok' || block.id === retryId) && !block.resource && !excluded.has(block.id)).map(block => block.id);
}

export function qualityIssues(blocks, excluded = new Set()) {
  return blocks.flatMap(block => {
    const value = String(block.text || '').trim();
    if (!value || block.heading || block.resource || excluded.has(block.id)) return [];
    const markdownKind = markdownBlockKind(block);
    if (markdownKind && markdownKind !== 'paragraph') return [];
    let reason = '';
    if (/[A-Za-z]{2,}[-‐]\s*$/.test(value)) reason = 'Possible cut-off word at the end. Compare with the next block and original page.';
    else if (/\b(?:in case of|where we|such as|given by|defined as)\s*$/i.test(value)) reason = 'This phrase appears unfinished. The continuation may be in the next block.';
    else if (/^[\p{Nd}\p{White_Space}.,()[\]+=×÷−*/^_]+$/u.test(value)) reason = 'Possible detached number, equation fragment, or plot label. Check the original before merging.';
    else if (value.length > 100 && !/[.!?。！？:：;；]["'”’）)\]]*\s*$/.test(value) && countCharacters(value, 101) > 100) reason = 'No sentence-ending punctuation was found. This can be valid near a formula; check the source.';
    return reason && !detectedSectionTitle(value) ? [{ id: block.id, reason, excerpt: Array.from(value).slice(-160).join('') }] : [];
  });
}

export function summarySourceBlocks(blocks) {
  const references = referenceBlockIds(blocks);
  return blocks.filter(block => !block.heading && !block.resource && !references.has(block.id) && block.text?.trim());
}

function summaryPieces(text) {
  // Mac reserves 100 characters of each 6,000-character batch for framing.
  // Slice the source itself so an exact quote can always lead back to it.
  const limit = 5900;
  if (text.length <= limit) return [text.trim()];
  const boundaries = [0];
  for (const { index, segment } of graphemes.segment(text)) boundaries.push(index + segment.length);
  const pieces = [];
  for (let start = 0; start < boundaries.length - 1;) {
    let end = Math.min(start + limit, boundaries.length - 1);
    if (end < boundaries.length - 1) {
      const excerpt = text.slice(boundaries[start], boundaries[end]);
      const midpoint = boundaries[start + Math.floor(limit / 2)] - boundaries[start];
      const sentence = [...excerpt.matchAll(/[.!?](?=\s)|[。！？]/g)].at(-1);
      const space = excerpt.search(/\s\S*$/);
      const preferredEnd = sentence && sentence.index >= midpoint ? sentence.index + 1 : space >= midpoint ? space + 1 : excerpt.length;
      const offset = boundaries[start] + preferredEnd;
      while (boundaries[end] > offset) end--;
    }
    pieces.push(text.slice(boundaries[start], boundaries[end]).trim());
    start = end;
  }
  return pieces;
}

export function summarySourceBatches(blocks) {
  const batches = [];
  let batch = [], length = 0;
  for (const { id, text } of blocks) {
    for (const piece of summaryPieces(text)) {
      if (!piece) continue;
      const size = `[P${id}]\n`.length + countCharacters(piece);
      if (length && length + 2 + size > 6000) {
        batches.push(batch);
        batch = [];
        length = 0;
      }
      length += (batch.length ? 2 : 0) + size;
      batch.push({ id, text: piece });
    }
  }
  if (batch.length) batches.push(batch);
  return batches;
}

function summaryRecords(value) {
  try {
    const parsed = JSON.parse(value.slice(value.indexOf('{'), value.lastIndexOf('}') + 1));
    if (Array.isArray(parsed?.claims)) return parsed.claims.slice(0, 6).filter(claim => typeof claim?.text === 'string' && claim.text.trim());
  } catch { /* unstructured result remains readable, without validated links */ }
  return null;
}

function summarySourceId(source) {
  const id = source?.paragraphID;
  return typeof id === 'string' && /^P?\d+$/i.test(id) ? Number(id.replace(/^P/i, '')) : id;
}

// Return the spelling in the document so Reader selection and exports use its
// original UTF-16 offsets even if the model composed an accent differently.
export function summaryQuoteMatch(text, quote, { unique = false } = {}) {
  if (typeof text !== 'string' || typeof quote !== 'string' || !quote) return null;
  const normalized = text.normalize('NFC');
  const needle = quote.normalize('NFC');
  const first = normalized.indexOf(needle);
  if (first < 0) return null;
  const segments = graphemes.segment(normalized);
  let match = -1;
  for (let start = first; start >= 0; start = normalized.indexOf(needle, start + 1)) {
    const end = start + needle.length;
    if (segments.containing(start).index !== start || (end < normalized.length && segments.containing(end).index !== end)) continue;
    if (match >= 0) return null;
    match = start;
    if (!unique) break;
  }
  if (match < 0) return null;
  const end = match + needle.length;
  if (normalized === text) return { text: text.slice(match, end), offset: match };
  let normalizedOffset = 0, offset = 0;
  for (const { segment, index } of graphemes.segment(text)) {
    if (normalizedOffset === match) offset = index;
    normalizedOffset += segment.normalize('NFC').length;
    if (normalizedOffset === end) return { text: text.slice(offset, index + segment.length), offset };
  }
  return null;
}

export function validatedSummaryQuote(text, quote) {
  if (typeof quote !== 'string' || quote.length < 20) return null;
  const length = countCharacters(quote, 501);
  if (length < 20 || length > 500) return null;
  return summaryQuoteMatch(text, quote)?.text ?? null;
}

export function parseSummaryClaims(output, blocks, allowedSources = null) {
  const trimmed = String(output || '').trim();
  if (!trimmed) return [];
  const records = summaryRecords(trimmed);
  if (!records) return [{ text: characterPrefix(trimmed, 3000), sources: [] }];
  const byId = Map.groupBy(blocks, block => block.id);
  const allowed = allowedSources && new Set(allowedSources.map(source => `${source.paragraphID}|${source.quote.normalize('NFC')}`));
  return records.map(claim => {
    const text = characterPrefix(claim.text.trim(), 1200);
    const seen = new Set();
    const sources = (Array.isArray(claim.sources) ? claim.sources : []).flatMap(source => {
      const paragraphID = summarySourceId(source);
      if (!Number.isInteger(paragraphID) || typeof source?.quote !== 'string') return [];
      const key = `${paragraphID}|${source.quote.normalize('NFC')}`;
      if (seen.has(key) || (allowed && !allowed.has(key))) return [];
      for (const block of byId.get(paragraphID) || []) {
        const quote = validatedSummaryQuote(block.text, source.quote);
        if (quote !== null) {
          seen.add(key);
          return [{ paragraphID, quote }];
        }
      }
      return [];
    }).slice(0, 2);
    return { text, sources };
  });
}

export function summarySourceCandidates(output, eligibleBlocks) {
  const records = summaryRecords(String(output || '').trim()) || [];
  const eligible = new Set(eligibleBlocks.map(block => block.id));
  return records.map(claim => [...new Set((Array.isArray(claim.sources) ? claim.sources : [])
    .map(summarySourceId).filter(id => Number.isInteger(id) && eligible.has(id)))].slice(0, 2));
}

export function claimsMarkdown(claims) {
  return claims.map((claim, index) => `${index + 1}. ${claim.text}`).join('\n\n');
}

export function revalidateSummaryClaims(claims, blocks) {
  if (!Array.isArray(claims)) return null;
  const byId = new Map(blocks.map(block => [block.id, block]));
  return claims.map(claim => ({ ...claim, sources: (Array.isArray(claim?.sources) ? claim.sources : []).flatMap(source => {
    const quote = summaryQuoteMatch(byId.get(source?.paragraphID)?.text, source?.quote)?.text;
    return quote ? [{ ...source, quote }] : [];
  }) }));
}

export function remapSummaryEvidence(summary, before, after, { start, beforeEnd, afterEnd }) {
  if (!summary) return summary;
  const claims = revalidateSummaryClaims(summary.claims, before);
  if (!claims) return { ...summary, stale: true };
  const indices = new Map(before.map((block, index) => [block.id, index]));
  const replacement = after.slice(start, afterEnd);
  return { ...summary, stale: true, claims: claims.map(claim => {
    const seen = new Set();
    const sources = claim.sources.flatMap(source => {
      const index = indices.get(source.paragraphID);
      const candidates = index < start ? [after[index]] : index >= beforeEnd ? [after[index + afterEnd - beforeEnd]] : replacement;
      const matches = candidates.flatMap(block => {
        const quote = summaryQuoteMatch(block?.text, source.quote)?.text;
        return quote ? [{ ...source, paragraphID: block.id, quote }] : [];
      });
      if (matches.length !== 1) return [];
      const [match] = matches;
      const key = `${match.paragraphID}|${match.quote.normalize('NFC')}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [match];
    });
    return { ...claim, sources };
  }) };
}

const forReview = item => item.needsReview ? item : { ...item, needsReview: true };
const matchesQuote = (text, quote, offset) => Number.isInteger(offset) && offset >= 0 && Boolean(quote) && text.startsWith(quote, offset);

function uniqueOffset(text, quote) {
  if (!quote) return null;
  const offset = text.indexOf(quote);
  return offset >= 0 && offset === text.lastIndexOf(quote) ? offset : null;
}

function moveSourceAnnotation(item, text, offset) {
  if (item.needsReview || !matchesQuote(text, item.text, offset)) return forReview(item);
  const { renderedAnchor, displayOffset, ...saved } = item;
  return { ...saved, offset, ...(Number.isInteger(displayOffset) && { displayOffset: offset }), needsReview: false };
}

export function splitBlockAt(block, cut) {
  const leftText = block.text.slice(0, cut).trimEnd();
  const rightText = block.text.slice(cut).trimStart();
  const rightStart = block.text.length - rightText.length;
  function divide(items) {
    const left = []; const right = [];
    for (const item of items || []) {
      if (!item.needsReview && Number.isInteger(item.offset) && item.offset >= rightStart) {
        right.push(moveSourceAnnotation(item, rightText, item.offset - rightStart));
      } else left.push(moveSourceAnnotation(item, leftText, item.offset));
    }
    return [left, right];
  }
  const [leftHighlights, rightHighlights] = divide(block.highlights);
  const [leftNotes, rightNotes] = divide((block.notes || []).filter(item => item.kind !== 'translation'));
  const translationNotes = (block.notes || []).filter(item => item.kind === 'translation').map(forReview);
  return [
    { ...block, text: leftText, heading: isHeading(leftText), translation: '', translationMarkdown: null, translationLanguage: null, translationHighlights: (block.translationHighlights || []).map(forReview), status: 'pending', highlights: leftHighlights, notes: [...leftNotes, ...translationNotes] },
    { ...block, text: rightText, heading: isHeading(rightText), translation: '', translationMarkdown: null, translationLanguage: null, translationHighlights: [], status: 'pending', highlights: rightHighlights, notes: rightNotes }
  ];
}

const sentenceSegmenter = new Intl.Segmenter(undefined, { granularity: 'sentence' });
const sentenceEnding = /[.!?。！？…]["'”’»）)\]】]*$/u;
const academicAbbreviation = /\b(?:figs?|eqs?|secs?|chaps?|refs?|nos?|vols?|vs|cf|approx|dept|univ|dr|prof|e\.g|i\.e|et al)\.$/i;

function sentenceBoundaries(text) {
  const end = text.trimEnd().length;
  const boundaries = [];
  for (const { index, segment } of sentenceSegmenter.segment(text)) {
    const sentence = segment.trimEnd();
    const cut = index + sentence.length;
    if (cut < end && sentenceEnding.test(sentence) && !academicAbbreviation.test(sentence)) boundaries.push(cut);
  }
  return boundaries;
}

export function splitBlockNearMiddle(block) {
  const center = block.text.length / 2;
  let best = null;
  for (const cut of sentenceBoundaries(block.text)) {
    if (best === null || Math.abs(cut - center) < Math.abs(best - center)) best = cut;
  }
  return best === null ? [block] : splitBlockAt(block, best);
}

// The edit positions refer to the original UTF-16 string, just like selection
// offsets in the Reader. This also keeps two occurrences of the same quote distinct.
function rewriteParagraphSpacing(block, edits) {
  if (!edits.length) return block;
  const pieces = [];
  let cursor = 0;
  for (const edit of edits) {
    pieces.push(block.text.slice(cursor, edit.start), edit.space);
    cursor = edit.end;
  }
  const text = pieces.join('') + block.text.slice(cursor);
  function relocate(item) {
    if (!matchesQuote(block.text, item.text, item.offset)) return forReview(item);
    let offset = item.offset;
    for (const edit of edits) {
      if (edit.end <= item.offset) offset += edit.space.length - (edit.end - edit.start);
      else if (edit.start < item.offset + item.text.length) return forReview(item);
      else break;
    }
    return moveSourceAnnotation(item, text, offset);
  }
  return { ...block, text, highlights: (block.highlights || []).map(relocate),
    notes: (block.notes || []).map(note => note.kind === 'translation' ? note : relocate(note)) };
}

export function reflowBlock(block, targetChars = 900) {
  const { text } = block;
  if (text.length <= targetChars || countCharacters(text, targetChars + 1) <= targetChars) return [block];
  const edits = [];
  const cuts = [];
  let previousEnd = 0, delta = 0, groupLength = 0;
  function setGap(end, space) {
    if (text.slice(previousEnd, end) === space) return;
    edits.push({ start: previousEnd, end, space });
    delta += space.length - (end - previousEnd);
  }
  for (const end of [...sentenceBoundaries(text), text.length]) {
    const raw = text.slice(previousEnd, end);
    const sentence = raw.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, '');
    if (!sentence) continue;
    const start = previousEnd + raw.indexOf(sentence);
    const length = countCharacters(sentence, targetChars + 1);
    if (groupLength && groupLength + 1 + length > targetChars) {
      cuts.push(previousEnd + delta);
      groupLength = 0;
    }
    setGap(start, previousEnd ? ' ' : '');
    previousEnd = start + sentence.length;
    groupLength += (groupLength ? 1 : 0) + length;
  }
  if (!cuts.length) return [block];
  setGap(text.length, '');
  let remaining = rewriteParagraphSpacing(block, edits);
  const fullLength = remaining.text.length;
  const pieces = [];
  for (const cut of cuts) {
    const offset = fullLength - remaining.text.length;
    const [first, rest] = splitBlockAt(remaining, cut - offset);
    pieces.push(first);
    remaining = rest;
  }
  return [...pieces, remaining];
}

function normalizeMergeSpacing(block) {
  const edits = [];
  for (const match of block.text.matchAll(/^\p{White_Space}+|\p{White_Space}+$|[\t ]{2,}/gu)) {
    const start = match.index, end = start + match[0].length;
    edits.push({ start, end, space: start === 0 || end === block.text.length ? '' : ' ' });
  }
  return rewriteParagraphSpacing(block, edits);
}

export function mergeBlocks(first, second) {
  const left = normalizeMergeSpacing(first), right = normalizeMergeSpacing(second);
  const text = joinPdfText(left.text, right.text);
  const rightStart = text.length - right.text.length;
  const move = (item, source, start) => matchesQuote(source, item.text, item.offset) ? moveSourceAnnotation(item, text, start + item.offset) : forReview(item);
  const moveNote = (item, source, start) => item.kind === 'translation' ? forReview(item) : move(item, source, start);
  return { ...left, text, heading: isHeading(text), translation: '', translationMarkdown: null, translationLanguage: null, status: 'pending', bookmark: left.bookmark || right.bookmark,
    highlights: [...(left.highlights || []).map(item => move(item, left.text, 0)), ...(right.highlights || []).map(item => move(item, right.text, rightStart))],
    translationHighlights: [...(left.translationHighlights || []), ...(right.translationHighlights || [])].map(forReview),
    notes: [...(left.notes || []).map(item => moveNote(item, left.text, 0)), ...(right.notes || []).map(item => moveNote(item, right.text, rightStart))]
  };
}

export function editedBlock(block, newText) {
  const text = String(newText).trim();
  const retained = uniqueOffset(text, block.text);
  function relocate(item) {
    const original = matchesQuote(block.text, item.text, item.offset) ? item.offset : uniqueOffset(block.text, item.text);
    if (original === null) return forReview(item);
    const offset = retained === null ? uniqueOffset(text, item.text) : retained + original;
    return moveSourceAnnotation(item, text, offset);
  }
  return { ...block, text, heading: isHeading(text), translation: '', translationMarkdown: null, translationLanguage: null, status: 'pending',
    translationHighlights: (block.translationHighlights || []).map(forReview),
    highlights: (block.highlights || []).map(relocate),
    notes: (block.notes || []).map(item => item.kind === 'translation' ? forReview(item) : relocate(item))
  };
}

export function editedParagraphs(block, draft) {
  if (draft === block.text) return [block];
  const paragraphs = draft.replace(/\r\n?/g, '\n').split(/\n(?:[ \t]*\n)+/)
    .map(text => text.replace(/\s*\n\s*/g, ' ').replace(/[ \t]{2,}/g, ' ').trim())
    .filter(Boolean);
  if (!paragraphs.length) return [];
  if (paragraphs.length === 1 && paragraphs[0] === block.text) return [block];

  const blocks = [];
  // Match annotations before splitting so a blank line replacing a space keeps repeated quotes at their original offsets.
  let remaining = editedBlock(block, paragraphs.join(' '));
  for (const paragraph of paragraphs.slice(0, -1)) {
    const [first, rest] = splitBlockAt(remaining, paragraph.length);
    blocks.push(first);
    remaining = rest;
  }
  return [...blocks, remaining];
}
