const fs = require('node:fs');
const path = require('node:path');

const assetTokens = new RegExp([
  /^ {0,3}(?<fence>`{3,}|~{3,})[^\r\n]*(?:\r?\n[\s\S]*?(?:^ {0,3}\k<fence>[`~]*[ \t]*(?=\r?$)|(?![\s\S]))|$)/.source,
  /(?<!`)(?<ticks>`+)(?!`)[\s\S]*?(?<!`)\k<ticks>(?!`)/.source,
  /<!--[\s\S]*?-->|<(?<literal>pre|code|script|style)\b[^>]*>[\s\S]*?<\/\k<literal>\s*>/.source,
  /(?<tag><img\b(?:[^"'>]|"[^"]*"|'[^']*')*>)/.source,
  /(?<opening>!?\[(?:\\.|[^\]\\\r\n])*\]\([ \t]*)(?<destination><[^>\r\n]+>|[^\s()<>]+)(?<closing>(?:[ \t]+(?:"[^"\r\n]*"|'[^'\r\n]*'|\([^()\r\n]*\)))?[ \t]*\))/.source
].join('|'), 'gim');
const attribute = /(\s+)([^\s=/>]+)(?:([ \t\r\n]*=[ \t\r\n]*)("[^"]*"|'[^']*'|[^\s"'`=<>]+))?/g;

function rewriteAssetUrls(markdown, replace, { includeLinks = false } = {}) {
  return String(markdown || '').replace(assetTokens, (markup, ...args) => {
    const { tag, opening, destination, closing } = args.at(-1);
    if (tag) return tag.replace(attribute, (field, space, name, assignment, value) => {
      if (name.toLowerCase() !== 'src' || !value) return field;
      const quoted = /^["']/.test(value);
      const quote = quoted ? value[0] : '"';
      const url = quoted ? value.slice(1, -1) : value;
      const replacement = replace(url, 'image');
      return replacement === url ? field : `${space}${name}${assignment}${quote}${replacement}${quote}`;
    });
    if (!opening) return markup;
    const kind = opening.startsWith('!') ? 'image' : 'link';
    if (kind === 'link' && !includeLinks) return markup;
    const angled = destination.startsWith('<');
    const url = angled ? destination.slice(1, -1) : destination;
    const replacement = replace(url, kind);
    return replacement === url ? markup : `${opening}${angled ? `<${replacement}>` : replacement}${closing}`;
  });
}

function localAssetReference(url) {
  if (/^(?:[\\/#?]|[a-z][a-z0-9+.-]*:)/i.test(url) || !url) return null;
  const index = url.search(/[?#]/);
  let relative = index < 0 ? url : url.slice(0, index);
  const suffix = index < 0 ? '' : url.slice(index);
  try { relative = decodeURIComponent(relative); } catch { /* A literal percent sign is valid in a filename. */ }
  return { relative, suffix };
}

function assetFile(directory, relative) {
  if (!directory || /[\x00:]/.test(relative) || /^[\\/]/.test(relative)) return null;
  const prefix = `${directory}${path.sep}`;
  const candidate = path.resolve(directory, relative);
  if (!candidate.startsWith(prefix)) return null;
  try {
    const file = fs.realpathSync(candidate);
    if (!file.startsWith(prefix)) return null;
    const stat = fs.statSync(file);
    return stat.isFile() ? { file, size: stat.size } : null;
  } catch { return null; }
}

module.exports = { rewriteAssetUrls, localAssetReference, assetFile };
