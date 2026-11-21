import { caseFold, lookupFolding } from 'unicode-case-folding';
import { trimWhitespace } from './sectionHeadings.mjs';

const turkic = /^(tr|az)(-|$)/i.test(Intl.DateTimeFormat().resolvedOptions().locale);
const ascii = /^[\x00-\x7f]*$/;
const marksOnly = /^\p{M}+$/u;

function canonical(value) {
  const text = (value ?? '').normalize('NFC');
  return turkic ? text.replace(/I/g, 'ı').replace(/İ/g, 'i') : text;
}

export function searchKey(value) {
  const text = canonical(value);
  return ascii.test(text) ? text.toLowerCase() : caseFold(text);
}

// A match can span a whole ligature or sharp S, but cannot start or end
// halfway through the characters produced by its Unicode case fold.
export function searchableText(raw = '') {
  const source = canonical(raw);
  let key = '';
  const inside = new Set();
  if (ascii.test(source)) {
    key = source.toLowerCase();
  } else {
    for (const character of source) {
      const mapping = lookupFolding(character.codePointAt(0));
      if (!mapping) key += character;
      else {
        for (const [index, point] of mapping.entries()) {
          if (index) inside.add(key.length);
          key += String.fromCodePoint(point);
        }
      }
    }
  }
  return {
    includes(needle) {
      if (!needle) return true;
      if (marksOnly.test(needle)) return (raw ?? '').includes(needle);
      for (let at = key.indexOf(needle); at >= 0; at = key.indexOf(needle, at + 1)) {
        if (!inside.has(at) && !inside.has(at + needle.length)) return true;
      }
      return false;
    }
  };
}

export function filteredReaderBlocks(blocks, query) {
  const needle = searchKey(trimWhitespace(query));
  if (!needle) return blocks;
  return blocks.filter(block => searchableText(block.text).includes(needle)
    || (block.translation && searchableText(block.translation).includes(needle)));
}
