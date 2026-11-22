import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeKatex from 'rehype-katex';

export const markdownPlugins = [remarkGfm, remarkMath];
const markdownSchema = {
  ...defaultSchema,
  tagNames: [...defaultSchema.tagNames, 'caption', 'colgroup', 'col', 'figure', 'figcaption'],
  protocols: { ...defaultSchema.protocols, src: [...(defaultSchema.protocols?.src || []), 'data'] }
};
export const rehypePlugins = [rehypeRaw, [rehypeSanitize, markdownSchema], rehypeKatex];

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
  collectText(processor.runSync(parseMarkdown(markdown)), undefined, parts);
  return parts.join('');
}
