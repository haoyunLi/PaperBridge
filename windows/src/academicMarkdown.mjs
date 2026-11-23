import { parseFragment } from 'parse5';
import { mayContainIndentedOrNestedCode } from '../electron/markdown-code-context.mjs';
import { parseMarkdown, renderedMarkdownText } from './markdownRendering.mjs';
import { protectMarkdown } from './prompts.mjs';
import { referenceBlockIds, referenceCoverageVersion } from './references.mjs';
import { commonOutputLanguage, normalizeOutputLanguage } from './outputLanguages.mjs';

export function usesSharedMarkdown(paper) {
  return paper?.sourceMode === 'mineru' && paper.blocks.some(block => block.sourceMarkdown);
}

export function protectStructuredMarkdown(markdown, { boundLinks = true } = {}) {
  if (!mayContainIndentedOrNestedCode(markdown) && !markdown.includes('](') && !/[`<@]|~{3}|\]:|https?:\/\/|\bwww\./i.test(markdown)) return protectMarkdown(markdown);
  const ranges = [];
  const boundedLinks = new Map();
  let standaloneLabel = false;
  function visit(node) {
    // The Markdown parser knows where longer code delimiters and nested image destinations end.
    const tag = node.type === 'html' && /^<\/?[a-z][a-z0-9:-]*(?:\s+(?:[^<>"']|"[^"]*"|'[^']*')*)?\/?>$/i.test(node.value);
    if (['code', 'inlineCode', 'image', 'definition'].includes(node.type) || tag) {
      ranges.push([node.position.start.offset, node.position.end.offset]);
      return;
    }
    if (node.type === 'link') {
      const start = node.position.start.offset;
      const end = node.position.end.offset;
      // Autolink labels are the address itself. GFM supplies the exact boundary,
      // including balanced parentheses and excluding the following punctuation.
      if (markdown[start] !== '[') {
        ranges.push([start, end]);
        if (boundLinks && markdown[start] !== '<') {
          const literal = markdown.slice(start, end);
          // Translated punctuation can touch either end of a formerly bare address.
          // Bound it in Markdown so the Reader and exported documents keep its target.
          const label = literal.replace(/[\\[\]`*_~$<>&|]/g, '\\$&');
          const target = node.url.replace(/[\\<>&|]/g, '\\$&');
          boundedLinks.set(literal, literal === node.url && !/[\s<>]/.test(literal)
            ? '<' + literal + '>' : '[' + label + '](<' + target + '>)');
        }
        return;
      }
      const labelEnd = node.children.at(-1)?.position.end.offset ?? start + 1;
      if (markdown.startsWith('](', labelEnd)) {
        // Translate the label while preserving the punctuation that makes it a link.
        const label = markdown.slice(start + 1, labelEnd);
        // A visible address can point at a tracking URL or mailto target. Keep
        // both halves of that link; ordinary labels still go to the translator.
        const address = /^(?:https?:\/\/|www\.)\S+$|^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(label)
          && node.children.length === 1 && node.children[0].type === 'text';
        if (!label || address) ranges.push([start, end]);
        else {
          ranges.push([start, start + 1], [labelEnd, end]);
          standaloneLabel = node.children.length === 1 && node.children[0].type === 'text'
            && node.children[0].value === markdown.slice(start + 1, labelEnd)
            && !/[\p{L}\p{N}]/u.test(markdown.slice(0, start) + markdown.slice(end));
        }
      }
    }
    node.children?.forEach(visit);
  }
  visit(parseMarkdown(markdown));
  ranges.sort((left, right) => left[0] - right[0]);
  const payload = protectMarkdown(markdown, ranges);
  const tokens = boundedLinks.size ? payload.tokens.map(([marker, original]) => [marker, boundedLinks.get(original) ?? original]) : payload.tokens;
  return { ...payload, tokens, standaloneLabel: standaloneLabel && ranges.length === 2 && tokens.length === 2 };
}

export function completedBlockTranslation(block, references) {
  return !block.resource && !references.has(block.id) && block.status === 'ok'
    ? block.translationMarkdown || block.translation || '' : '';
}

function sharedMarkdownText(blocks, references) {
  return blocks.map(block => completedBlockTranslation(block, references) || block.sourceMarkdown || block.text).join('\n\n');
}

// Older structured records may contain a plain translation without its Markdown.
function restoreBlockStructure(block) {
  if (block.status !== 'ok' || typeof block.translation !== 'string' || block.translationMarkdown || !block.sourceMarkdown) return block;
  const kind = markdownBlockKind(block);
  const text = block.translation.trim();
  if (!text) return block;
  let markdown;
  if (kind === 'heading') {
    const prefix = block.sourceMarkdown.trimStart().match(/^#{1,6}\s+/u)?.[0];
    if (!prefix) return block;
    markdown = prefix + text.replace(/^#{1,6}[ \t]+/, '');
  } else if (kind === 'list') {
    const prefix = block.sourceMarkdown.match(/^\s*(?:[-+*]|\d+[.)])\s+/u)?.[0];
    if (!prefix) return block;
    markdown = text.startsWith(prefix.trimStart()) ? prefix + text.slice(prefix.trimStart().length) : prefix + text;
  } else if (kind === 'quote') {
    markdown = text.split(/\r?\n/).map(line => /^>[ \t]?/.test(line) ? line : '> ' + line).join('\n');
  } else return block;
  return { ...block, translationMarkdown: markdown };
}

export function restoreStructuredTranslations(paper) {
  if (!Array.isArray(paper?.blocks) || !usesSharedMarkdown(paper) || !paper.blocks.some(b => b.status === 'ok' && b.translation && !b.translationMarkdown)) return paper;
  const references = referenceBlockIds(paper.blocks);
  const blocks = paper.blocks.map(block => block.resource || references.has(block.id) ? block : restoreBlockStructure(block));
  if (!blocks.some((block, index) => block !== paper.blocks[index])) return paper;

  // A saved draft may belong to a different language or have been edited. Only
  // reconstruct it when its entire content matches this Reader's former output.
  const refresh = paper.connectedShared && !paper.connectedStale && !paper.connectedLanguageConflict
    && paper.connectedTranslation === sharedMarkdownText(paper.blocks, references);
  return { ...paper, blocks, ...(refresh && { connectedTranslation: sharedMarkdownText(blocks, references) }) };
}

export function withSharedMarkdownTranslation(paper) {
  paper = restoreStructuredTranslations(paper);
  const references = referenceBlockIds(paper.blocks);
  const markdown = sharedMarkdownText(paper.blocks, references);
  const translated = paper.blocks.filter(block => completedBlockTranslation(block, references));
  const connectedLanguage = translated.length ? commonOutputLanguage(translated.map(block => block.translationLanguage))
    : normalizeOutputLanguage(paper.taskSettings);
  return { ...paper, connectedTranslation: markdown, connectedLanguage, connectedLanguageConflict: false,
    connectedBlocks: [], connectedBatchVersion: null, connectedShared: true, connectedStale: false, connectedReferenceCoverageVersion: referenceCoverageVersion };
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

// Only leaf text and inline code can contribute literal Markdown punctuation.
function markdownLiteralRanges(markdown) {
  const ranges = [];
  function visit(node) {
    if (node.type === 'inlineCode') {
      ranges.push({ start: node.position.start.offset, end: node.position.end.offset, value: node.value });
    } else if (node.type === 'text') {
      const start = node.position.start.offset;
      const raw = markdown.slice(start, node.position.end.offset);
      // MinerU sometimes splits bold author names across numbered affiliation tags.
      const splitAuthorStyle = /^,\s*\d+\*\*,\s+.+\*\*$/u.test(raw)
        && markdown.slice(Math.max(0, start - 6), start).toLowerCase() === '</sup>'
        && markdown.slice(node.position.end.offset, node.position.end.offset + 5).toLowerCase() === '<sup>';
      for (const match of raw.matchAll(/&#(?:x[\da-f]+|\d+);|\\([\\#*_`])|\*+|_+|[#`]/gi)) {
        const [token, escaped] = match;
        if (splitAuthorStyle && token === '**') continue;
        ranges.push({ start: start + match.index, end: start + match.index + token.length, value: escaped ?? (token.startsWith('&#') ? readableHtml(token) : token) });
      }
    } else {
      for (const child of node.children || []) visit(child);
    }
  }
  visit(parseMarkdown(markdown));
  return ranges;
}

function proseText(markdown, legacyText) {
  if (!/[#*_`]/.test(markdown)) return legacyText;
  const literals = markdownLiteralRanges(markdown);
  if (!literals.length) return legacyText;
  // Keep literal code out of the formula, link and HTML substitutions as well.
  let prefix = '\uE000';
  const decoded = readableHtml(markdown);
  while (decoded.includes(prefix)) prefix += '\uE000';
  const pieces = [];
  let end = 0;
  for (const [index, literal] of literals.entries()) {
    pieces.push(markdown.slice(end, literal.start), prefix + index + '\uE001');
    end = literal.end;
  }
  pieces.push(markdown.slice(end));
  const pattern = new RegExp(prefix + '(\\d+)\uE001', 'g');
  return plainText(pieces.join('')).replace(pattern, (_, index) => literals[Number(index)].value);
}

const sourceTextCache = new WeakMap();

export function analysisSourceText(block) {
  if (!block) return '';
  const { sourceMarkdown, text } = block;
  if (!sourceMarkdown || block.resource) return text || '';
  const heading = markdownHeadingText(block);
  if (heading !== null) return heading;
  const cached = sourceTextCache.get(block);
  if (cached?.markdown === sourceMarkdown && cached.text === text) return cached.result;
  // Only reconstruct text that is demonstrably the output of the old importer.
  // A user-edited paragraph remains authoritative even with older Markdown attached.
  const result = text === plainText(sourceMarkdown) ? proseText(sourceMarkdown, text) : text;
  sourceTextCache.set(block, { markdown: sourceMarkdown, text, result });
  return result;
}

function segmentKind(lines, index) {
  const value = lines[index].trim();
  if (!value) return null;
  if (/^(?:```|~~~)/.test(value)) return 'code';
  if (/^(?:\$\$|\\\[)/.test(value)) return 'formula';
  if (/^<(?:table|figure|details|div|p|pre)\b/i.test(value)) return value.toLowerCase().startsWith('<table') ? 'table' : 'html';
  if (/^!\[[^\]]*\]\([^\n]+\)\s*$/.test(value) || /^<img(?=[\s/>])/i.test(value) && !value.replace(htmlImage, '').trim()) return 'image';
  if (/^#{1,6}\s+/.test(value)) return 'heading';
  if (value.includes('|')) {
    const delimiter = lines[index + 1]?.trim();
    if (delimiter && /^[:|\s-]+$/.test(delimiter)
      && parseMarkdown(value + '\n' + delimiter).children[0]?.type === 'table') return 'table';
  }
  if (/^(?:[-+*]|\d+[.)])\s+/.test(value)) return 'list';
  if (/^>\s?/.test(value)) return 'quote';
  return null;
}

function afterClosingLine(lines, index, closes) {
  while (index < lines.length) {
    if (closes(lines[index++])) break;
  }
  return index;
}

function takeHtmlResource(lines, start, tag) {
  const close = new RegExp('</' + tag + '\\s*>', 'i');
  let end = afterClosingLine(lines, start, line => close.test(line));
  // Start near the first apparent closing tag. Nested elements, quoted attributes and
  // comments can require more input before the browser would actually close the root.
  for (;;) {
    const source = lines.slice(start, end).join('\n');
    const element = parseFragment(source, { sourceCodeLocationInfo: true }).childNodes.find(node => node.tagName === tag);
    const location = element?.sourceCodeLocation;
    const boundary = location?.endTag || (location?.endOffset < source.length ? location : null);
    if (boundary) {
      const last = start + boundary.endLine - 1;
      const tail = lines[last].slice(boundary.endCol - 1);
      const hasTail = Boolean(tail.trim());
      if (hasTail) lines[last] = tail;
      return { sourceMarkdown: source.slice(0, boundary.endOffset).trim(), next: hasTail ? last : last + 1, closed: true };
    }
    if (end === lines.length) {
      // A malformed HTML block should not absorb the rest of the article after a paragraph break.
      let next = start + 1;
      while (next < end && lines[next].trim()) next++;
      return { sourceMarkdown: lines.slice(start, next).join('\n').trim(), next, closed: false };
    }
    end = Math.min(lines.length, start + 2 * (end - start));
  }
}

function containerCodeBlocks(source) {
  const blocks = new Map();
  if (!mayContainIndentedOrNestedCode(source)) return blocks;
  // Only line boundaries are needed here. Large embedded figures do not affect block structure.
  const outline = source.replace(/(data:image\/[\w.+-]+;base64,)[A-Za-z0-9+/=]{512,}/gi, '$1AA==');
  const containsCode = node => node.type === 'code' || Boolean(node.children?.some(containsCode));
  const onlyCode = node => node.type === 'code' || ['list', 'listItem', 'blockquote'].includes(node.type) && node.children.every(onlyCode);
  for (const node of parseMarkdown(outline).children) {
    if (node.type === 'code' || (node.type === 'list' || node.type === 'blockquote') && containsCode(node)) {
      const kind = onlyCode(node) ? 'code' : node.type === 'blockquote' ? 'quote' : 'list';
      blocks.set(node.position.start.line - 1, { end: node.position.end.line, kind });
    }
  }
  return blocks;
}

function parsedMarkdownSegments(markdown) {
  const source = String(markdown || '').replace(/\r\n?/g, '\n');
  const lines = source.split('\n');
  const codeBlocks = containerCodeBlocks(source);
  const segments = [];
  for (let index = 0; index < lines.length;) {
    if (!lines[index].trim()) { index++; continue; }
    const container = codeBlocks.get(index);
    if (container) {
      segments.push({ kind: container.kind, sourceMarkdown: lines.slice(index, container.end).join('\n') });
      index = container.end;
      continue;
    }
    const kind = segmentKind(lines, index) || 'paragraph';
    const start = index;
    const trimmed = lines[index].trim();
    if (kind === 'code') {
      const fence = trimmed.match(/^(`{3,}|~{3,})/)[0];
      const endFence = new RegExp('^' + fence[0] + '{' + fence.length + ',}$');
      index = afterClosingLine(lines, index + 1, line => endFence.test(line.trim()));
    } else if (kind === 'formula') {
      const endFormula = trimmed.startsWith('$$') ? '$$' : '\\]';
      index = trimmed.slice(2).includes(endFormula) ? index + 1
        : afterClosingLine(lines, index + 1, line => line.includes(endFormula));
    } else if (kind === 'html' || (kind === 'table' && /^<table\b/i.test(trimmed))) {
      const tag = trimmed.match(/^<([a-z]+)/i)[1].toLowerCase();
      const { sourceMarkdown, next, closed } = takeHtmlResource(lines, start, tag);
      segments.push({ kind, sourceMarkdown, closed });
      index = next;
      continue;
    } else if (kind === 'table') {
      index += 2;
      while (index < lines.length && lines[index].trim() && lines[index].includes('|')) index++;
    } else if (kind === 'list') {
      index++;
      while (index < lines.length && /^\s+\S/.test(lines[index]) && !segmentKind(lines, index)) index++;
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

// Earlier MinerU imports removed literal #, * and _ from the saved display text.
const headingTextCache = new WeakMap();

export function markdownHeadingText(block) {
  const source = block.sourceMarkdown;
  if (typeof source !== 'string' || !/^#{1,6}[ \t]+\S[^\r\n]*$/u.test(source.trim())) return null;
  const cached = headingTextCache.get(block);
  if (cached?.source === source) return cached.title;
  const title = renderedMarkdownText(source.trim()).trim() || block.text || plainText(source);
  headingTextCache.set(block, { source, title });
  return title;
}

export function parsedMarkdownBlocks(markdown) {
  return parsedMarkdownSegments(markdown).map(({ kind, sourceMarkdown }, index) => {
    const block = {
      id: index + 1, text: plainText(sourceMarkdown), sourceMarkdown, markdownKind: kind,
      page: null, heading: kind === 'heading', resource: ['image', 'formula', 'table', 'code', 'html'].includes(kind),
      translation: '', status: 'pending', bookmark: false, highlights: [], notes: []
    };
    if (block.heading) block.text = markdownHeadingText(block) ?? block.text;
    else if (!block.resource) block.text = proseText(sourceMarkdown, block.text);
    return block;
  });
}

// Old workspaces lack markdownKind. Recognize only a complete, unchanged
// Markdown block: a list/quote prefix must not hide prose appended after it.
// Reading this metadata never migrates or rewrites the saved block.
export function markdownBlockKind(block) {
  if (typeof block?.sourceMarkdown !== 'string' || !block.sourceMarkdown.trim()) return null;
  const raw = block.sourceMarkdown.replace(/\r\n?/g, '\n');
  const containers = mayContainIndentedOrNestedCode(raw) ? parsedMarkdownSegments(raw) : null;
  const source = containers ? raw : raw.trim();
  const kind = containers?.[0]?.kind || segmentKind(source.split('\n'), 0) || 'paragraph';
  if (kind === 'paragraph') return kind;
  if (block.markdownKind != null && block.markdownKind !== kind) return null;
  const segments = containers ?? parsedMarkdownSegments(source);
  if (segments.length !== 1) return null;
  const legacyText = plainText(segments[0].sourceMarkdown);
  if (block.text !== legacyText && block.text !== (markdownHeadingText(block) ?? proseText(source, legacyText))) return null;
  return segments[0].kind;
}

export function savedResourceLayoutIssue(block) {
  const source = block.sourceMarkdown;
  if (!source) return '';
  if ((!block.markdownKind || block.markdownKind === 'paragraph') && !block.resource && source.includes('|')
    && /\n[ \t|:]*-{3}/.test(source) && parsedMarkdownSegments(source).some(segment => segment.kind === 'table')) {
    return 'This saved paragraph contains a Markdown table. Choose the original PDF to extract the table in a new copy.';
  }
  if (block.resource && (!block.markdownKind || block.markdownKind === 'table' || block.markdownKind === 'html')
    && /^<(?:table|figure|details|div|p|pre)\b/i.test(source) && /<\/[a-z]+\s*>/i.test(source)) {
    const segments = parsedMarkdownSegments(source);
    if (segments[0]?.closed === false) {
      return 'This saved HTML panel ends before its outer closing tag. Choose the original PDF to restore the complete panel in a new copy.';
    }
    if (segments.some(segment => segment.kind === 'paragraph' || segment.kind === 'heading')) {
      return 'This saved resource includes text after its closing tag. Choose the original PDF to recover the following paragraphs in a new copy.';
    }
  }
  return '';
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
