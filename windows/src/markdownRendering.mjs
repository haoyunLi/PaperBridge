import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeKatex from 'rehype-katex';
import { remarkTeXDelimiters } from './texDelimiters.mjs';
import { rehypeHTMLEquations } from './htmlEquations.mjs';

function remarkFigureCaptions() {
  function visit(node) {
    const image = node.type === 'paragraph' && node.children.length === 1 && node.children[0];
    if (image && (image.type === 'image' || image.type === 'imageReference') && image.alt) {
      node.data = { ...node.data, hName: 'figure' };
      node.children.push({ type: 'paragraph', data: { hName: 'figcaption' }, children: [{ type: 'text', value: image.alt }] });
      return;
    }
    node.children?.forEach(visit);
  }
  return visit;
}

export const markdownPlugins = [remarkGfm, remarkMath, remarkTeXDelimiters, remarkFigureCaptions];
const markdownSchema = {
  ...defaultSchema,
  tagNames: [...defaultSchema.tagNames, 'caption', 'colgroup', 'col', 'figure', 'figcaption'],
  attributes: { ...defaultSchema.attributes, code: [['className', /^language-./, 'math-inline', 'math-display']] },
  protocols: { ...defaultSchema.protocols, src: [...(defaultSchema.protocols?.src || []), 'data'] }
};
export const rehypePlugins = [rehypeRaw, [rehypeSanitize, markdownSchema], rehypeHTMLEquations, rehypeKatex];

const processor = unified().use(remarkParse).use(markdownPlugins)
  .use(remarkRehype, { allowDangerousHtml: true }).use(rehypePlugins);
const tableParents = new Set(['table', 'thead', 'tbody', 'tfoot', 'tr', 'colgroup']);
const generatedViews = new Map();

function collectText(node, parentTag, parts) {
  if (node.type === 'text') {
    // The JSX renderer drops whitespace-only children of table structural elements.
    if (!tableParents.has(parentTag) || /[^\t\n\r\f ]/.test(node.value)) parts.push(node.value);
    return;
  }
  if (node.properties?.className?.includes('katex-mathml') || node.properties?.dataSelectionIgnore != null) return;
  for (const child of node.children || []) collectText(child, node.tagName, parts);
}

// A regenerated draft may change formatting while keeping a visible quote.
// Keep only the latest projection for each of the three generated document views.
export function generatedViewText(scope, markdown) {
  const cached = generatedViews.get(scope);
  if (cached?.markdown === markdown) return cached.text;
  const text = renderedMarkdownText(markdown);
  generatedViews.set(scope, { markdown, text });
  return text;
}

export function parseMarkdown(markdown) {
  return processor.parse(markdown);
}

export function renderedMarkdownText(markdown) {
  const parts = [];
  collectText(processor.runSync(parseMarkdown(markdown), markdown), undefined, parts);
  return parts.join('');
}
