import { fencedCodeMarkdown } from '../electron/markdown-code-context.mjs';
export { fencedCodeMarkdown as pdfListingMarkdown };
import { isMethodsHeading, splitLeadingReferenceHeading } from './references.mjs';
import { numberedSectionTitle, splitJoinedSections } from './sectionHeadings.mjs';
import { countCharacters, sectionRanges } from './documentOutline.mjs';
import { compoundSuffixes, repairSpacedHyphenation } from './spacedHyphenation.mjs';

export const practiceParagraphs = [
  "Abstract",
  "This is a fictional practice document, not a published study. Use it to explore source-linked reading, translation, highlights, and notes without importing a personal paper.",
  "1 Introduction",
  "Reading a paper across languages involves more than translating its sentences. Readers need to connect a claim to the method and evidence that support it.",
  "2 Methods",
  "Start with the reading map, then open the linked source passage. Translate one paragraph when needed, or translate the whole document with a local Ollama model.",
  "3 Results",
  "Selecting a phrase opens tools for translation, explanation, highlighting, and notes. This practice document contains no measured results or claims about model accuracy.",
  "4 Limitations",
  "A summary is a reading aid, not a substitute for evidence. PDF text extraction and local models can make mistakes; compare uncertain passages with the Original PDF when one is available.",
  "5 Conclusion",
  "Keep useful passages in bookmarks, retain your notes, and export the material you want to revisit. This sample requires no model until you choose an AI action."
];

const headingNames = /^(?:\d+(?:\.\d+)*[.)]?\s*)?(abstract|introduction|background|related work|methods?|methodology|materials and methods|experimental setup|results?|experiments?|evaluation|discussion|limitations?|conclusions?|references|bibliography|appendix|acknowledg(?:e)?ments|摘要|引言|方法|结果|讨论|结论)\s*$/i;
const leadingNamedSection = /^(?:(?:\d+(?:\.\d+)*)\s+)?(?:abstract|introduction|background|related work|methods?|methodology|materials and methods|experimental setup|experiments?|evaluation|results?|discussion|conclusions?|appendix|acknowledg(?:e)?ments)(?:[.:])?\s+/i;
const pdfCaption = /^(?:figure|fig\.|table)\s+\d+[.:]/i;

export function isHeading(text, sourceMarkdown = null) {
  const value = String(text || '').trim();
  const markdown = typeof sourceMarkdown === 'string' ? sourceMarkdown.trim() : '';
  if (markdown && !markdown.includes('\n') && !value.includes('\n') && value.length <= 200 && /^#{1,6}[ \t]+\S/.test(markdown)) return true;
  if (!value || value.includes('\n') || value.length > 120 || value.includes('@') || /[.!?]["')\]]?$/.test(value)) return false;
  const leading = value.match(leadingNamedSection)?.[0] || '';
  if (value.length >= 30 && leading && value.slice(leading.length).trim().length >= 20) return false;
  if (headingNames.test(value) || numberedSectionTitle.test(value)) return true;
  const words = value.split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 12) return false;
  const titleCaseWords = words.filter(word => /^\p{Lu}/u.test(word)).length;
  const letters = [...value].filter(character => /\p{L}/u.test(character));
  const uppercaseLetters = letters.filter(character => /\p{Lu}/u.test(character)).length;
  const uppercaseRatio = letters.length ? uppercaseLetters / letters.length : 0;
  return uppercaseRatio > 0.6 || titleCaseWords / words.length > 0.8;
}

export function cleanLine(value) {
  return value.replace(/\u00ad/g, '').replace(/\s+/g, ' ').trim();
}

export function normalizeExtractedLine(value) {
  const singleLine = value.replace(/\t/g, ' ').replace(/\p{White_Space}*\n\p{White_Space}*/gu, ' ');
  return trimExtractedWhitespace(repairSpacedHyphenation(singleLine).replace(/\p{White_Space}{2,}/gu, ' '));
}

function trimExtractedWhitespace(value) {
  return value.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, '');
}

export function finishExtractedPdfText(value) {
  // Mac postProcessParagraphs, then buildPaper's cleanExtractedText. The latter
  // removes soft hyphens before its final line-normalization pass.
  return normalizeExtractedLine(repairSpacedHyphenation(value).replace(/\u00ad/g, ''));
}

export function joinPdfText(left, right) {
  if (/[-‐]$/u.test(left) && /^[\p{L}\p{N}]/u.test(right)) {
    // A standalone minus and a numerical range or model identifier must keep
    // their sign when the two sides come from different PDF lines.
    if (/\p{White_Space}[-‐]$/u.test(left)) return left + ' ' + right;
    if (/^\p{N}/u.test(right)) return left + right;
    const word = left.slice(0, -1).match(/[^\p{White_Space}]+/gu)?.at(-1);
    const next = right.match(/^[^\p{White_Space}]+/u)[0].replace(/^\p{P}+|\p{P}+$/gu, '').toLowerCase();
    // "English-" + "to-German" keeps the hyphen before the compound suffix.
    const suffix = next.split(/[-‐]/u, 1)[0];
    const removeHyphen = word && !/[-‐]/u.test(word) && !compoundSuffixes.has(suffix)
      && (/^\p{Lowercase}/u.test(right) || countCharacters(word, 6) <= 5);
    return (removeHyphen ? left.slice(0, -1) : left) + right;
  }
  const needsSpace = left && right && !/[/(]$/u.test(left) && !/^\p{P}/u.test(right);
  return left + (needsSpace ? ' ' : '') + right;
}

export function blocksFromText(text) {
  let input = text.replace(/\r\n?/g, '\n');
  // Mac's multiline import normalizes each physical line before the final
  // paragraph pass; a single-line paste only receives the paragraph pass.
  const multiline = input.includes('\n');
  if (multiline) input = input.replace(/\u00ad/g, '');
  return input.split(/\n\s*\n/).flatMap(part => {
    const raw = trimExtractedWhitespace(part);
    const lines = raw.split('\n').map(line => multiline ? normalizeExtractedLine(line) : line).filter(Boolean);
    const joined = lines.length > 1 && isMethodsHeading(lines[0])
      ? lines[0] + '\n' + lines.slice(1).join(' ') : lines.join(' ');
    const value = trimExtractedWhitespace(repairSpacedHyphenation(joined));
    if (!value) return [];
    const parts = splitJoinedSections(value).flatMap(splitLeadingReferenceHeading);
    return parts.map(piece => ({ raw: parts.length === 1 ? raw : piece, value: piece }));
  })
    .map(({ raw, value }, index) => ({ id: index + 1, text: value, page: null, heading: isHeading(raw.includes('\n') ? raw : value), translation: '', status: 'pending', bookmark: false, highlights: [], notes: [] }));
}

export function joinLines(lines) {
  let text = '';
  for (const line of lines) {
    const value = trimExtractedWhitespace(line.text || line);
    if (!value) continue;
    text = text ? joinPdfText(text, value) : value;
  }
  return trimExtractedWhitespace(text.replace(/[\t ]{2,}/g, ' '));
}

export function pdfFootnoteMarker(block) {
  const marker = block.pdfFootnoteMarker;
  if (block.sourceMarkdown || typeof marker !== 'string' || !/^(?:\p{Nd}{1,3}|[*†‡])$/u.test(marker)) return '';
  return block.text?.startsWith(marker) && /^\s*\p{L}/u.test(block.text.slice(marker.length)) ? marker : '';
}

function groupPdfListings(lines) {
  const output = [];
  for (let start = 0; start < lines.length;) {
    const first = lines[start++];
    if (!first.codeText || !(first.codeCellWidth > 0)) { output.push(first); continue; }
    let end = start;
    while (end < lines.length) {
      const line = lines[end], previous = lines[end - 1];
      const gap = previous.y - line.y;
      if (!line.codeText || !(line.codeCellWidth > 0) || gap <= 0 || gap > 1.8 * Math.max(previous.height, line.height)) break;
      end++;
    }
    const run = lines.slice(start - 1, end);
    if (run.some(line => /^(?:[A-Za-z_]\w*\s*=\s*\S|\.{1,2}\/\S|\w[\w.-]*\s+--?\w|#{1,6}\s+\S|[|│].*[-─├└]|(?:def|import|function)\s+\w)/u.test(line.codeText))) {
      const left = Math.min(...run.map(line => line.x));
      const listing = run.map(line => {
        const indent = Math.max(0, Math.round((line.x - left) / line.codeCellWidth));
        return ' '.repeat(Math.min(80, indent)) + line.codeText;
      }).join('\n');
      output.push({ ...first, listing, independent: true });
    } else output.push(...run);
    start = end;
  }
  return output;
}

export function isPdfListing(block) {
  if (typeof block?.sourceMarkdown !== 'string' || !block.sourceMarkdown.startsWith('```') || typeof block.text !== 'string') return false;
  const fence = block.sourceMarkdown.split('\n', 1)[0];
  return /^`{3,}$/.test(fence) && block.sourceMarkdown === fence + '\n' + block.text + '\n' + fence;
}

export function blocksFromLines(lines, pageNumber, startId = 1, preserveOrder = false) {
  const sorted = lines.map(line => ({ ...line, text: normalizeExtractedLine(line.text) })).filter(line => line.text);
  if (!preserveOrder) sorted.sort((a, b) => b.y - a.y || a.x - b.x);
  const blocks = [];
  let group = [];
  let bulletIndent = null;
  const flush = () => {
    const listing = group[0]?.listing;
    const text = listing || joinLines(group);
    const raw = group.map(line => cleanLine(line.text || line)).filter(Boolean).join('\n');
    if (text) {
      const block = { id: startId + blocks.length, text, page: pageNumber, heading: isHeading(raw), translation: '', status: 'pending', bookmark: false, highlights: [], notes: [] };
      if (listing) {
        block.sourceMarkdown = fencedCodeMarkdown(text);
        block.heading = false;
      }
      if (group[0].raisedNoteMarker) block.pdfFootnoteMarker = group[0].raisedNoteMarker;
      blocks.push(block);
    }
    group = [];
    bulletIndent = null;
  };
  const widths = sorted.map(line => line.height || 12).sort((a, b) => a - b);
  const typicalHeight = widths[Math.floor(widths.length / 2)] || 12;
  const readingLines = groupPdfListings(sorted);
  for (const [index, line] of readingLines.entries()) {
    const previous = group[group.length - 1];
    const gap = previous ? previous.y - line.y : 0;
    const heading = isHeading(line.text);
    const nextStarts = /^[A-Z\u4e00-\u9fff]/.test(line.text);
    const previousEnds = previous && /[.!?。！？:]$/.test(previous.text);
    const startsFootnote = line.raisedNoteMarker && line.height <= Math.max(typicalHeight, previous?.height || 0) * 0.9;
    const continuesFootnote = group[0]?.raisedNoteMarker && previous && Math.abs(line.height - previous.height) <= line.height * 0.1
      && gap >= 0 && gap <= line.height * 1.45;
    const startsBullet = /^[•‣◦]\s/u.test(line.text);
    // A return to the body margin after a hanging list can start with a lowercase name.
    const afterList = bulletIndent !== null && /^[\p{L}\p{N}]/u.test(line.text) &&
      /[.!?。！？][”’"')\]]*$/u.test(previous?.text || '') &&
      line.x < bulletIndent - typicalHeight * 0.6 && gap > typicalHeight * 1.3;
    if (previous && (afterList || startsFootnote || line.independent || heading || pdfCaption.test(line.text) || gap > typicalHeight * 1.8 || gap < -typicalHeight * 3 || (previousEnds && nextStarts && !continuesFootnote && gap > typicalHeight * 1.1))) flush();
    if (startsBullet) bulletIndent = line.x;
    group.push(line);
    // A short title-cased fragment such as "The English-" can be the first
    // physical line of body prose. Keep a close lowercase continuation with it.
    const next = readingLines[index + 1];
    const wrapsHeading = heading && next && !next.independent && /[-‐]$/u.test(line.text)
      && /^\p{Ll}/u.test(next.text) && line.y > next.y && line.y - next.y <= typicalHeight * 1.8
      && Math.abs(line.x - next.x) <= typicalHeight * 2;
    if (line.independent || (heading && !wrapsHeading)) flush();
  }
  flush();
  return blocks;
}

export function readingMap(blocks, sections = sectionRanges(blocks)) {
  const normalized = value => String(value || '').trim().toLowerCase()
    .replace(/^(?:\p{Nd}+(?:\.\p{Nd}+)*[.)]?|[ivx]+\.)\p{White_Space}+/u, '')
    .replace(/^[.:： ]+|[.:： ]+$/g, '');
  const byId = new Map(blocks.map(block => [block.id, block]));
  const longEnough = block => block && countCharacters(trimExtractedWhitespace(block.text), 40) >= 40;
  const topics = [
    { id: 'question', title: 'The research question', question: 'What problem does this paper address?', headings: ['abstract', 'introduction', 'background', '摘要', '引言', '背景'] },
    { id: 'method', title: 'The approach', question: 'How did the authors investigate it?', headings: ['method', 'methods', 'methodology', 'materials and methods', 'approach', 'model', 'architecture', '方法', '材料与方法'] },
    { id: 'evidence', title: 'The evidence', question: 'Which experiments support the claims?', headings: ['results', 'experiments', 'evaluation', 'experimental results', '结果', '实验'] },
    { id: 'limits', title: 'Interpretation and limits', question: 'Where should the conclusions be treated cautiously?', headings: ['limitations', 'discussion', 'limitations and discussion', '讨论', '局限性'] },
    { id: 'conclusion', title: 'The takeaway', question: 'What do the authors conclude?', headings: ['conclusion', 'conclusions', 'concluding remarks', '结论'] }
  ];
  const matches = topics.map(topic => {
    const section = sections.find(section => {
      const title = normalized(section.title);
      return topic.headings.some(name => title === name || title.startsWith(`${name}:`) || title.startsWith(`${name} and `));
    });
    if (!section) return null;
    const sourceId = section.ids.find(id => {
      const block = byId.get(id);
      return longEnough(block) && (id !== section.startId || normalized(block.text.replace(/^#{1,6}\s+/, '')) !== normalized(section.title));
    });
    return sourceId === undefined ? null : { id: topic.id, title: topic.title, question: topic.question,
      sectionTitle: section.title, paragraphID: sourceId, excerpt: byId.get(sourceId).text };
  }).filter(Boolean);
  if (matches.length) return matches;
  const firstId = sections.flatMap(section => section.ids).find(id => longEnough(byId.get(id)));
  const first = byId.get(firstId);
  return first ? [{ id: 'beginning', title: 'Start at the beginning', question: 'Section headings were not identified reliably. Read the source before drawing conclusions.', sectionTitle: 'Opening passage', paragraphID: first.id, excerpt: first.text }] : [];
}

const chunkGraphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const chunkSentences = new Intl.Segmenter(undefined, { granularity: 'sentence' });
const chunkAbbreviation = /\b(?:figs?|eqs?|secs?|chaps?|refs?|nos?|vols?|vs|cf|approx|dept|univ|dr|prof|e\.g|i\.e|et al)\.$/i;
const graphemeCount = text => [...chunkGraphemes.segment(text)].length;

function packChunks(segments, limit) {
  const packed = [];
  let current = '', length = 0;
  for (const segment of segments) {
    const piece = trimExtractedWhitespace(segment);
    if (!piece) continue;
    const size = graphemeCount(piece);
    if (current && length + 1 + size > limit) { packed.push(current); current = ''; length = 0; }
    length += size + (current ? 1 : 0);
    current += (current ? ' ' : '') + piece;
  }
  if (current) packed.push(current);
  return packed;
}

function splitChunkUnits(word, limit) {
  // Protected formulas, figures and links must survive even when a token is
  // adjacent to prose. Only an atomic token may exceed the requested limit.
  const units = [];
  let start = 0;
  const appendText = value => { for (const { segment } of chunkGraphemes.segment(value)) units.push({ text: segment, size: 1 }); };
  for (const match of word.matchAll(/__PAPERBRIDGE_TOKEN_\d+__/g)) {
    appendText(word.slice(start, match.index));
    units.push({ text: match[0], size: graphemeCount(match[0]) });
    start = match.index + match[0].length;
  }
  appendText(word.slice(start));
  const pieces = [];
  let current = '', length = 0;
  for (const unit of units) {
    if (current && length + unit.size > limit) { pieces.push(current); current = ''; length = 0; }
    current += unit.text; length += unit.size;
    if (length >= limit) { pieces.push(current); current = ''; length = 0; }
  }
  if (current) pieces.push(current);
  return pieces;
}

export function chunkText(text, maxLength = 1800) {
  if (!Number.isFinite(maxLength) || maxLength < 1) throw new RangeError('The paragraph chunk limit must be positive and finite.');
  const limit = Math.floor(maxLength), trimmed = trimExtractedWhitespace(text);
  if (!trimmed) return [];
  if (graphemeCount(trimmed) <= limit) return [trimmed];
  const sentences = [];
  for (const { segment } of chunkSentences.segment(trimmed)) {
    const piece = trimExtractedWhitespace(segment);
    if (sentences.length && chunkAbbreviation.test(sentences.at(-1))) sentences[sentences.length - 1] += ` ${piece}`;
    else if (piece) sentences.push(piece);
  }
  const pieces = sentences.flatMap(sentence => {
    let clauses = [sentence];
    // Match the Mac order: sentences, semicolon/colon clauses, comma clauses,
    // then whole words. Long words split only between complete graphemes.
    for (const boundary of [/(?<=[;:])\p{White_Space}+/u, /(?<=,)\p{White_Space}+/u]) {
      clauses = clauses.flatMap(piece => graphemeCount(piece) > limit ? packChunks(piece.split(boundary), limit) : [piece]);
    }
    return clauses.flatMap(piece => graphemeCount(piece) > limit
      ? packChunks(piece.split(/\p{White_Space}+/u).flatMap(word => graphemeCount(word) > limit ? splitChunkUnits(word, limit) : [word]), limit)
      : [piece]);
  });
  return packChunks(pieces, limit);
}

export function sourceExcerpts(text, limit) {
  // Match the native sentence/clause boundaries, but keep the original spacing
  // inside each excerpt so every quote sent to the model exists in the paper.
  const source = text.trim();
  if (source.length <= limit || countCharacters(source, limit + 1) <= limit) return [source];
  const hardSplit = value => splitChunkUnits(value, limit).map(piece => piece.trim()).filter(Boolean);
  const pieces = [];
  let offset = 0;
  for (const chunk of chunkText(source, limit)) {
    const start = offset;
    for (const [word] of chunk.matchAll(/\P{White_Space}+/gu)) {
      const index = source.indexOf(word, offset);
      if (index < 0 || source.slice(offset, index).trim()) return hardSplit(source);
      offset = index + word.length;
    }
    const original = source.slice(start, offset).trim();
    if (original.length <= limit || countCharacters(original, limit + 1) <= limit) pieces.push(original);
    else pieces.push(...hardSplit(original));
  }
  return source.slice(offset).trim() ? hardSplit(source) : pieces;
}
