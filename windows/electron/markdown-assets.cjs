const fs = require('node:fs');
const path = require('node:path');
const { decodeHTMLAttribute } = require('entities');
const { mayContainIndentedOrNestedCode } = require('./markdown-code-context.mjs');
const mineruResultManifest = '.paperbridge-result.json';
const maxMarkdownBytes = 64 * 1024 * 1024;

const htmlTokens = [
  /<!--[\s\S]*?-->|<(?<literal>pre|code|script|style)\b[^>]*>[\s\S]*?<\/\k<literal>\s*>/.source,
  /(?<tag><(?:img|a)(?=[\s/>])(?:[^"'>]|"[^"]*"|'[^']*')*>)/.source
];
const markdownLiterals = [
  /^ {0,3}(?<fence>`{3,}|~{3,})[^\r\n]*(?:\r?\n[\s\S]*?(?:^ {0,3}\k<fence>[`~]*[ \t]*(?=\r?$)|(?![\s\S]))|$)/.source,
  /(?<!`)(?<ticks>`+)(?!`)(?:[^\r\n]|\r?\n(?![ \t]*\r?\n))*?(?<!`)\k<ticks>(?!`)/.source,
];
const htmlAssets = new RegExp([...markdownLiterals, ...htmlTokens].join('|'), 'gim');
const assetTokens = new RegExp([
  ...markdownLiterals,
  ...htmlTokens,
  /(?<opening>!?\[(?:\\.|[^\[\]\\\r\n])*\]\([ \t]*)(?<destination><[^>\r\n]+>|[^\s()<>]+)(?<closing>(?:[ \t]+(?:"[^"\r\n]*"|'[^'\r\n]*'|\([^()\r\n]*\)))?[ \t]*\))/.source
].join('|'), 'gim');
const attribute = /(\s+)([^\s=/>]+)(?:([ \t\r\n]*=[ \t\r\n]*)("[^"]*"|'[^']*'|[^\s"'`=<>]+))?/g;

function rewriteAssetUrls(markdown, replace, { includeLinks = false, legacyCodeImages = false } = {}) {
  const source = String(markdown || '');
  const hasAsset = includeLinks ? /\[|<(?:img|a)(?=[\s/>])/i : /!\[|<img(?=[\s/>])/i;
  if (!hasAsset.test(source)) return source;
  function rewriteTag(tag) {
    const kind = /^<img/i.test(tag) ? 'image' : 'link';
    if (kind === 'link' && !includeLinks) return tag;
    const destination = kind === 'image' ? 'src' : 'href';
    return tag.replace(attribute, (field, space, name, assignment, value) => {
      if (name.toLowerCase() !== destination || !value) return field;
      const quoted = /^["']/.test(value);
      const quote = quoted ? value[0] : '"';
      const url = decodeHTMLAttribute(quoted ? value.slice(1, -1) : value);
      const replacement = replace(url, kind);
      if (replacement === url) return field;
      const escaped = replacement.replaceAll('&', '&amp;').replaceAll(quote, quote === '"' ? '&quot;' : '&#39;');
      return `${space}${name}${assignment}${quote}${escaped}${quote}`;
    });
  }
  // Most MinerU files have single-line assets and can contain megabytes of inline image data.
  // Use CommonMark offsets for nested labels, escaped or balanced destinations, definitions and wrapped links.
  const complexInline = /\[[^[\]\r\n]*\[|\]\([ \t]*(?!data:)[^\s()<>\\]*(?:\(|\\|&(?:#\w+|[a-z]\w+);)/i;
  if (source.includes(']:') || complexInline.test(source) || (!legacyCodeImages && mayContainIndentedOrNestedCode(source)) || /\[[^[\]\r\n]*\r?\n(?![ \t]*\r?\n)|\]\([^[\]\r\n)]*\r?\n/.test(source)) {
    const { rewriteStructuredAssets } = require('./markdown-asset-syntax.cjs');
    return rewriteStructuredAssets(source, replace, includeLinks, html => html.replace(htmlAssets,
      (markup, ...args) => args.at(-1).tag ? rewriteTag(markup) : markup));
  }
  return source.replace(assetTokens, (markup, ...args) => {
    const { tag, opening, destination, closing } = args.at(-1);
    if (tag) return rewriteTag(tag);
    if (!opening) return markup;
    const kind = opening.startsWith('!') ? 'image' : 'link';
    if (kind === 'link' && !includeLinks) return markup;
    const angled = destination.startsWith('<');
    const url = angled ? destination.slice(1, -1) : destination;
    const replacement = replace(url, kind);
    return replacement === url ? markup : `${opening}${angled ? `<${replacement}>` : replacement}${closing}`;
  });
}

function localAssetReference(url, fromMarkdown = '') {
  if (/^(?:[\\/#?]|[a-z][a-z0-9+.-]*:)/i.test(url) || !url) return null;
  const index = url.search(/[?#]/);
  let relative = index < 0 ? url : url.slice(0, index);
  const suffix = index < 0 ? '' : url.slice(index);
  try { relative = decodeURIComponent(relative); } catch { /* A literal percent sign is valid in a filename. */ }
  // An encoded absolute path must stay distinguishable from a relative link.
  if (!/^[\\\\/]/.test(relative)) {
    relative = path.posix.join(path.posix.dirname(fromMarkdown), relative.replaceAll('\\', '/'));
  }
  return { relative, suffix };
}

function archivePathKey(relative) {
  if (!relative || /^[\\/]/.test(relative) || /[\\:\x00-\x1f<>"|?*]/.test(relative)) return null;
  const parts = relative.split('/').filter(part => part && part !== '.');
  const device = /^(?:con|prn|aux|nul|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³])$/i;
  if (parts.some(part => /[. ]$/.test(part) || device.test(part.split('.')[0].trimEnd()))) return null;
  if (parts.some(part => part === '..' || part.toLowerCase() === mineruResultManifest)) return null;
  return parts.length ? parts.join('/').toLowerCase() : null;
}

function isMarkdownFile(relative) {
  return /\.(?:md|markdown)$/i.test(relative);
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

function visitLocalAssets(markdown, fromMarkdown, visit) {
  rewriteAssetUrls(markdown, url => {
    const reference = localAssetReference(url, fromMarkdown);
    if (reference) visit(reference.relative);
    return url;
  }, { includeLinks: true });
}

module.exports = { rewriteAssetUrls, visitLocalAssets, localAssetReference, assetFile, archivePathKey, isMarkdownFile, mineruResultManifest, maxMarkdownBytes };
