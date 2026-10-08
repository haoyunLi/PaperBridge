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
  return pages.map((page, index) => ({ ...page, lines: page.lines.filter(line => {
    const entry = signatures.get(signature(line.text));
    if (!entry || entry.pages.size < 2 || (entry.header.size < 2 && entry.footer.size < 2)) return true;
    const where = position(line, page.height);
    return where !== 'footer' && !(where === 'header' && index > entry.firstPage);
  }) }));
}

export function stitchPageBlocks(blocks) {
  const result = [];
  for (const block of blocks) {
    const previous = result.at(-1);
    const left = previous?.text?.trim() || '';
    const right = block.text?.trim() || '';
    const adjacent = previous?.endPage === block.page - 1 || previous?.page === block.page - 1;
    const prose = previous && !previous.heading && !block.heading && !previous.resource && !block.resource &&
      !/^(?:figure|fig\.|table|references|bibliography|图|表)\b/i.test(left) &&
      !/^(?:figure|fig\.|table|references|bibliography|图|表|\[\d+\])\b/i.test(right);
    const continuation = !/[.!?。！？:;]$/.test(left) && /[a-z-]$/.test(left) && /^[a-z,;:)]/.test(right);
    if (adjacent && prose && continuation && (left.length >= 20 || left.endsWith('-'))) {
      const hyphen = /[A-Za-z]{4,}-$/.test(left);
      previous.text = `${hyphen ? left.slice(0, -1) : left + ' '}${right}`;
      previous.endPage = block.page;
    } else result.push({ ...block });
  }
  return result.map((block, index) => ({ ...block, id: index + 1 }));
}
