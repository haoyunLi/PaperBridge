import { isHeading } from './text.mjs';

const referenceHeading = /^(?:\d+(?:\.\d+)*[.)]?\s*)?(?:references|bibliography|works cited|literature cited|reference list)\s*$/i;
const postReferenceHeading = /^(?:\d+(?:\.\d+)*[.)]?\s*)?(?:star[+\s-]*methods|resource availability|method details|key resources table|supplemental information|supplementary (?:information|materials?|figures?)|appendix|methods?|materials and methods)\s*$/i;

export function referenceBlockIds(blocks) {
  const ids = new Set();
  let inside = false;
  for (const block of blocks) {
    const heading = block.heading || /^#{1,6}\s/.test(block.sourceMarkdown || '');
    const title = String(block.text || '').replace(/^#{1,6}\s*/, '').trim();
    if (heading && referenceHeading.test(title)) inside = true;
    else if (inside && heading && postReferenceHeading.test(title)) inside = false;
    if (inside) ids.add(block.id);
  }
  return ids;
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
    return reason ? [{ id: block.id, reason }] : [];
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
  return claims.map(claim => ({ ...claim, sources: (claim.sources || []).filter(source => byId.get(source.paragraphID)?.text.includes(source.quote)) }));
}

export function splitBlockAt(block, cut) {
  const leftText = block.text.slice(0, cut).trimEnd();
  const rightText = block.text.slice(cut).trimStart();
  const rightStart = block.text.length - block.text.slice(cut).trimStart().length;
  function divide(items) {
    const left = []; const right = [];
    for (const item of items || []) {
      const offset = item.offset;
      const destination = Number.isInteger(offset) && offset >= rightStart ? right : left;
      const mapped = { ...item, offset: destination === right && Number.isInteger(offset) ? offset - rightStart : offset };
      if (!Number.isInteger(offset) || (offset < rightStart && offset + String(item.text || '').length > cut)) mapped.needsReview = true;
      destination.push(mapped);
    }
    return [left, right];
  }
  const [leftHighlights, rightHighlights] = divide(block.highlights);
  const [leftNotes, rightNotes] = divide((block.notes || []).filter(item => item.kind !== 'translation'));
  const translationNotes = (block.notes || []).filter(item => item.kind === 'translation').map(item => ({ ...item, needsReview: true }));
  return [
    { ...block, text: leftText, heading: isHeading(leftText), translation: '', translationMarkdown: null, translationHighlights: [], status: 'pending', highlights: leftHighlights, notes: [...leftNotes, ...translationNotes] },
    { ...block, text: rightText, heading: isHeading(rightText), translation: '', translationMarkdown: null, translationHighlights: [], status: 'pending', bookmark: false, highlights: rightHighlights, notes: rightNotes }
  ];
}

export function reflowBlock(block, targetChars = 900) {
  const pieces = [];
  let remaining = block;
  while (remaining.text.length > targetChars) {
    const boundaries = [...remaining.text.matchAll(/[.!?。！？](?=\s|$)/g)].map(match => match.index + 1).filter(at => at < remaining.text.length);
    const cut = boundaries.filter(at => at <= targetChars).at(-1) || boundaries[0];
    if (!cut) break;
    const [left, right] = splitBlockAt(remaining, cut);
    if (!left.text || !right.text) break;
    pieces.push(left);
    remaining = right;
  }
  return [...pieces, remaining];
}

export function mergeBlocks(left, right) {
  const offset = left.text.length + 1;
  const text = `${left.text} ${right.text}`;
  return { ...left, text, heading: isHeading(text), translation: '', translationMarkdown: null, status: 'pending', bookmark: left.bookmark || right.bookmark,
    highlights: [...(left.highlights || []), ...(right.highlights || []).map(item => ({ ...item, offset: Number.isInteger(item.offset) ? item.offset + offset : item.offset }))],
    translationHighlights: [],
    notes: [...(left.notes || []).map(item => item.kind === 'translation' ? { ...item, needsReview: true } : item), ...(right.notes || []).map(item => ({ ...item, offset: Number.isInteger(item.offset) && item.kind !== 'translation' ? item.offset + offset : item.offset, needsReview: item.kind === 'translation' ? true : item.needsReview }))]
  };
}

export function editedBlock(block, newText) {
  const text = String(newText).trim();
  function position(item) {
    if (Number.isInteger(item.offset) && text.slice(item.offset, item.offset + item.text.length) === item.text) return item.offset;
    const first = text.indexOf(item.text);
    return first >= 0 && first === text.lastIndexOf(item.text) ? first : null;
  }
  return { ...block, text, heading: isHeading(text), translation: '', translationMarkdown: null, translationHighlights: [], status: 'pending',
    highlights: (block.highlights || []).flatMap(item => { const offset = position(item); return offset === null ? [] : [{ ...item, offset }]; }),
    notes: (block.notes || []).map(item => {
      if (item.kind === 'translation') return { ...item, needsReview: true };
      const offset = position(item);
      return offset === null ? { ...item, needsReview: true } : { ...item, offset, needsReview: false };
    })
  };
}
