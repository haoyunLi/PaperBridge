const fs = require('node:fs');
const path = require('node:path');
const { archivePathKey, assetFile, isMarkdownFile, localAssetReference, maxMarkdownBytes } = require('./markdown-assets.cjs');
const { imageTypes, maxImageBytes, readMineruMarkdown } = require('./mineru-output.cjs');
const { findPaperMineruMarkdown } = require('./mineru-resources.cjs');

async function openPaperAttachment(root, paper, href, from, openPath) {
  const main = findPaperMineruMarkdown(root, paper);
  if (!main) throw new Error('This paper has no saved attachment folder.');
  if (typeof href !== 'string' || href.length > 8192 || typeof from !== 'string' || from.length > 8192 ||
      (from && (!archivePathKey(from) || !isMarkdownFile(from)))) throw new Error('Invalid paper attachment link.');
  const reference = localAssetReference(href, from);
  if (!reference || !archivePathKey(reference.relative)) throw new Error('This link is outside the saved paper.');
  const directory = path.dirname(main);
  const asset = assetFile(directory, reference.relative);
  if (!asset) throw new Error('This attachment is missing from the saved paper.');
  const extension = path.extname(reference.relative).toLowerCase();
  if (extension !== path.extname(asset.file).toLowerCase()) throw new Error('This attachment has an unexpected file type.');
  if (extension === '.pdf') {
    const error = await openPath(asset.file);
    if (error) throw new Error('Windows could not open the PDF. ' + error);
    return { kind: 'pdf' };
  }
  const info = { path: reference.relative, name: path.basename(reference.relative), fragment: reference.suffix.match(/#.*$/)?.[0] || '' };
  if (imageTypes[extension]) {
    if (asset.size > maxImageBytes) throw new Error('This image exceeds the 8 MB preview limit.');
    return { ...info, kind: 'image', content: 'data:' + imageTypes[extension] + ';base64,' + fs.readFileSync(asset.file).toString('base64') };
  }
  const markdown = isMarkdownFile(reference.relative);
  if (!markdown && !['.txt', '.csv', '.tsv'].includes(extension)) throw new Error('PaperBridge cannot preview this attachment type. Export the Markdown bundle to access the file.');
  if (asset.size > maxMarkdownBytes) throw new Error('This attachment exceeds the 64 MiB text preview limit.');
  return { ...info, kind: markdown ? 'markdown' : 'text', content: markdown ? readMineruMarkdown(asset.file, directory) : fs.readFileSync(asset.file, 'utf8') };
}

module.exports = { openPaperAttachment };
