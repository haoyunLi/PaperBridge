import { joinPdfText } from './text.mjs';

// Keep the first occurrence of a running header; discard repeated headers and footers.
// Original PDF pages are never changed.
export function filterRepeatedPageDecorations(pages) {
  const signatures = new Map();
  const signature = text => text.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
  const position = (line, height) => line.y >= height * 0.82 ? 'header' : line.y + line.height <= height * 0.12 ? 'footer' : '';
  for (const [index, page] of pages.entries()) {
    const seen = new Set();
    for (const line of page.lines) {
      const where = position(line, page.height);
      if (!where || !line.text.trim() || line.text.length > 180) continue;
      const key = signature(line.text);
      if (seen.has(key)) continue;
      seen.add(key);
      const entry = signatures.get(key) || { pages: new Set(), header: new Set(), footer: new Set(), firstPage: index };
      entry.pages.add(index);
      entry[where].add(index);
      signatures.set(key, entry);
    }
  }
  return pages.map((page, index) => {
    // A lone printed folio can occur on a single page. An equation label or
    // table value sharing the last row with other text belongs to the paper.
    let bottomLine;
    let nextBaseline = Infinity;
    for (const line of page.lines) {
      if (!bottomLine || line.y < bottomLine.y) {
        nextBaseline = bottomLine?.y ?? Infinity;
        bottomLine = line;
      } else nextBaseline = Math.min(nextBaseline, line.y);
    }
    const lines = page.lines.filter(line => {
      const where = position(line, page.height);
      const text = line.text.trim();
      if (where === 'footer' && /^page\s+\p{Nd}{1,4}(?:\s+of\s+\p{Nd}{1,4})?$/iu.test(text)) return false;
      if (where === 'footer' && line === bottomLine && nextBaseline - line.y > line.height * 1.5 &&
          /^(?:\p{Nd}{1,4}|\(\p{Nd}{1,4}\))$/u.test(text)) return false;
      const entry = signatures.get(signature(line.text));
      if (!entry || entry.pages.size < 2 || (entry.header.size < 2 && entry.footer.size < 2)) return true;
      return where !== 'footer' && !(where === 'header' && index > entry.firstPage);
    });
    return { ...page, lines };
  });
}

export function stitchPageBlocks(blocks) {
  const result = [];
  for (const block of blocks) {
    const previous = result.at(-1);
    const left = previous?.text?.trim() || '';
    const right = block.text?.trim() || '';
    const adjacent = (previous?.endPage ?? previous?.page) === block.page - 1;
    const prose = previous && !previous.heading && !block.heading && !previous.resource && !block.resource &&
      !previous.sourceMarkdown && !block.sourceMarkdown &&
      !/^(?:figure|fig\.|table|references|bibliography|图|表)\b/i.test(left) &&
      !/^(?:(?:figure|table|references|bibliography)\b|fig\.\s*\d|[图表]\s*\d|\[\d+\]|\d+[.)]\s)/iu.test(right);
    const proseContinuation = /[\p{Ll}‐-]$/u.test(left) && /^[\p{Ll},;:)]/u.test(right);
    // Technical tokens can resume with a digit or capital at the top of the
    // next page. Keep isolated labels and two adjacent numeric entries separate.
    const technicalContinuation = /[\p{L}\p{N}][-‐]$/u.test(left)
      && /^[\p{Lu}\p{N}][\p{L}\p{N}-]*\s+\p{Ll}/u.test(right)
      && !(/\p{N}[-‐]$/u.test(left) && /^\p{N}/u.test(right));
    const listContinuation = /^[•‣◦]\s/u.test(right) && /(?:^|[:：]\s*)[•‣◦]\s/u.test(left)
      && /[,;，；](?:\s+(?:and|or))?$/iu.test(left);
    const continuation = proseContinuation || technicalContinuation || listContinuation;
    if (adjacent && prose && continuation && (left.length >= 20 || /[‐-]$/.test(left))) {
      previous.text = joinPdfText(left, right);
      previous.endPage = block.page;
    } else result.push({ ...block });
  }
  return result.map((block, index) => ({ ...block, id: index + 1 }));
}
