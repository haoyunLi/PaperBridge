// CommonMark supplies source offsets so changing a destination preserves the author's layout.
const { parse, preprocess, postprocess } = require('micromark');
const { normalizeIdentifier } = require('micromark-util-normalize-identifier');
const { decodeString } = require('micromark-util-decode-string');

function rewriteStructuredAssets(markdown, replace, includeLinks, rewriteHtml) {
  const events = postprocess(parse().document().write(preprocess()(markdown, undefined, true)));
  const definitions = new Map();
  const uses = new Map();
  const stack = [];
  const edits = [];

  function change(start, end, text) {
    if (text !== markdown.slice(start, end)) edits.push({ start, end, text });
  }
  function updateDestination(token, kind) {
    const start = token.start.offset;
    const end = token.end.offset;
    const url = decodeString(markdown.slice(start, end));
    const updated = replace(url, kind);
    if (updated !== url) change(start, end, updated);
  }

  let literalStart = 0;
  let literalEnd = 0;
  for (const [event, token, context] of events) {
    if (token.start.offset >= literalStart && token.start.offset < literalEnd) continue;
    const type = token.type;
    if (type === 'image' || type === 'link' || type === 'definition') {
      if (event === 'enter') {
        stack.push({ type, end: token.end.offset });
      } else {
        const item = stack.pop();
        if (type === 'definition') {
          if (!definitions.has(item.id)) definitions.set(item.id, item);
        } else if (item.inline) {
          if (item.destination && (includeLinks || type === 'image')) updateDestination(item.destination, type);
        } else {
          const id = item.reference || item.id;
          if (!uses.has(id)) uses.set(id, []);
          uses.get(id).push(item);
        }
      }
      continue;
    }
    if (event !== 'enter') continue;
    if (type === 'htmlFlow' || type === 'htmlText') {
      const raw = markdown.slice(token.start.offset, token.end.offset);
      // Inline HTML code can span several CommonMark tokens.
      const literal = type === 'htmlText' && /^<(pre|code|script|style)(?=[\s>])/i.exec(raw);
      if (literal) {
        const close = new RegExp('</' + literal[1] + '\\s*>', 'ig');
        close.lastIndex = token.end.offset;
        if (close.exec(markdown)) {
          literalStart = token.start.offset;
          literalEnd = close.lastIndex;
        }
      } else {
        change(token.start.offset, token.end.offset, rewriteHtml(raw));
      }
      continue;
    }
    const item = stack.at(-1);
    if (!item) continue;
    switch (type) {
      case 'label': item.labelEnd = token.end.offset; break;
      case 'labelText':
      case 'definitionLabelString': item.id = normalizeIdentifier(context.sliceSerialize(token)); break;
      case 'referenceString': item.reference = normalizeIdentifier(context.sliceSerialize(token)); break;
      case 'resource': item.inline = true; break;
      case 'resourceDestinationString':
      case 'definitionDestinationString': item.destination = token; break;
      case 'definitionTitleString': item.title = decodeString(context.sliceSerialize(token)); break;
    }
  }

  for (const [id, references] of uses) {
    const definition = definitions.get(id);
    if (!definition?.destination) continue;
    const images = references.filter(use => use.type === 'image');
    if (includeLinks) {
      updateDestination(definition.destination, images.length ? 'image' : 'link');
    } else if (images.length) {
      const token = definition.destination;
      const url = decodeString(markdown.slice(token.start.offset, token.end.offset));
      const updated = replace(url, 'image');
      if (updated === url) continue;
      // A Reader block may be rendered separately from the definition. Embed its
      // figure at the use site, leaving any link to the same file unchanged.
      const title = definition.title ? ' "' + definition.title.replace(/["\\]/g, '\\$&') + '"' : '';
      for (const use of images) change(use.labelEnd, use.end, '(' + updated + title + ')');
    }
  }

  if (!edits.length) return markdown;
  edits.sort((left, right) => left.start - right.start);
  const parts = [];
  let cursor = 0;
  for (const edit of edits) {
    parts.push(markdown.slice(cursor, edit.start), edit.text);
    cursor = edit.end;
  }
  parts.push(markdown.slice(cursor));
  return parts.join('');
}

module.exports = { rewriteStructuredAssets };
