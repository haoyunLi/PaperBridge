const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { version: pdfjsVersion } = require('pdfjs-dist/package.json');
const { maximumPreviewPages, pageImageName } = require('./bundle.cjs');

const format = `pdfjs-png-v1-${pdfjsVersion}`;
const maxPageBytes = 20_000_000;
const digestBytes = 32;
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const digest = bytes => crypto.createHash('sha256').update(bytes).digest();
const cacheRoot = root => path.join(root, 'pdf-page-cache');

function validPageImage(bytes) {
  return bytes.length >= 33 && bytes.length <= maxPageBytes && bytes.subarray(0, 8).equals(pngSignature)
    && bytes.toString('ascii', 12, 16) === 'IHDR';
}

function readEntry(file, limit) {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.size <= digestBytes || stat.size > digestBytes + limit) return null;
    const entry = fs.readFileSync(file);
    const bytes = entry.subarray(digestBytes);
    return bytes.length <= limit && digest(bytes).equals(entry.subarray(0, digestBytes)) ? bytes : null;
  } catch { return null; }
}

function writeEntry(file, bytes) {
  const temporary = path.join(path.dirname(file), `.${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, Buffer.concat([digest(bytes), bytes]), { flag: 'wx' });
    fs.renameSync(temporary, file);
  } catch { /* The export still works when its cache is unavailable. */ }
  finally { try { fs.unlinkSync(temporary); } catch { /* Rename or write already finished. */ } }
}

async function createPageArchive(root, pdfFile) {
  try {
    const hash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(pdfFile)) hash.update(chunk);
    const fingerprint = hash.digest('hex');
    const versionRoot = path.join(cacheRoot(root), format);
    const folder = path.join(versionRoot, fingerprint);
    for (const directory of [cacheRoot(root), versionRoot, folder]) {
      try { fs.mkdirSync(directory); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
      if (!fs.lstatSync(directory).isDirectory()) return null;
    }
    const pageFile = number => path.join(folder, `${pageImageName(number)}.entry`);
    const countFile = path.join(folder, 'page-count.entry');
    return {
      matches(pdfBytes) { return digest(pdfBytes).toString('hex') === fingerprint; },
      status() {
        const pageCount = Number(readEntry(countFile, 16)?.toString());
        let cachedPages = [];
        try {
          cachedPages = fs.readdirSync(folder).flatMap(name => {
            const match = /^page-(\d{3})\.png\.entry$/.exec(name);
            const number = match ? Number(match[1]) : 0;
            return number > 0 && number <= maximumPreviewPages ? [number] : [];
          });
        } catch { /* Unavailable archives are rendered again. */ }
        return { cachedPageCount: Number.isSafeInteger(pageCount) && pageCount > 0 ? pageCount : 0, cachedPages };
      },
      readPage(number) {
        const bytes = readEntry(pageFile(number), maxPageBytes);
        return bytes && validPageImage(bytes) ? bytes : null;
      },
      savePage(number, bytes) { writeEntry(pageFile(number), bytes); },
      savePageCount(pageCount) { if (pageCount > 0) writeEntry(countFile, Buffer.from(String(pageCount))); }
    };
  } catch { return null; }
}

function clearPageArchives(root) {
  fs.rmSync(cacheRoot(root), { recursive: true, force: true });
}

module.exports = { createPageArchive, clearPageArchives, validPageImage };
