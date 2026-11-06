const fs = require('node:fs');
const path = require('node:path');
const { rewriteAssetUrls, localAssetReference, assetFile } = require('./markdown-assets.cjs');

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
      if (asset && asset.size <= 8_000_000) return `data:${mime};base64,${fs.readFileSync(asset.file).toString('base64')}`;
    } catch { /* An unavailable figure must not prevent reading the extracted text. */ }
    return url;
  });
}

module.exports = { findMineruMarkdown, readMineruMarkdown };
