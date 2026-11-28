const fs = require('node:fs');
const path = require('node:path');
const { writeFileAtomically } = require('./atomic-file.cjs');

// Only these records belong to Clear Saved Data. Keep user files, model installations,
// the separately managed encrypted key, and archived PDFs outside this transaction.
const managed = [
  ['papers', /^[a-f0-9]{64}\.json(?:\.backup)?(?:\.\d+\.tmp)?$/, 'file'],
  ['', /^(?:settings|glossary|updates|last-paper|library-index)\.json(?:\.backup)?(?:\.\d+\.tmp)?$/, 'file'],
  ['mineru-results', /^[a-f0-9]{16}$/, 'directory'],
  ['mineru', /^[a-f0-9]{64}$/, 'directory'],
  ['', /^pdf-page-cache$/, 'directory']
];
const transactionName = /^\.paperbridge-clear-[A-Za-z0-9]{6}$/;
const stat = name => fs.lstatSync(name, { throwIfNoEntry: false });

function savedPaths(root) {
  const entries = [];
  for (const [parent, pattern, type] of managed) {
    const directory = path.join(root, parent);
    if (!stat(directory)?.isDirectory()) continue;
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      if (pattern.test(item.name) && (type === 'file' ? item.isFile() : item.isDirectory())) {
        entries.push(parent ? parent + '/' + item.name : item.name);
      }
    }
  }
  return entries;
}

function validEntry(entry) {
  if (typeof entry !== 'string' || entry.includes('\\')) return false;
  const parent = path.posix.dirname(entry), name = path.posix.basename(entry);
  return managed.some(([dir, pattern]) => (dir || '.') === parent && pattern.test(name) && entry === (dir ? dir + '/' : '') + name);
}

function settle(root, transaction, entries, committed) {
  let problem;
  for (let i = entries.length - 1; i >= 0; i--) {
    const staged = path.join(transaction, String(i));
    try {
      if (!stat(staged)) continue;
      if (committed) fs.rmSync(staged, { recursive: true, force: true });
      else {
        const original = path.join(root, entries[i]);
        // A newly created record or a replacement junction must never be overwritten during recovery.
        if (!stat(path.dirname(original))?.isDirectory() || stat(original)) throw Error('The saved location changed.');
        fs.renameSync(staged, original);
      }
    } catch (error) { problem ||= error; }
  }
  if (problem) throw problem;
  if (committed) fs.unlinkSync(path.join(transaction, 'committed'));
  fs.unlinkSync(path.join(transaction, 'records.json'));
  fs.rmdirSync(transaction);
}

function recoverWorkspaceFiles(root) {
  const result = { restoreWarning: '', cleanupWarning: '' };
  if (!fs.existsSync(root)) return result;
  let folders;
  try { folders = fs.readdirSync(root, { withFileTypes: true }); }
  catch { result.restoreWarning = 'Windows could not read the PaperBridge workspace. Check access to ' + root + ' and reopen PaperBridge.'; return result; }
  for (const folder of folders) {
    if (!folder.isDirectory() || !transactionName.test(folder.name)) continue;
    const transaction = path.join(root, folder.name), journal = path.join(transaction, 'records.json');
    if (!stat(journal)?.isFile()) continue;
    const committed = Boolean(stat(path.join(transaction, 'committed'))?.isFile());
    try {
      const entries = JSON.parse(fs.readFileSync(journal, 'utf8'));
      if (!Array.isArray(entries) || !entries.every(validEntry) || new Set(entries).size !== entries.length) throw Error('Invalid recovery record.');
      settle(root, transaction, entries, committed);
    } catch {
      if (committed) result.cleanupWarning = 'Some removed workspace files are still in use. Close the app using them and reopen PaperBridge to finish cleanup.';
      else result.restoreWarning = 'PaperBridge kept files from an interrupted data removal in ' + transaction + '. Close apps using the workspace and reopen PaperBridge to restore them.';
    }
  }
  return result;
}

function clearWorkspaceFiles(root) {
  const previous = recoverWorkspaceFiles(root);
  if (previous.restoreWarning) throw Error(previous.restoreWarning);
  const entries = savedPaths(root);
  if (!entries.length) return previous.cleanupWarning;
  const transaction = fs.mkdtempSync(path.join(root, '.paperbridge-clear-'));
  const journal = path.join(transaction, 'records.json');
  try { writeFileAtomically(journal, JSON.stringify(entries)); }
  catch (error) { try { fs.rmdirSync(transaction); } catch {} throw error; }
  try {
    for (const [i, relative] of entries.entries()) {
      const original = path.join(root, relative);
      if (!stat(path.dirname(original))?.isDirectory()) throw Error('The workspace folder changed during removal.');
      fs.renameSync(original, path.join(transaction, String(i)));
    }
    // An empty file created exclusively marks the single commit point. Before it exists
    // an interrupted process restores every moved entry. Afterwards it only purges staged data.
    fs.writeFileSync(path.join(transaction, 'committed'), '', { flag: 'wx' });
  } catch (error) {
    try { settle(root, transaction, entries, false); }
    catch { throw Error('PaperBridge kept files from the interrupted removal in ' + transaction + '. Close apps using the workspace and reopen PaperBridge.'); }
    if (['EBUSY', 'EACCES', 'EPERM'].includes(error.code)) throw Error('Windows could not clear the workspace. Close any app using these files, then try again. Your saved papers are available.');
    throw error;
  }
  try { settle(root, transaction, entries, true); }
  catch { return 'Some removed workspace files are still in use. Close the app using them and reopen PaperBridge to finish cleanup.'; }
  return previous.cleanupWarning;
}

module.exports = { clearWorkspaceFiles, recoverWorkspaceFiles };
