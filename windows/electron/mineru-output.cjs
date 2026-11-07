const fs = require('node:fs');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const yauzl = require('yauzl');
const { rewriteAssetUrls, localAssetReference, assetFile, mineruResultManifest } = require('./markdown-assets.cjs');

const structuredOutput = 'structured_content.json';
const maxMetadataBytes = 64 * 1024 * 1024;
const maxImageBytes = 8_000_000;
const maxArchiveEntries = 50_000;
const maxAttachmentBytes = 256 * 1024 * 1024;
const maxRetainedBytes = 1024 * 1024 * 1024;

function archivePathKey(relative) {
  if (!relative || /^[\\/]/.test(relative) || /[\\:\x00-\x1f<>"|?*]/.test(relative)) return null;
  const parts = relative.split('/').filter(part => part && part !== '.');
  const device = /^(?:con|prn|aux|nul|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³])$/i;
  if (parts.some(part => /[. ]$/.test(part) || device.test(part.split('.')[0].trimEnd()))) return null;
  if (parts[0]?.toLowerCase() === mineruResultManifest) return null;
  return parts.length ? parts.join('/').toLowerCase() : null;
}

function regularArchiveFile(entry) {
  const host = entry.versionMadeBy >>> 8;
  const unixType = (host === 3 || host === 19) ? (entry.externalFileAttributes >>> 16) & 0o170000 : 0;
  return !entry.fileName.endsWith('/') && !(entry.externalFileAttributes & 0x410)
    && (!unixType || unixType === 0o100000) && entry.canDecodeFileData();
}

async function unpackEntry(zip, entry, folder, checkActive) {
  checkActive();
  const destination = path.join(folder, entry.fileName);
  await fs.promises.mkdir(path.dirname(destination), { recursive: true });
  const file = await fs.promises.open(destination, 'wx');
  try {
    await pipeline(await zip.openReadStreamPromise(entry), async function* (source) {
      for await (const chunk of source) {
        checkActive();
        yield chunk;
      }
    }, file.createWriteStream());
  } catch (error) {
    await file.close().catch(() => {});
    await fs.promises.unlink(destination).catch(() => {});
    throw error;
  }
  return destination;
}

async function unpackMineruArchive(archive, folder, checkActive) {
  const zip = await yauzl.openPromise(archive, { strictFileNames: true, autoClose: false });
  try {
    if (zip.entryCount > maxArchiveEntries) throw new Error('MinerU output contains too many archive entries.');
    const entries = new Map();
    for await (const entry of zip.eachEntry()) {
      checkActive();
      if (!regularArchiveFile(entry)) continue;
      const key = archivePathKey(entry.fileName);
      if (key) entries.set(key, entries.has(key) ? null : entry);
    }
    const source = entries.get('markdown.md');
    if (!source) throw new Error('MinerU finished without a unique Markdown file.');
    if (source.uncompressedSize > maxMetadataBytes) throw new Error('The MinerU Markdown output is too large to read.');
    checkActive();
    await fs.promises.mkdir(folder);
    const markdown = await unpackEntry(zip, source, folder, checkActive);
    entries.delete('markdown.md');
    const selected = new Set([structuredOutput]);
    rewriteAssetUrls(await fs.promises.readFile(markdown, 'utf8'), url => {
      const key = archivePathKey(localAssetReference(url)?.relative);
      if (key && entries.has(key)) selected.add(key);
      return url;
    }, { includeLinks: true });
    // Preserve the standard full-size figures as well as attachments named by the document.
    for (const key of entries.keys()) if (/^images\/[a-z0-9_-]+\.(?:png|jpe?g|gif|webp)$/.test(key)) selected.add(key);
    let selectedBytes = 0;
    for (const key of selected) {
      const entry = entries.get(key);
      const limit = key === structuredOutput ? maxMetadataBytes : maxAttachmentBytes;
      if (!entry || entry.uncompressedSize > limit || selectedBytes + entry.uncompressedSize > maxRetainedBytes) continue;
      selectedBytes += entry.uncompressedSize;
      checkActive();
      try {
        await unpackEntry(zip, entry, folder, checkActive);
      } catch {
        // Optional unreadable files stay as missing links. Cancellation still stops the import.
        checkActive();
      }
    }
    checkActive();
    return markdown;
  } finally { zip.close(); }
}

function* mineruMarkdownFiles(folder) {
  if (!fs.existsSync(folder)) return;
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) yield* mineruMarkdownFiles(file);
    if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.md') yield file;
  }
}

function findMineruMarkdown(folder, preferredStem) {
  const expected = preferredStem.toLowerCase();
  let bestFile = null;
  let bestScore = 0;
  for (const file of mineruMarkdownFiles(folder)) {
    const size = fs.statSync(file).size;
    if (!size) continue;
    const stem = path.parse(file).name.toLowerCase();
    const score = size + (stem === expected ? 10_000_000 : 0) + (/full|content/.test(stem) ? 1_000_000 : 0);
    if (score > bestScore) { bestFile = file; bestScore = score; }
  }
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

module.exports = { mineruMarkdownFiles, findMineruMarkdown, readMineruMarkdown, readMineruPageHints, unpackMineruArchive };
