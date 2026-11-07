import { referenceBlockIds } from './references.mjs';
import { commonOutputLanguage, normalizeOutputLanguage } from './outputLanguages.mjs';

export function usesSharedMarkdown(paper) {
  return paper?.sourceMode === 'mineru' && paper.blocks.some(block => block.sourceMarkdown);
}

export function completedBlockTranslation(block, references) {
  return !block.resource && !references.has(block.id) && block.status === 'ok'
    ? block.translationMarkdown || block.translation || '' : '';
}

export function withSharedMarkdownTranslation(paper) {
  const references = referenceBlockIds(paper.blocks);
  const markdown = paper.blocks.map(block => completedBlockTranslation(block, references) || block.sourceMarkdown || block.text).join('\n\n');
  const translated = paper.blocks.filter(block => completedBlockTranslation(block, references));
  const connectedLanguage = translated.length ? commonOutputLanguage(translated.map(block => block.translationLanguage))
    : normalizeOutputLanguage(paper.taskSettings);
  return { ...paper, connectedTranslation: markdown, connectedLanguage, connectedLanguageConflict: false,
    connectedBlocks: [], connectedBatchVersion: null, connectedShared: true, connectedStale: false };
}

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

const htmlImage = /<img(?=[\s/>])(?:[^"'>]|"[^"]*"|'[^']*')*>/gi;

function plainText(markdown) {
  return readableHtml(markdown
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '[Figure]')
    .replace(htmlImage, '[Figure]')
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
  if (/^!\[[^\]]*\]\([^\n]+\)\s*$/.test(value) || /^<img(?=[\s/>])/i.test(value) && !value.replace(htmlImage, '').trim()) return 'image';
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

function parsedMarkdownSegments(markdown) {
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
  return segments;
}

export function parsedMarkdownBlocks(markdown) {
  return parsedMarkdownSegments(markdown).map(({ kind, sourceMarkdown }, index) => ({
    id: index + 1,
    text: plainText(sourceMarkdown),
    sourceMarkdown,
    markdownKind: kind,
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

// Old workspaces lack markdownKind. Recognize only a complete, unchanged
// Markdown block: a list/quote prefix must not hide prose appended after it.
// Reading this metadata never migrates or rewrites the saved block.
export function markdownBlockKind(block) {
  if (typeof block?.sourceMarkdown !== 'string' || !block.sourceMarkdown.trim()) return null;
  const source = block.sourceMarkdown.replace(/\r\n?/g, '\n').trim();
  const kind = segmentKind(source.split('\n'), 0) || 'paragraph';
  if (kind === 'paragraph') return kind;
  if (block.markdownKind != null && block.markdownKind !== kind) return null;
  const segments = parsedMarkdownSegments(source);
  if (segments.length !== 1 || plainText(segments[0].sourceMarkdown) !== block.text) return null;
  return segments[0].kind;
}

export function readableMineruBlocks(markdown) {
  const blocks = parsedMarkdownBlocks(markdown);
  const references = referenceBlockIds(blocks);
  if (!blocks.some(block => !block.resource && !references.has(block.id) && block.text.trim())) {
    throw new Error('MinerU returned no readable blocks.');
  }
  return blocks;
}

function pageText(text) {
  return plainText(text || '').normalize('NFKC').replace(/[\s\u00ad]+/g, '');
}

export const mineruPageMapVersion = 1;

function pageMatcher(hints) {
  const exact = new Map();
  const byPage = new Map();
  for (const { page, text } of hints) {
    if (!Number.isSafeInteger(page) || page < 1) continue;
    const key = pageText(text);
    if (!key) continue;
    exact.set(key, exact.has(key) && exact.get(key) !== page ? null : page);
    if (!byPage.has(page)) byPage.set(page, []);
    byPage.get(page).push(key);
  }
  const pages = [...byPage].map(([page, pieces]) => [page, pieces.join('')]);
  return (key, allowShort) => {
    if (!key || (!allowShort && key.length < 32)) return undefined;
    if (exact.has(key)) return exact.get(key);
    if (key.length < 32) return undefined;
    let found;
    for (const [page, text] of pages) {
      if (!text.includes(key)) continue;
      if (found !== undefined) return null;
      found = page;
    }
    return found;
  };
}

export function locateMineruPages(blocks, pageHints = [], pdfBlocks = [], pageCount = 0) {
  if (!blocks?.some(block => !block.page && !block.resource)) return blocks;
  const validPage = ({ page }) => !pageCount || page <= pageCount;
  const structured = pageMatcher(pageHints.filter(validPage));
  const selectable = pageMatcher(pdfBlocks.filter(block => (!block.endPage || block.endPage === block.page) && validPage(block)));
  let changed = false;
  const located = blocks.map(block => {
    if (block.page || block.resource) return block;
    const key = pageText(block.sourceMarkdown || block.text);
    const known = structured(key, true);
    const page = known === undefined ? selectable(key, false) : known;
    if (!page) return block;
    changed = true;
    return { ...block, page };
  });
  return changed ? located : blocks;
}
