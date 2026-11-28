// The structure tree gives tagged PDFs a logical reading order separate from their paint order.
// PDF.js already resolves characters within a text run. Reorder whole runs only.
export async function taggedPdfText(page, content) {
  if (!content.items.some(item => item.dir === 'rtl')) return content;
  try {
    const tree = await page.getStructTree();
    if (!tree) return content;
    const tags = new Map();
    function collect(node, paragraph) {
      if (/^(?:P|H[1-6]?|LBody|Caption|TD|TH)$/.test(node.role)) paragraph = node;
      if (node.type === 'content' && paragraph) tags.set(node.id, { rank: tags.size, paragraph });
      for (const child of node.children || []) collect(child, paragraph);
    }
    collect(tree, null);
    if (!tags.size) return content;
    const marked = await page.getTextContent({ includeMarkedContent: true });
    const stack = [], ink = [];
    for (const item of marked.items) {
      if (item.type === 'beginMarkedContent' || item.type === 'beginMarkedContentProps') {
        stack.push(tags.get(item.id) || stack.at(-1));
      } else if (item.type === 'endMarkedContent') stack.pop();
      else if (item.str?.trim()) ink.push({ item, tag: stack.at(-1) });
    }
    let index = 0, taggedRtl = false;
    const items = [];
    for (const item of content.items) {
      if (!item.str?.trim()) { items.push(item); continue; }
      const match = ink[index++];
      if (match?.item.str !== item.str || !item.transform.every((v, i) => v === match.item.transform[i])) return content;
      if (match.tag && item.dir === 'rtl') taggedRtl = true;
      items.push(match.tag ? { ...item, pdfTag: match.tag } : item);
    }
    if (taggedRtl && index === ink.length) return { ...content, items };
  } catch { /* Optional accessibility tags can be missing or damaged in otherwise readable PDFs. */ }
  return content;
}

export function logicalTaggedLine(items) {
  if (!items.some(item => item.direction === 'rtl') || !items[0]?.pdfTag) return null;
  const paragraph = items[0].pdfTag.paragraph;
  const groups = [];
  for (const [i, item] of items.entries()) {
    if (item.pdfTag?.paragraph !== paragraph) return null;
    const rank = item.pdfTag.rank;
    if (groups.at(-1)?.rank === rank) groups.at(-1).last = i;
    else groups.push({ rank, first: i, last: i });
  }
  // Preserve geometric order when separate columns or interleaved tags share a baseline.
  const descending = groups.length > 1 && groups[0].rank > groups[1].rank;
  if (groups.some((group, i) => i > 0 && (descending ? group.rank >= groups[i - 1].rank : group.rank <= groups[i - 1].rank))) return null;
  if (descending) groups.reverse();
  const ordered = [];
  for (const [g, group] of groups.entries()) {
    const span = items.slice(group.first, group.last + 1);
    const rtl = span.some(item => item.direction === 'rtl');
    if (rtl && span.some(item => item.direction !== 'rtl' && /[\p{L}\p{N}]/u.test(item.text))) return null;
    for (let i = 0; i < span.length; i++) {
      const index = rtl ? group.last - i : group.first + i;
      // Each physical space belongs to a boundary. When direction changes, that
      // boundary can move to the opposite end of a word or a tagged phrase.
      const gap = i ? (rtl ? index + 1 : index) : g ? Math.max(group.first, groups[g - 1].first) : 0;
      ordered.push({ index, gap });
    }
  }
  return ordered;
}

export function unfoldArabicForms(text) {
  // Decode positional presentation glyphs without compatibility-folding units or mathematical symbols.
  return text.replace(/[\uFB50-\uFDFF\uFE70-\uFEFC]/gu, glyph => glyph.normalize('NFKC'));
}

