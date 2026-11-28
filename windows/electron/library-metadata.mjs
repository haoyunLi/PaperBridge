const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

// Foundation's whitespacesAndNewlines includes zero-width space but retains BOM.
export function trimLibraryText(value) {
  return value.replace(/^[\p{White_Space}\u200B]+|[\p{White_Space}\u200B]+$/gu, '');
}

export function characterPrefix(text, limit) {
  if (text.length <= limit) return text;
  for (const { index } of graphemes.segment(text)) {
    if (limit-- === 0) return text.slice(0, index);
  }
  return text;
}

function compareScalarOrder(left, right) {
  let index = 0;
  while (index < left.length && index < right.length) {
    const a = left.codePointAt(index), b = right.codePointAt(index);
    if (a !== b) return a - b;
    index += a > 0xFFFF ? 2 : 1;
  }
  return left.length - right.length;
}

export function libraryLabel(title, tags) {
  const firstSpellings = new Map();
  for (const raw of tags.split(',')) {
    const tag = characterPrefix(trimLibraryText(raw), 40);
    const key = tag.normalize('NFC');
    if (key && !firstSpellings.has(key)) firstSpellings.set(key, tag);
  }
  const keys = [...firstSpellings.keys()].sort(compareScalarOrder).slice(0, 20);
  return { libraryTitle: characterPrefix(trimLibraryText(title), 200), tags: keys.map(key => firstSpellings.get(key)) };
}
