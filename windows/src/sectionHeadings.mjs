import { protectMarkdown, restoreMarkdown } from './prompts.mjs';

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const majorSectionHeadings = new Set([
  'abstract', 'introduction', 'background', 'related work', 'method', 'methods',
  'methodology', 'materials and methods', 'experimental setup', 'experiments',
  'evaluation', 'results', 'discussion', 'conclusion', 'conclusions', 'appendix',
  'acknowledgements', 'acknowledgments'
]);
const leadingSection = /^(\p{Decimal_Number}+(?:\.\p{Decimal_Number}+)*\p{White_Space}+)?(Abstract|Introduction|Background|Related Work|Methods?|Methodology|Materials and Methods|Experimental Setup|Experiments?|Evaluation|Results?|Discussion|Conclusions?|Appendix|Acknowledg(?:e)?ments)([.:])?\p{White_Space}+/iu;
// A hierarchical label may include a final period, as in "3.3. Network Architectures".
export const numberedSectionTitle = /^\p{Nd}+(?:(?:\.\p{Nd}+)+\.?)?\p{White_Space}+[A-Z]/u;
const firstLineBreak = /[\n\v\f\r\u0085\u2028\u2029]/u;
export const trimWhitespace = value => value.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, '');
export const countCharacters = (value, limit = Infinity) => {
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
  if (numberedSectionTitle.test(text)) return true;
  const words = text.split(/\p{White_Space}+/u).filter(Boolean);
  if (!words.length || words.length > 12) return false;
  const characters = [...graphemes.segment(text)].map(item => item.segment);
  const uppercaseLetters = characters.filter(character => /\p{Uppercase}/u.test(character)).length;
  const letters = characters.filter(character => /\p{L}/u.test(character)).length;
  const titleCaseWords = words.filter(word => /\p{Uppercase}/u.test(graphemes.segment(word)[Symbol.iterator]().next().value.segment)).length;
  return (letters > 0 ? uppercaseLetters / letters : 0) > 0.6 || titleCaseWords / words.length > 0.8;
}

// Clipboard text can join the next printed section to the preceding sentence.
export function splitJoinedSections(value) {
  const boundary = /(?<=[.!?。！？])[ \t]+(?=\p{Nd}+(?:\.\p{Nd}+)*[ \t]+\p{Lu})/gu;
  if (value.search(boundary) < 0) return [value];
  const { text, tokens } = protectMarkdown(value);
  const parts = [];
  let start = 0;
  function append(end) {
    const piece = text.slice(start, end);
    parts.push(restoreMarkdown(piece, tokens.filter(([marker]) => piece.includes(marker))));
  }
  for (const match of text.matchAll(boundary)) {
    const next = match.index + match[0].length;
    const heading = leadingSection.exec(text.slice(next));
    if (!heading?.[1] || !/^\p{Lu}/u.test(heading[2])) continue;
    if (/\b(?:figs?|eqs?|refs?|sec|no|vol|pp?|e\.g|i\.e|et al)\.$/i.test(text.slice(Math.max(0, match.index - 12), match.index))) continue;
    const body = text.slice(next + heading[0].length);
    if (body.length < 20 || !/^["'“‘(\[]*[\p{Lu}\p{Script=Han}]/u.test(body)) continue;
    append(match.index);
    start = next;
  }
  if (!parts.length) return [value];
  append(text.length);
  return parts;
}

export function detectedSectionTitle(value) {
  const first = formatLeadingSectionHeading(value).split(firstLineBreak).map(trimWhitespace).find(Boolean);
  return first && isLikelySectionHeading(first) ? first : null;
}
