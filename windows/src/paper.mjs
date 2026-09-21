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

export function parseSummaryClaims(output, blocks, allowedSources = null, providedText = null) {
  const trimmed = String(output || '').trim();
  if (!trimmed) return [];
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  let parsed;
  try { parsed = JSON.parse(trimmed.slice(first, last + 1)); } catch { /* unstructured result remains readable, without validated links */ }
  if (!Array.isArray(parsed?.claims)) return [{ text: trimmed.slice(0, 3000), sources: [] }];
  const byId = new Map(blocks.map(block => [block.id, block]));
  const allowed = allowedSources && new Set(allowedSources.map(source => `${source.paragraphID}|${source.quote}`));
  return parsed.claims.slice(0, 6).flatMap(claim => {
    const text = String(claim?.text || '').trim().slice(0, 1200);
    if (!text) return [];
    const seen = new Set();
    const sources = (Array.isArray(claim.sources) ? claim.sources : []).filter(source => {
      const id = source?.paragraphID;
      const quote = source?.quote;
      const key = `${id}|${quote}`;
      if (!Number.isInteger(id) || typeof quote !== 'string' || quote.length < 20 || quote.length > 500 || seen.has(key)) return false;
      if (!byId.get(id)?.text.includes(quote) || (allowed && !allowed.has(key))) return false;
      if (providedText && (!providedText.includes(`[P${id}]\n`) || !providedText.includes(quote))) return false;
      seen.add(key);
      return true;
    }).slice(0, 2).map(source => ({ paragraphID: source.paragraphID, quote: source.quote }));
    return [{ text, sources }];
  });
}

export function summarySourceCandidates(output, eligibleBlocks) {
  const trimmed = String(output || '').trim();
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  let parsed;
  try { parsed = JSON.parse(trimmed.slice(first, last + 1)); } catch { return []; }
  if (!Array.isArray(parsed?.claims)) return [];
  const eligible = new Set(eligibleBlocks.map(block => block.id));
  return parsed.claims.slice(0, 6).map(claim => (Array.isArray(claim.sources) ? claim.sources : [])
    .map(source => source?.paragraphID)
    .map(id => typeof id === 'string' && /^P?\d+$/i.test(id) ? Number(id.replace(/^P/i, '')) : id)
    .filter(id => Number.isInteger(id) && eligible.has(id)).slice(0, 2));
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
