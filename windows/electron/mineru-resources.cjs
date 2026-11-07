const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomBytes } = require('node:crypto');
const { assetFile, mineruResultManifest } = require('./markdown-assets.cjs');
const { mineruMarkdownFiles, readMineruMarkdown } = require('./mineru-output.cjs');

const resultsDirectory = 'mineru-results';
const digest = value => createHash('sha256').update(value).digest('hex');
const validResourceId = value => typeof value === 'string' && /^[a-f0-9]{16}$/.test(value);

function localDirectory(parent, name) {
  const directory = path.join(parent, name);
  if (!fs.lstatSync(directory).isDirectory()) {
    throw new Error('The MinerU resource directory is not a local folder.');
  }
  const resolved = fs.realpathSync(directory);
  if (path.dirname(resolved) !== parent) throw new Error('The MinerU resource directory is outside the workspace.');
  return resolved;
}

function resultDirectory(root, resourceId) {
  if (!validResourceId(resourceId)) throw new Error('Invalid MinerU resource ID.');
  return localDirectory(localDirectory(fs.realpathSync(root), resultsDirectory), resourceId);
}

function removeMineruResult(root, resourceId) {
  try { fs.rmSync(resultDirectory(root, resourceId), { recursive: true }); }
  catch { /* Unreferenced results are safe to leave for later cleanup. */ }
}

function keepMineruResult(root, paperId, markdownFile, markdown) {
  const workspace = fs.realpathSync(root);
  fs.mkdirSync(path.join(workspace, resultsDirectory), { recursive: true });
  const results = localDirectory(workspace, resultsDirectory);
  const resourceId = randomBytes(8).toString('hex');
  const directory = path.join(results, resourceId);
  const name = path.basename(markdownFile);
  fs.mkdirSync(directory);
  try {
    fs.cpSync(path.dirname(markdownFile), directory, { recursive: true, force: false, errorOnExist: true });
    const source = fs.readFileSync(path.join(directory, name));
    const manifest = { paperId, name, markdownDigest: digest(markdown), sourceDigest: digest(source) };
    fs.writeFileSync(path.join(directory, mineruResultManifest), JSON.stringify(manifest), { flag: 'wx' });
    return resourceId;
  } catch (error) {
    removeMineruResult(root, resourceId);
    throw error;
  }
}

function findPaperMineruMarkdown(root, paper) {
  if (typeof paper?.id !== 'string' || !/^[a-f0-9]{64}$/.test(paper.id) || !paper.mineruMarkdown) return null;
  try {
    if (Object.hasOwn(paper, 'mineruResourceId')) {
      const directory = resultDirectory(root, paper.mineruResourceId);
      const marker = assetFile(directory, mineruResultManifest);
      if (!marker || marker.size > 4096) return null;
      const manifest = JSON.parse(fs.readFileSync(marker.file, 'utf8'));
      if (manifest.paperId !== paper.id || manifest.markdownDigest !== digest(paper.mineruMarkdown)) return null;
      if (typeof manifest.name !== 'string' || manifest.name !== path.basename(manifest.name) || !/\.md$/i.test(manifest.name)) return null;
      const file = assetFile(directory, manifest.name)?.file;
      return file && digest(fs.readFileSync(file)) === manifest.sourceDigest ? file : null;
    }

    const legacy = localDirectory(localDirectory(fs.realpathSync(root), 'mineru'), paper.id);
    let match = null;
    for (const file of mineruMarkdownFiles(legacy)) {
      if (!assetFile(legacy, path.relative(legacy, file))) continue;
      try { if (readMineruMarkdown(file) !== paper.mineruMarkdown) continue; }
      catch { continue; }
      if (match) return null;
      match = file;
    }
    return match;
  } catch { return null; }
}

module.exports = { keepMineruResult, findPaperMineruMarkdown, removeMineruResult };
