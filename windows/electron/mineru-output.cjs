const fs = require('node:fs');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const yauzl = require('yauzl');
const { rewriteAssetUrls, localAssetReference, assetFile } = require('./markdown-assets.cjs');

const structuredOutput = 'structured_content.json';
const maxMetadataBytes = 64 * 1024 * 1024;
const maxImageBytes = 8_000_000;

async function unpackMineruArchive(archive, folder, checkActive) {
  const zip = await yauzl.openPromise(archive, { strictFileNames: true });
  try {
    for await (const entry of zip.eachEntry()) {
      checkActive();
      const name = entry.fileName;
      const image = /^images\/[a-z0-9_-]+\.(?:png|jpe?g|gif|webp)$/i.test(name);
      // Keep full-size images for portable export. Only the preview has an inline size limit.
      if (!image && name !== 'markdown.md' && name !== structuredOutput) continue;
      const destination = path.join(folder, name === 'markdown.md' ? 'paper.md' : name);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      await pipeline(await zip.openReadStreamPromise(entry), fs.createWriteStream(destination, { flags: 'wx' }));
    }
  } finally { zip.close(); }
}

function findMineruMarkdown(folder, preferredStem) {
  if (!fs.existsSync(folder)) return null;
  const expected = preferredStem.toLowerCase();
  let bestFile = null;
  let bestScore = 0;
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) { visit(file); continue; }
      const extension = path.extname(entry.name);
      if (!entry.isFile() || extension.toLowerCase() !== '.md') continue;
      const size = fs.statSync(file).size;
      if (!size) continue;
      const stem = path.basename(entry.name, extension).toLowerCase();
      const score = size + (stem === expected ? 10_000_000 : 0) + (/full|content/.test(stem) ? 1_000_000 : 0);
      if (score > bestScore) { bestFile = file; bestScore = score; }
    }
  }
  visit(folder);
  return bestFile;
}

const imageTypes = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };

function readMineruMarkdown(file) {
  const directory = fs.realpathSync(path.dirname(file));
  return rewriteAssetUrls(fs.readFileSync(file, 'utf8'), url => {
    const reference = localAssetReference(url);
    if (!reference) return url;
    const mime = imageTypes[path.extname(reference.relative).toLowerCase()];
    if (!mime) return url;
    const asset = assetFile(directory, reference.relative);
    try {
      if (asset && asset.size <= maxImageBytes) return `data:${mime};base64,${fs.readFileSync(asset.file).toString('base64')}`;
    } catch { /* An unavailable figure must not prevent reading the extracted text. */ }
    return url;
  });
}

function readMineruPageHints(markdownFile) {
  const directory = fs.realpathSync(path.dirname(markdownFile));
  const stem = path.basename(markdownFile, path.extname(markdownFile));
  const validIndex = index => Number.isSafeInteger(index) && index >= 0 && index < 100_000;
  for (const name of [structuredOutput, `${stem}_content_list.json`]) {
    const asset = assetFile(directory, name);
    if (!asset || asset.size > maxMetadataBytes) continue;
    try {
      const data = JSON.parse(fs.readFileSync(asset.file, 'utf8'));
      const hints = [];
      const add = (index, values) => {
        if (!validIndex(index)) return;
        for (const text of values) if (typeof text === 'string' && text.trim()) hints.push({ page: index + 1, text });
      };
      const list = value => Array.isArray(value) ? value : [];
      if (Array.isArray(data)) {
        for (const entry of data) {
          if (!entry) continue;
          add(entry.page_idx, [entry.text, ...list(entry.img_caption), ...list(entry.table_caption), ...list(entry.list_items)]);
        }
      } else {
        let continued = null;
        const addContinued = () => {
          if (continued?.parts.length > 1) add(continued.index, [continued.parts.join(' ')]);
        };
        for (const page of list(data?.pages)) {
          if (!validIndex(page?.page_idx)) continue;
          for (const block of list(page?.blocks)) {
            if (!block) continue;
            add(page.page_idx, [block.content, ...list(block.captions).map(caption => caption?.content), ...list(block.footnotes).map(note => note?.content)]);
            if (block.type === 'text' && typeof block.content === 'string') {
              if (continued && block.continues_prev === true && !block.anchor) continued.parts.push(block.content);
              else {
                addContinued();
                continued = { index: page.page_idx, parts: [block.content] };
              }
            } else if (block.type === 'list') {
              addContinued();
              continued = null;
            }
          }
        }
        addContinued();
      }
      if (hints.length) return hints;
    } catch { /* An unreadable sidecar does not affect the Markdown. */ }
  }
  return [];
}

module.exports = { findMineruMarkdown, readMineruMarkdown, readMineruPageHints, unpackMineruArchive };
