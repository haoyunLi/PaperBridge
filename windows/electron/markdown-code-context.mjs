// The parser distinguishes code from continued list items and ordinary HTML indentation.
const indent = /^(?: {4}| {0,3}\t)/m;
const markedContainer = /^ {0,3}(?:>|[-+*][ \t]|\d{1,9}[.)][ \t])[^\r\n]*(?:`{3,}|~{3,}| {4}|\t)/m;

export function mayContainIndentedOrNestedCode(markdown) {
  return indent.test(markdown) || markedContainer.test(markdown);
}
