import { referenceBlockIds } from './references.mjs';

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const majorSectionHeadings = new Set([
  'abstract', 'introduction', 'background', 'related work', 'method', 'methods',
  'methodology', 'materials and methods', 'experimental setup', 'experiments',
  'evaluation', 'results', 'discussion', 'conclusion', 'conclusions', 'appendix',
  'acknowledgements', 'acknowledgments'
]);
const leadingSection = /^(\p{Decimal_Number}+(?:\.\p{Decimal_Number}+)*\p{White_Space}+)?(Abstract|Introduction|Background|Related Work|Methods?|Methodology|Materials and Methods|Experimental Setup|Experiments?|Evaluation|Results?|Discussion|Conclusions?|Appendix|Acknowledg(?:e)?ments)([.:])?\p{White_Space}+/iu;
const firstLineBreak = /[\n\v\f\r\u0085\u2028\u2029]/u;
const trimWhitespace = value => value.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, '');
const countCharacters = (value, limit = Infinity) => {
  let count = 0;
  for (const segment of graphemes.segment(value)) {
    if (++count >= limit) break;
  }
  return count;
};

// Mac TextProcessing.formatLeadingSectionHeading is a display-only operation.
// In particular, detecting an inline title must not turn its whole body into a
// compact heading block or change the saved source.
function formatLeadingSectionHeading(value) {
  const text = trimWhitespace(value);
  if (text.includes('\n') || countCharacters(text, 30) < 30) return text;
  const match = leadingSection.exec(text);
  if (!match) return text;
  const heading = trimWhitespace(match[0]);
  const remainder = trimWhitespace(text.slice(match[0].length));
  if (countCharacters(remainder, 20) < 20) return text;
  const letters = [...match[2]].filter(character => /\p{L}/u.test(character));
  const uppercaseHeading = letters.length > 0 && letters.every(character => /\p{Uppercase}/u.test(character));
  if (!match[1] && !match[3] && !uppercaseHeading && !/^["'“‘(\[]*[A-Z]/u.test(remainder)) return text;
  return heading + '\n' + remainder;
}

function isLikelySectionHeading(value) {
  const text = trimWhitespace(value);
  if (!text || countCharacters(text, 121) > 120 || text.includes('@') || /[.!?]["')\]]?$/u.test(text)) return false;
  const normalized = text.replace(/^\p{Decimal_Number}+(?:\.\p{Decimal_Number}+)*\p{White_Space}+/u, '')
    .toLowerCase().replace(/^[\p{P}\p{White_Space}]+|[\p{P}\p{White_Space}]+$/gu, '');
  if (majorSectionHeadings.has(normalized)) return true;
  if (/^\p{Decimal_Number}+(?:\.\p{Decimal_Number}+)*\p{White_Space}+[A-Z].*$/u.test(text)) return true;
  const words = text.split(/\p{White_Space}+/u).filter(Boolean);
  if (!words.length || words.length > 12) return false;
  const characters = [...graphemes.segment(text)].map(item => item.segment);
  const uppercaseLetters = characters.filter(character => /\p{Uppercase}/u.test(character)).length;
  const letters = characters.filter(character => /\p{L}/u.test(character)).length;
  const titleCaseWords = words.filter(word => /\p{Uppercase}/u.test(graphemes.segment(word)[Symbol.iterator]().next().value.segment)).length;
  return (letters > 0 ? uppercaseLetters / letters : 0) > 0.6 || titleCaseWords / words.length > 0.8;
}

function detectedSectionTitle(value) {
  const first = formatLeadingSectionHeading(value).split(firstLineBreak).map(trimWhitespace).find(Boolean);
  return first && isLikelySectionHeading(first) ? first : null;
}

// Mirrors PaperReaderViewModel.documentSections. Windows keeps resource and
// reference blocks in its Reader, so omit them here without renumbering IDs.
export function documentOutline(paper) {
  const blocks = Array.isArray(paper?.blocks) ? paper.blocks : [];
  const references = referenceBlockIds(blocks);
  const readable = blocks.filter(block => Number.isInteger(block.id) && block.id > 0 &&
    !block.resource && !references.has(block.id) && typeof block.text === 'string' && trimWhitespace(block.text));
  if (paper?.sourceMode === 'mineru') {
    const headings = readable.filter(block => typeof block.sourceMarkdown === 'string' &&
      /^#{1,6}\p{White_Space}+[^\p{White_Space}]/u.test(trimWhitespace(block.sourceMarkdown)))
      .map(block => ({ id: block.id, title: block.text }));
    if (headings.length) return headings;
  }
  const detected = readable.flatMap(block => {
    const title = detectedSectionTitle(block.text);
    return title ? [{ id: block.id, title }] : [];
  });
  if (detected.length) return detected;
  return readable.length ? [{ id: readable[0].id, title: 'Beginning' }] : [];
}
