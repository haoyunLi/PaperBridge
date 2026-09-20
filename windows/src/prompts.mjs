export const translationSystem = target => `You are an expert scientific translator. Preserve scientific meaning exactly. Preserve named entities, gene symbols, protein names, units, equations, citations, and reference markers. Keep the output natural, clear, and readable for academic readers. Return only the ${target} translation text.`;
export const translationPrompt = (text, source, target, terms = []) => `Translate the following academic text from ${source} into ${target}. Preserve scientific meaning, formulas, citation markers, and paragraph breaks. Return only the translation.\n${terms.length ? `Use these approved terms when appropriate:\n${terms.map(term => `${term.source} = ${term.target}`).join('\n')}\n` : ''}\n${text}`;
export const explainPrompt = (selection, context, language) => `Explain the selected academic text in ${language}. Use the surrounding paragraph for context. Be concise and accurate, and do not invent claims.\n\nSelected text:\n${selection}\n\nSurrounding paragraph:\n${context}`;
export const summaryPrompt = (blocks, language) => `Summarize the following academic paper in ${language}. Focus on the research question, methods, main findings, and limitations. Cite the source block IDs in square brackets after each claim. Use only the provided source; never invent details.\n\n${blocks.map(block => `[${block.id}] ${block.text}`).join('\n\n')}`;

export function protectMarkdown(markdown) {
  const tokens = [];
  const pattern = /!\[[^\]]*\]\([^)]+\)|\$\$[\s\S]*?\$\$|\$[^$\n]+\$|`[^`]+`|https?:\/\/\S+/g;
  const text = markdown.replace(pattern, match => {
    const token = `__PAPERBRIDGE_TOKEN_${tokens.length}__`;
    tokens.push([token, match]);
    return token;
  });
  return { text, tokens };
}

export function restoreMarkdown(translated, tokens) {
  let result = translated;
  for (const [token, original] of tokens) {
    if (!result.includes(token)) throw new Error('The model changed a protected formula, figure, or link. Retry this block.');
    result = result.replace(token, original);
  }
  return result;
}

export const markdownTranslationPrompt = (text, source, target, terms = []) => `Translate only natural-language content in this academic Markdown block from ${source} into ${target}. Preserve Markdown headings, tables, line prefixes and paragraph breaks. Copy every __PAPERBRIDGE_TOKEN_...__ token exactly in the same position. These tokens protect formulas, images, links, and code. Preserve scientific meaning and citation markers. Return only translated Markdown.\n${terms.length ? `Approved terms:\n${terms.map(term => `${term.source} = ${term.target}`).join('\n')}\n` : ''}\nMarkdown block:\n${text}`;
