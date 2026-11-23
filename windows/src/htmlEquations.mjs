const closers = new Map([['$', '$'], ['$$', '$$'], ['\\(', '\\)'], ['\\[', '\\]']]);
const cellsAndCaptions = new Set(['td', 'th', 'caption', 'figcaption']);
const literalTags = new Set(['pre', 'code', 'script', 'style', 'textarea', 'math']);

function equationText(node) {
  const text = node.value;
  if (!/[$\\]/.test(text)) return [node];
  const parts = [];
  let opened = null, depth = 0, cursor = 0;
  function plain(end) {
    if (end <= cursor) return;
    const value = text.slice(cursor, end).replace(/(\\+)\$/g, (match, slashes) =>
      slashes.length % 2 ? slashes.slice(1) + '$' : match);
    parts.push({ type: 'text', value });
  }
  // Consume escaped delimiters together. A closing dollar inside a TeX group is literal.
  for (const match of text.matchAll(/\\[\\$()[\]{}]|\$\$?|\{|\}/g)) {
    const token = match[0], index = match.index, after = index + token.length;
    // An unmatched currency dollar must not consume the next explicit formula.
    if (opened?.close === '$' && !depth && closers.has(token) && token !== '$') opened = null;
    if (opened) {
      if (token === '{') depth++;
      if (token === '}') depth = Math.max(0, depth - 1);
      if (depth || token !== opened.close) continue;
      const expression = text.slice(opened.after, index);
      const currencyBoundary = token === '$' && (/\s$/.test(expression) || /\d/.test(text[after] || ''));
      if (expression.trim() && !currencyBoundary) {
        plain(opened.start);
        parts.push({ type: 'element', tagName: 'span',
          properties: { className: [opened.display ? 'math-display' : 'math-inline'] },
          children: [{ type: 'text', value: expression }] });
        cursor = after;
        opened = null;
        continue;
      }
      // A dollar preceded by a space may start the next amount or expression.
      opened = null;
    }
    const close = closers.get(token);
    if (close && (token !== '$' || (after < text.length && !/\s/.test(text[after])))) {
      opened = { start: index, after, close, display: token === '$$' || token === '\\[' };
      depth = 0;
    }
  }
  if (!parts.length && !text.includes('\\$')) return [node];
  plain(text.length);
  return parts;
}

// Raw HTML bypasses remark-math. Restore math nodes after sanitation so the same
// local KaTeX renderer handles both ordinary Markdown and academic HTML tables.
export function rehypeHTMLEquations() {
  return (tree, file) => {
    const source = String(file.value || '');
    function visit(node, active) {
      if (!node.children || literalTags.has(node.tagName)) return;
      if (!active && cellsAndCaptions.has(node.tagName)) {
        const start = node.position?.start.offset;
        const tag = Number.isInteger(start) && /^<([a-z]+)/i.exec(source.slice(start, start + 16));
        active = Boolean(tag && tag[1].toLowerCase() === node.tagName);
      }
      if (active) node.children = node.children.flatMap(child => child.type === 'text' ? equationText(child) : [child]);
      for (const child of node.children) {
        if (child.properties?.className?.some(name => ['math-display', 'math-inline', 'language-math'].includes(name))) continue;
        visit(child, active);
      }
    }
    visit(tree, false);
  };
}
