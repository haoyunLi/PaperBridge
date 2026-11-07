const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { rewriteAssetUrls, localAssetReference, assetFile, mineruResultManifest } = require('./markdown-assets.cjs');
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

function writeBundle(parent, paper, documents, pdfPath, assetDirectory) {
  if (!Array.isArray(documents) || !documents.length) throw new Error('No Markdown documents to export.');
  const folder = uniqueFolder(parent, `${safeName(paper.name)}-PaperBridge`);
  const assets = path.join(folder, 'assets');
  const assetNames = new Set();
  const missing = new Set();
  const originalPdf = paper.type === 'pdf' && Boolean(pdfPath && fs.existsSync(pdfPath));
  const source = assetDirectory ? fs.realpathSync(assetDirectory) : null;
  function saveAsset(name, write) {
    if (!assetNames.has(name)) {
      fs.mkdirSync(assets, { recursive: true });
      write(path.join(assets, name));
      assetNames.add(name);
    }
    return `assets/${name}`;
  }
  function externalize(url, kind) {
    const embedded = kind === 'image' && /^data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/=]+)$/i.exec(url);
    if (embedded) {
      const [, type, encoded] = embedded;
      const bytes = Buffer.from(encoded, 'base64');
      const digest = crypto.createHash('sha256').update(bytes).digest('hex');
      const ext = type.toLowerCase() === 'jpeg' ? 'jpg' : type.toLowerCase();
      return saveAsset(`${digest}.${ext}`, file => fs.writeFileSync(file, bytes));
    }
    if (paper.sourceMode !== 'mineru' && !source) return url;
    const reference = localAssetReference(url);
    if (!reference) return url;
    const { relative, suffix } = reference;
    if (originalPdf && /^(?:\.\/)?original\.pdf$/i.test(relative)) return `original.pdf${suffix}`;
    const asset = assetFile(source, relative);
    if (!asset || path.basename(asset.file).toLowerCase() === mineruResultManifest) { missing.add(relative); return url; }
    const digest = crypto.createHash('sha256').update(asset.file).digest('hex');
    const extension = path.extname(asset.file).toLowerCase();
    const name = `local-${digest}${/^\.[a-z0-9]{1,12}$/.test(extension) ? extension : ''}`;
    return saveAsset(name, file => fs.copyFileSync(asset.file, file)) + suffix;
  }
  const used = new Set(originalPdf ? ['original pages.md'] : []);
  const facsimileDocuments = [];
  for (const document of documents) {
    const stem = safeName(document.name);
    let name = `${stem}.md`;
    for (let i = 2; used.has(name.toLowerCase()); i++) name = `${stem}-${i}.md`;
    used.add(name.toLowerCase());
    fs.writeFileSync(path.join(folder, name), rewriteAssetUrls(document.content, externalize, { includeLinks: true }), 'utf8');
    if (originalPdf && paper.facsimile && facsimileHeadings.has(document.kind)) {
      facsimileDocuments.push({ name, heading: facsimileHeadings.get(document.kind) });
    }
  }
  if (originalPdf) fs.copyFileSync(pdfPath, path.join(folder, 'original.pdf'));
  return { folder, documents: documents.length, assets: assetNames.size, missingAssetPaths: [...missing].sort(), originalPdf, facsimileDocuments };
}

function pageImageName(pageNumber) {
  return `page-${String(pageNumber).padStart(3, '0')}.png`;
}

function writeBundleFacsimile({ folder, facsimileDocuments, renderedPages }, pageCount, stopped) {
  const limit = Math.min(pageCount, maximumPreviewPages);
  const notice = ['Page images preserve the original layout.'];
  if (pageCount > limit) notice.push(`Previews are limited to the first ${limit} of ${pageCount} pages.`);
  if (stopped) notice.push('Page export stopped. Only completed previews are included.');
  else if (!pageCount) notice.push('The PDF could not be opened for page previews.');
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
