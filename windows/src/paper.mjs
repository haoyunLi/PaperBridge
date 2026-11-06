import { isHeading, joinPdfText } from './text.mjs';
import { referenceBlockIds } from './references.mjs';

export { referenceBlockIds };

const libraryLabelSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

export function libraryLabel(title, tags) {
  const limit = (value, count) => {
    const trimmed = value.trim();
    for (const { index } of libraryLabelSegmenter.segment(trimmed)) {
      if (count-- === 0) return trimmed.slice(0, index);
    }
    return trimmed;
  };
  return {
    libraryTitle: limit(title, 200),
    tags: [...new Set(tags.split(',').map(tag => limit(tag, 40)).filter(Boolean))].sort().slice(0, 20)
  };
}

export function sectionRanges(blocks) {
  const sections = [];
  for (const block of blocks) {
    if (block.heading) sections.push({ title: block.text.replace(/^#{1,6}\s*/, '').trim(), startId: block.id, ids: [] });
    if (!sections.length) sections.push({ title: 'Opening material', startId: block.id, ids: [] });
    sections.at(-1).ids.push(block.id);
  }
  return sections;
}

export function translationRangeIds(blocks, requestedIds = null, excluded = referenceBlockIds(blocks)) {
  const requested = Array.isArray(requestedIds) ? new Set(requestedIds) : null;
  return blocks.filter(block => (!requested || requested.has(block.id)) && block.status !== 'ok' && !block.resource && !excluded.has(block.id)).map(block => block.id);
}

export function qualityIssues(blocks, excluded = new Set()) {
  return blocks.flatMap(block => {
    const value = String(block.text || '').trim();
    if (!value || block.heading || block.resource || excluded.has(block.id)) return [];
    let reason = '';
    if (/[A-Za-z]{2,}[-‐]\s*$/.test(value)) reason = 'Possible cut-off word at the end. Compare with the next block and original page.';
    else if (/\b(?:in case of|where we|such as|given by|defined as)\s*$/i.test(value)) reason = 'This phrase appears unfinished. The continuation may be in the next block.';
    else if (/^[\d\s.,()[\]+=×÷−*/^_]+$/.test(value)) reason = 'Possible detached number, equation fragment, or plot label. Check the original before merging.';
    else if (value.length > 100 && !/[.!?。！？:：;；]["'”’）)\]]*\s*$/.test(value)) reason = 'No sentence-ending punctuation was found. This can be valid near a formula; check the source.';
    return reason ? [{ id: block.id, reason, excerpt: Array.from(value).slice(-160).join('') }] : [];
  });
}

export function summarySourceBlocks(blocks) {
  const references = referenceBlockIds(blocks);
  return blocks.filter(block => !block.heading && !block.resource && !references.has(block.id) && block.text?.trim());
}

export function summarySourceBatches(blocks) {
  const batches = [];
  let batch = [];
  let length = 0;
  for (const { id, text } of blocks) {
    const labelLength = `[P${id}]\n`.length;
    const maxText = 6000 - labelLength;
    for (let start = 0; start < text.length;) {
      let end = Math.min(start + maxText, text.length);
      if (end < text.length) {
        const excerpt = text.slice(start, end);
        const sentence = [...excerpt.matchAll(/[.!?](?=\s)|[。！？]/g)].at(-1);
        const space = excerpt.search(/\s\S*$/);
        if (sentence && sentence.index >= maxText / 2) end = start + sentence.index + 1;
        else if (space >= maxText / 2) end = start + space + 1;
        if (/[\uD800-\uDBFF]/.test(text[end - 1])) end--;
      }
      const piece = text.slice(start, end).trim();
      start = end;
      if (!piece) continue;
      const size = labelLength + piece.length;
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

export function parseSummaryClaims(output, blocks, allowedSources = null) {
  const trimmed = String(output || '').trim();
  if (!trimmed) return [];
  const records = summaryRecords(trimmed);
  if (!records) return [{ text: trimmed.slice(0, 3000), sources: [] }];
  const byId = Map.groupBy(blocks, block => block.id);
  const allowed = allowedSources && new Set(allowedSources.map(source => `${source.paragraphID}|${source.quote}`));
  return records.map(claim => {
    const text = claim.text.trim().slice(0, 1200);
    const seen = new Set();
    const sources = (Array.isArray(claim.sources) ? claim.sources : []).flatMap(source => {
      const paragraphID = summarySourceId(source);
      const quote = source?.quote;
      const key = `${paragraphID}|${quote}`;
      if (!Number.isInteger(paragraphID) || typeof quote !== 'string' || quote.length < 20 || quote.length > 500 || seen.has(key)) return [];
      if (!byId.get(paragraphID)?.some(block => block.text.includes(quote)) || (allowed && !allowed.has(key))) return [];
      seen.add(key);
      return [{ paragraphID, quote }];
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
  return claims.map(claim => ({ ...claim, sources: (Array.isArray(claim?.sources) ? claim.sources : []).filter(source =>
    typeof source?.quote === 'string' && source.quote.length && byId.get(source.paragraphID)?.text.includes(source.quote)) }));
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
      let target;
      if (index < start) target = after[index];
      else if (index >= beforeEnd) target = after[index + afterEnd - beforeEnd];
      else {
        const candidates = replacement.filter(block => block.text.includes(source.quote));
        if (candidates.length === 1) target = candidates[0];
      }
      if (!target?.text.includes(source.quote)) return [];
      const key = `${target.id}|${source.quote}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [{ ...source, paragraphID: target.id }];
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
    { ...block, text: leftText, heading: isHeading(leftText), translation: '', translationMarkdown: null, translationHighlights: (block.translationHighlights || []).map(forReview), status: 'pending', highlights: leftHighlights, notes: [...leftNotes, ...translationNotes] },
    { ...block, text: rightText, heading: isHeading(rightText), translation: '', translationMarkdown: null, translationHighlights: [], status: 'pending', highlights: rightHighlights, notes: rightNotes }
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

export function reflowBlock(block, targetChars = 900) {
  if (block.text.length <= targetChars) return [block];
  const boundaries = sentenceBoundaries(block.text);
  const pieces = [];
  let remaining = block;
  let start = 0;
  let previous = 0;
  for (const end of [...boundaries, block.text.length]) {
    if (end - start > targetChars && previous > start) {
      const [left, right] = splitBlockAt(remaining, previous - start);
      pieces.push(left);
      remaining = right;
      start = block.text.length - remaining.text.length;
    }
    previous = end;
  }
  return [...pieces, remaining];
}

export function mergeBlocks(left, right) {
  const text = joinPdfText(left.text, right.text);
  const rightStart = text.length - right.text.length;
  const move = (item, source, start) => matchesQuote(source, item.text, item.offset) ? moveSourceAnnotation(item, text, start + item.offset) : forReview(item);
  const moveNote = (item, source, start) => item.kind === 'translation' ? forReview(item) : move(item, source, start);
  return { ...left, text, heading: isHeading(text), translation: '', translationMarkdown: null, status: 'pending', bookmark: left.bookmark || right.bookmark,
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
  return { ...block, text, heading: isHeading(text), translation: '', translationMarkdown: null, status: 'pending',
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
