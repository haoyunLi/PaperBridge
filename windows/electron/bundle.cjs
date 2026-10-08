const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function safeName(name) {
  return String(name || 'PaperBridge').replace(/\.pdf$/i, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').trim().slice(0, 90) || 'PaperBridge';
}

function uniqueFolder(parent, name) {
  const base = safeName(name);
  for (let i = 0; i < 1000; i++) {
    const candidate = path.join(parent, i ? `${base}-${i}` : base);
    try { fs.mkdirSync(candidate); return candidate; }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  throw new Error('Could not create a unique export folder.');
}

function writeBundle(parent, paper, documents, pdfPath) {
  if (!Array.isArray(documents) || !documents.length) throw new Error('No Markdown documents to export.');
  const folder = uniqueFolder(parent, `${safeName(paper.name)}-PaperBridge`);
  const assets = path.join(folder, 'assets');
  const assetNames = new Map();
  function externalize(markdown) {
    return String(markdown || '').replace(/!\[([^\]]*)\]\(data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/=]+)\)/gi, (_full, alt, type, encoded) => {
      const bytes = Buffer.from(encoded, 'base64');
      const digest = crypto.createHash('sha256').update(bytes).digest('hex');
      const ext = type.toLowerCase() === 'jpeg' ? 'jpg' : type.toLowerCase();
      const name = `${digest}.${ext}`;
      if (!assetNames.has(name)) { fs.mkdirSync(assets, { recursive: true }); fs.writeFileSync(path.join(assets, name), bytes); assetNames.set(name, true); }
      return `![${alt}](assets/${name})`;
    });
  }
  const used = new Set();
  for (const document of documents) {
    const stem = safeName(document.name);
    let name = `${stem}.md`;
    for (let i = 2; used.has(name.toLowerCase()); i++) name = `${stem}-${i}.md`;
    used.add(name.toLowerCase());
    fs.writeFileSync(path.join(folder, name), externalize(document.content), 'utf8');
  }
  if (paper.type === 'pdf' && pdfPath && fs.existsSync(pdfPath)) fs.copyFileSync(pdfPath, path.join(folder, 'original.pdf'));
  return { folder, documents: documents.length, assets: assetNames.size, originalPdf: paper.type === 'pdf' && Boolean(pdfPath && fs.existsSync(pdfPath)) };
}

module.exports = { writeBundle, safeName };
