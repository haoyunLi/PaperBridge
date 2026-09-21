export function readableHtml(text) {
  return text.replace(/<\/?[a-z][a-z0-9-]*(?:\s+[^<>]*?)?\s*\/?>/gi, '')
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp|#(?:x[0-9a-f]+|\d+));/gi, entity => {
      const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
      const value = entity.slice(1, -1).toLowerCase();
      if (!value.startsWith('#')) return named[value] ?? entity;
      const point = value.startsWith('#x') ? Number.parseInt(value.slice(2), 16) : Number.parseInt(value.slice(1), 10);
      return Number.isInteger(point) && point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : entity;
    });
}

export function anchorText(block, kind) {
  const value = kind === 'translation' ? block?.translation : block?.text;
  return (kind === 'translation' ? block?.translationMarkdown : block?.sourceMarkdown) ? readableHtml(value || '') : value || '';
}

function plainText(markdown) {
  return readableHtml(markdown
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '[Figure]')
    .replace(/\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\$[^$\n]+\$|\\\([^\n]*?\\\)/g, '[Formula]')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[#*_`]/g, '')).trim();
}

function segmentKind(lines, index) {
  const value = lines[index].trim();
  if (!value) return null;
  if (/^(?:```|~~~)/.test(value)) return 'code';
  if (/^(?:\$\$|\\\[)/.test(value)) return 'formula';
  if (/^<(?:table|figure|details|div|p|pre)\b/i.test(value)) return value.toLowerCase().startsWith('<table') ? 'table' : 'html';
  if (/^!\[[^\]]*\]\([^\n]+\)\s*$/.test(value)) return 'image';
  if (/^#{1,6}\s+/.test(value)) return 'heading';
  if (/^\|.+\|\s*$/.test(value) && /^\|?\s*[:\- ]+\|/.test(lines[index + 1]?.trim() || '')) return 'table';
  if (/^(?:[-+*]|\d+[.)])\s+/.test(value)) return 'list';
  if (/^>\s?/.test(value)) return 'quote';
  return null;
}

function closingLine(lines, start, token) {
  let index = start + 1;
  if (lines[start].trim().slice(token.length).includes(token)) return index;
  while (index < lines.length) {
    if (lines[index].includes(token)) return index + 1;
    index++;
  }
  return index;
}

export function parsedMarkdownBlocks(markdown) {
  const lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n');
  const segments = [];
  for (let index = 0; index < lines.length;) {
    if (!lines[index].trim()) { index++; continue; }
    const kind = segmentKind(lines, index) || 'paragraph';
    const start = index;
    const trimmed = lines[index].trim();
    if (kind === 'code') {
      index = closingLine(lines, index, trimmed.slice(0, 3));
    } else if (kind === 'formula') {
      index = closingLine(lines, index, trimmed.startsWith('$$') ? '$$' : '\\]');
    } else if (kind === 'table' && trimmed.startsWith('<table')) {
      index = closingLine(lines, index, '</table>');
    } else if (kind === 'html') {
      const tag = trimmed.match(/^<([a-z]+)/i)?.[1];
      index = tag ? closingLine(lines, index, `</${tag}>`) : index + 1;
    } else if (kind === 'table') {
      index += 2;
      while (index < lines.length && lines[index].trim() && lines[index].includes('|')) index++;
    } else if (kind === 'quote') {
      index++;
      while (index < lines.length && /^>\s?/.test(lines[index].trim())) index++;
    } else if (kind === 'paragraph') {
      index++;
      while (index < lines.length && lines[index].trim() && !segmentKind(lines, index)) index++;
    } else {
      index++;
    }
    const sourceMarkdown = lines.slice(start, index).join('\n').trim();
    if (sourceMarkdown) segments.push({ kind, sourceMarkdown });
  }
  return segments.map(({ kind, sourceMarkdown }, index) => ({
    id: index + 1,
    text: plainText(sourceMarkdown),
    sourceMarkdown,
    page: null,
    heading: kind === 'heading',
    resource: ['image', 'formula', 'table', 'code', 'html'].includes(kind),
    translation: '',
    status: 'pending',
    bookmark: false,
    highlights: [],
    notes: []
  }));
}
