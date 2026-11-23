import { codes } from 'micromark-util-symbol';

// Tokenize before CommonMark consumes the backslashes as punctuation escapes.
// Code spans, code fences and link destinations keep their own parsing rules.
const lineEndings = new Set([codes.carriageReturn, codes.lineFeed, codes.carriageReturnLineFeed]);

function tokenizeEquation(effects, ok, nok) {
  let closing;
  return start;

  function start(code) {
    effects.enter('delimitedTeX');
    effects.enter('texDelimiter');
    effects.consume(code);
    return open;
  }
  function open(code) {
    if (code !== codes.leftParenthesis && code !== codes.leftSquareBracket) return nok(code);
    closing = code === codes.leftParenthesis ? codes.rightParenthesis : codes.rightSquareBracket;
    effects.consume(code);
    effects.exit('texDelimiter');
    return content;
  }
  function content(code) {
    if (code === null) return nok(code);
    if (code === codes.backslash) {
      effects.enter('texEscape');
      effects.consume(code);
      return escape;
    }
    if (lineEndings.has(code)) {
      effects.enter('lineEnding');
      effects.consume(code);
      effects.exit('lineEnding');
    } else {
      effects.consume(code);
    }
    return content;
  }
  function escape(code) {
    if (code === null || code === codes.leftParenthesis || code === codes.leftSquareBracket) return nok(code);
    if (lineEndings.has(code)) {
      effects.exit('texEscape');
      return content(code);
    }
    effects.consume(code);
    effects.exit('texEscape');
    if (code !== closing) return content;
    effects.exit('delimitedTeX');
    return ok;
  }
}

export function remarkTeXDelimiters() {
  const data = this.data();
  data.micromarkExtensions.push({ text: { [codes.backslash]: { name: 'delimitedTeX', tokenize: tokenizeEquation } } });
  data.fromMarkdownExtensions.push({
    enter: { delimitedTeX(token) {
      const source = this.sliceSerialize(token);
      const display = source.startsWith('\\[');
      const value = source.slice(2, -2).trim();
      this.enter({ type: 'inlineMath', value, data: { hName: 'code',
        hProperties: { className: ['language-math', display ? 'math-display' : 'math-inline'] },
        hChildren: [{ type: 'text', value }] } }, token);
    } },
    exit: { delimitedTeX(token) { this.exit(token); } }
  });
}
