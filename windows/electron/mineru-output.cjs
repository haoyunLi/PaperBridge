const fs = require('node:fs');
const path = require('node:path');

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
  const prefix = `${directory}${path.sep}`;
  return fs.readFileSync(file, 'utf8').replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (markup, alt, uri) => {
    let relative = uri.replace(/^<|>$/g, '');
    try { relative = decodeURIComponent(relative); } catch { /* Literal percent signs are valid in local filenames. */ }
    if (/^(?:https?:|data:|file:)/i.test(relative)) return markup;
    const candidate = path.resolve(directory, relative);
    const mime = imageTypes[path.extname(candidate).toLowerCase()];
    if (!mime || !candidate.startsWith(prefix)) return markup;
    try {
      const resolved = fs.realpathSync(candidate);
      if (!resolved.startsWith(prefix)) return markup;
      const stat = fs.statSync(resolved);
      if (stat.isFile() && stat.size <= 8_000_000) return `![${alt}](data:${mime};base64,${fs.readFileSync(resolved).toString('base64')})`;
    } catch { /* An unavailable figure must not prevent reading the extracted text. */ }
    return markup;
  });
}

module.exports = { findMineruMarkdown, readMineruMarkdown };
