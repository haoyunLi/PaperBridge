const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const maximumPreviewPages = 120;
const facsimileHeadings = new Map([
  ['original', 'Extracted source text'],
  ['translated', 'Translation of selectable text'],
  ['bilingual', 'Extracted bilingual text'],
  ['full', 'Full translation of selectable text']
]);

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
  const originalPdf = paper.type === 'pdf' && Boolean(pdfPath && fs.existsSync(pdfPath));
  const used = new Set(originalPdf ? ['original pages.md'] : []);
  const facsimileDocuments = [];
  for (const document of documents) {
    const stem = safeName(document.name);
    let name = `${stem}.md`;
    for (let i = 2; used.has(name.toLowerCase()); i++) name = `${stem}-${i}.md`;
    used.add(name.toLowerCase());
    fs.writeFileSync(path.join(folder, name), externalize(document.content), 'utf8');
    if (originalPdf && paper.facsimile && facsimileHeadings.has(document.kind)) {
      facsimileDocuments.push({ name, heading: facsimileHeadings.get(document.kind) });
    }
  }
  if (originalPdf) fs.copyFileSync(pdfPath, path.join(folder, 'original.pdf'));
  return { folder, documents: documents.length, assets: assetNames.size, originalPdf, facsimileDocuments };
}

function pageImageName(pageNumber) {
  return `page-${String(pageNumber).padStart(3, '0')}.png`;
}

function writeBundleFacsimile({ folder, facsimileDocuments, renderedPages }, pageCount, stopped) {
  const limit = Math.min(pageCount, maximumPreviewPages);
  const notice = ['Page images preserve the original layout.'];
  if (pageCount > limit) notice.push(`Previews are limited to the first ${limit} of ${pageCount} pages.`);
  if (!pageCount) notice.push('The PDF could not be opened for page previews.');
  else if (stopped) notice.push('Page export stopped. Only completed previews are included.');
  else if (renderedPages.size < limit) notice.push('Some page previews are unavailable.');
  const pages = [];
  for (let page = 1; page <= limit; page++) {
    if (renderedPages.has(page)) pages.push(`## Page ${page}\n\n![Original PDF page ${page}](pages/${pageImageName(page)})`);
    else if (!stopped) pages.push(`## Page ${page}\n\n> Preview unavailable. Open the exact original PDF above.`);
  }
  const facsimile = ['# Original PDF facsimile', `> ${notice.join(' ')}`, '[Open the exact original PDF](original.pdf)', ...pages].join('\n\n');
  fs.writeFileSync(path.join(folder, 'Original Pages.md'), `${facsimile}\n`, 'utf8');
  for (const { name, heading } of facsimileDocuments) {
    const destination = path.join(folder, name);
    const body = fs.readFileSync(destination, 'utf8');
    const content = body.trim() ? body : '> No selectable text was found. Use an OCR parser to recover the text.';
    const combined = `${facsimile}\n\n---\n\n# ${heading}\n\n${content}${content.endsWith('\n') ? '' : '\n'}`;
    const temporary = `${destination}.tmp`;
    try {
      fs.writeFileSync(temporary, combined, 'utf8');
      fs.renameSync(temporary, destination);
    } finally { fs.rmSync(temporary, { force: true }); }
  }
}

module.exports = { writeBundle, writeBundleFacsimile, pageImageName, maximumPreviewPages, safeName };
