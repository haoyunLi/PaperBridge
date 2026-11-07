// Keep this list in step with TextProcessing.hyphenatedCompoundSuffixes on macOS.
export const compoundSuffixes = new Set([
  'aware', 'based', 'cell', 'class', 'dependent', 'defined', 'dimensional', 'domain', 'driven', 'free',
  'level', 'like', 'making', 'order', 'range', 'related', 'resolution', 'reviewed', 'scale', 'source',
  'space', 'specific', 'stage', 'step', 'supervised', 'term', 'time', 'to', 'trained', 'tuning',
  'validation', 'wise', 'known'
]);

const icuWord = /[\p{Alphabetic}\p{M}\p{Nd}\p{Pc}\u200c\u200d]/u;
const boundaryIgnored = /[\p{Grapheme_Extend}\p{Cf}]/u;

function characterBefore(text, index) {
  const last = text.charCodeAt(index - 1);
  const first = text.charCodeAt(index - 2);
  return text.slice(index - (last >= 0xdc00 && last <= 0xdfff && first >= 0xd800 && first <= 0xdbff ? 2 : 1), index);
}

// NSRegularExpression's default ICU boundary is Unicode-aware; JavaScript \b
// is not. ICU rejects a boundary before an extender/format character, and skips
// those characters while finding the preceding word/non-word character.
function hasIcuWordBoundary(text, index) {
  const current = index < text.length ? String.fromCodePoint(text.codePointAt(index)) : '';
  if (boundaryIgnored.test(current)) return false;
  let previous = '';
  for (let cursor = index; cursor > 0;) {
    previous = characterBefore(text, cursor);
    cursor -= previous.length;
    if (!boundaryIgnored.test(previous)) break;
    previous = '';
  }
  return icuWord.test(current) !== icuWord.test(previous);
}

// One pass, with matches taken from the original input, like the Mac helper.
// Callers decide how many normalization stages their import path requires.
export function repairSpacedHyphenation(text) {
  const candidate = /([A-Za-z]{1,30}(?:-[A-Za-z]{1,30})*)-\p{White_Space}+([a-z][A-Za-z]{1,30})/gu;
  const pieces = [];
  let cursor = 0;
  for (let match; (match = candidate.exec(text));) {
    const end = match.index + match[0].length;
    if (!hasIcuWordBoundary(text, match.index) || !hasIcuWordBoundary(text, end)) {
      // A rejected candidate may contain a later valid start after a hyphen.
      // Do not consume that alternative as String.replace would.
      candidate.lastIndex = match.index + 1;
      continue;
    }
    const [, left, right] = match;
    const keepHyphen = left.includes('-') || compoundSuffixes.has(right.toLowerCase());
    pieces.push(text.slice(cursor, match.index), left + (keepHyphen ? '-' : '') + right);
    cursor = end;
  }
  return pieces.length ? pieces.join('') + text.slice(cursor) : text;
}
