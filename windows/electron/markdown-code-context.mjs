// The parser distinguishes code from continued list items and ordinary HTML indentation.
const indent = /^(?: {4}| {0,3}\t)/m;
const markedContainer = /^ {0,3}(?:>|[-+*][ \t]|\d{1,9}[.)][ \t])[^\r\n]*(?:`{3,}|~{3,}| {4}|\t)/m;

export function fencedCodeMarkdown(text) {
  let length = 3;
  for (const [run] of text.matchAll(/`+/g)) length = Math.max(length, run.length + 1);
  const fence = '`'.repeat(length);
  return fence + '\n' + text + '\n' + fence;
}

// A missing closing delimiter in the extraction must not format the rest of a translated document.
export function structuredBlockSource(block) {
  const source = block.sourceMarkdown || block.text;
  return block.incompleteFormula && block.resource ? fencedCodeMarkdown(source) : source;
}

export function mayContainIndentedOrNestedCode(markdown) {
  return indent.test(markdown) || markedContainer.test(markdown);
}
