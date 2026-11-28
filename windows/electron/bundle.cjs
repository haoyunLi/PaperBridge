const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { rewriteAssetUrls, visitLocalAssets, localAssetReference, assetFile, archivePathKey, isMarkdownFile, mineruResultManifest, maxMarkdownBytes } = require('./markdown-assets.cjs');
const maximumPreviewPages = 120;
// Keep the generated Markdown index usable even with an abnormally large PDF page count.
const maximumOmittedPageHeadings = 10000;
const facsimileHeadings = new Map([
  ['original', 'Extracted source text'],
  ['translated', 'Translation of selectable text'],
  ['bilingual', 'Extracted bilingual text'],
  ['full', 'Full translation of selectable text']
]);

const filenameCharacters = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

function safeName(name) {
  let stem = String(name || 'PaperBridge').toWellFormed().replace(/\.pdf$/i, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
    .trim().replace(/[. ]+$/, '') || 'PaperBridge';
  if (/^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(stem)) stem = '_' + stem;
  if (stem.length <= 90) return stem;
  // Keep the opening title and the edition/language at the end within the existing path budget.
  const characters = filenameCharacters.segment(stem);
  const headEnd = characters.containing(55).index;
  const tailLimit = stem.length - 34;
  const tail = characters.containing(tailLimit);
  const tailStart = tail.index === tailLimit ? tail.index : tail.index + tail.segment.length;
  return stem.slice(0, headEnd) + '…' + stem.slice(tailStart);
}

function uniqueFolder(parent, name) {
  const base = safeName(name);
  for (let i = 0; i < 1000; i++) {
    const candidate = path.join(parent, i ? `${base}-${i + 1}` : base);
    try { fs.mkdirSync(candidate); return candidate; }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  throw new Error('Could not create a unique export folder.');
}

function writeBundle(parent, paper, documents, pdfPath, assetDirectory) {
  if (!Array.isArray(documents) || !documents.length) throw new Error('No Markdown documents to export.');
  const paperStem = path.parse(String(paper.name || 'PaperBridge')).name;
  const folder = uniqueFolder(parent, `${safeName(paperStem)}_PaperBridge`);
  const assets = path.join(folder, 'assets');
  const assetNames = new Set();
  const missing = new Set();
  const pendingMarkdown = new Map();
  const unscannedMarkdownPaths = [];
  const originalPdf = paper.type === 'pdf' && Boolean(pdfPath && fs.existsSync(pdfPath));
  const source = assetDirectory ? fs.realpathSync(assetDirectory) : null;
  function saveAsset(name, write) {
    if (!assetNames.has(name)) {
      const destination = path.join(assets, name);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      write(destination);
      assetNames.add(name);
    }
    return `assets/${name}`;
  }
  const namedAssets = new Map();
  function copyNamedAsset(relative) {
    const key = archivePathKey(relative);
    if (namedAssets.has(key)) return namedAssets.get(key);
    const asset = key === 'original.pdf' && originalPdf ? { file: pdfPath } : key && assetFile(source, relative);
    // A directory junction can point to an ancestor and generate endless aliases.
    const linkedDirectory = asset && source && key !== 'original.pdf' &&
      path.relative(path.dirname(path.resolve(source, relative)), path.dirname(asset.file)) !== '';
    if (!asset || linkedDirectory || path.basename(asset.file).toLowerCase() === mineruResultManifest) {
      missing.add(relative);
      return null;
    }
    // Links inside copied Markdown resolve relative to this tree without changing its bytes.
    const destination = saveAsset('source/' + relative, file => fs.copyFileSync(asset.file, file));
    const url = destination.split('/').map(part => encodeURIComponent(part).replace(/[!'()*]/g,
      char => '%' + char.charCodeAt(0).toString(16).toUpperCase())).join('/');
    namedAssets.set(key, url);
    if (isMarkdownFile(relative)) {
      if (asset.size <= maxMarkdownBytes) pendingMarkdown.set(relative, asset.file);
      else unscannedMarkdownPaths.push(relative);
    }
    return url;
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
    const destination = copyNamedAsset(relative);
    return destination ? destination + suffix : url;
  }
  const used = new Set(originalPdf ? ['original pages.md'] : []);
  const facsimileDocuments = [];
  for (const document of documents) {
    const stem = safeName(typeof document.filename === 'string' && document.filename.trim()
      ? document.filename.replace(/\.md$/i, '') : document.name);
    let name = `${stem}.md`;
    for (let i = 2; used.has(name.toLowerCase()); i++) name = `${stem}-${i}.md`;
    used.add(name.toLowerCase());
    fs.writeFileSync(path.join(folder, name), rewriteAssetUrls(document.content, externalize, { includeLinks: true }), 'utf8');
    if (originalPdf && paper.facsimile && facsimileHeadings.has(document.kind)) {
      const heading = document.kind === 'translated' && typeof document.targetLanguage === 'string'
        && /^[A-Za-z]+(?: [A-Za-z]+)*$/.test(document.targetLanguage)
        ? `${document.targetLanguage} translation of selectable text` : facsimileHeadings.get(document.kind);
      facsimileDocuments.push({ name, heading });
    }
  }
  for (const [relative, file] of pendingMarkdown) {
    visitLocalAssets(fs.readFileSync(file, 'utf8'), relative, copyNamedAsset);
  }
  if (originalPdf) fs.copyFileSync(pdfPath, path.join(folder, 'original.pdf'));
  return { folder, documents: documents.length, assets: assetNames.size, missingAssetPaths: [...missing].sort(), unscannedMarkdownPaths, originalPdf, facsimileDocuments };
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
    else if (!stopped) pages.push(`## Page ${page}\n\n> Preview unavailable. [Open page ${page} in the original PDF](original.pdf#page=${page}).`);
  }
  if (!stopped && pageCount > limit) {
    const lastHeading = Math.min(pageCount, limit + maximumOmittedPageHeadings);
    for (let page = limit + 1; page <= lastHeading; page++) {
      pages.push(`## Page ${page}\n\n> PNG omitted for this long document. [Open page ${page} in the original PDF](original.pdf#page=${page}).`);
    }
    if (lastHeading < pageCount) {
      const first = lastHeading + 1;
      pages.push(`## Pages ${first}–${pageCount}\n\n> Continue in the original PDF from [page ${first}](original.pdf#page=${first}) to [page ${pageCount}](original.pdf#page=${pageCount}).`);
    }
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
