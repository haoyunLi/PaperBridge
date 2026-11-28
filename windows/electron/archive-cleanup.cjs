const fs = require('node:fs');
const path = require('node:path');
const { writeFileAtomically } = require('./atomic-file.cjs');

const managedName = /^[a-f0-9]{64}\.pdf(?:\.\d+\.[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.tmp)?$/;

const archiveRecord = 'pending-archived-pdfs.json';

function revisionOf(stat) {
  return [stat.dev, stat.ino, stat.birthtimeNs, stat.size, stat.mtimeNs].join(':');
}

class ArchiveCleanup {
  constructor(root, directory, papers) {
    this.directory = directory;
    this.papers = papers;
    this.record = path.join(root, archiveRecord);
  }

  pending(strict = false) {
    try {
      if (!fs.lstatSync(this.record, { throwIfNoEntry: false })?.isFile()) return [];
      const saved = JSON.parse(fs.readFileSync(this.record, 'utf8'));
      if (!Array.isArray(saved)) throw Error('The archived PDF cleanup record is unreadable.');
      return saved.filter(item => typeof item?.name === 'string' &&
        managedName.test(item.name) && typeof item.revision === 'string');
    } catch (error) {
      if (strict) throw error;
      return [];
    }
  }

  pendingCount() {
    const records = this.pending();
    if (!records.length) return 0;
    try {
      const folder = fs.lstatSync(this.directory, { throwIfNoEntry: false });
      if (!folder) return 0;
      if (!folder.isDirectory()) return records.length;
      return records.filter(item => fs.lstatSync(path.join(this.directory, item.name), { throwIfNoEntry: false })?.isFile()).length;
    } catch { return records.length; }
  }

  savePending(records) {
    if (records.length) writeFileAtomically(this.record, JSON.stringify(records), { temporaryBasename: '.paperbridge-cleanup' });
    else fs.rmSync(this.record, { force: true });
  }

  snapshot() {
    const location = fs.lstatSync(this.directory, { throwIfNoEntry: false });
    if (!location) return [];
    if (!location.isDirectory()) throw new Error('The PDF archive is not a local directory.');
    const records = [];
    for (const entry of fs.readdirSync(this.directory, { withFileTypes: true })) {
      if (!entry.isFile() || !managedName.test(entry.name)) continue;
      const stat = fs.lstatSync(path.join(this.directory, entry.name), { bigint: true, throwIfNoEntry: false });
      if (stat?.isFile()) records.push({ name: entry.name, revision: revisionOf(stat) });
    }
    return records;
  }

  remove() {
    const result = { archivedPdfsRemoved: 0 };
    const remaining = [];
    let kept = 0;
    try {
      const location = fs.lstatSync(this.directory, { throwIfNoEntry: false });
      if (location && !location.isDirectory()) throw new Error('The PDF archive is not a local directory.');
      for (const item of location ? this.pending(true) : []) {
        const file = path.join(this.directory, item.name);
        try {
          const stat = fs.lstatSync(file, { bigint: true, throwIfNoEntry: false });
          if (!stat?.isFile()) continue;
          const paper = path.join(this.papers, item.name.slice(0, 64) + '.json');
          if (revisionOf(stat) !== item.revision || fs.existsSync(paper) || fs.existsSync(paper + '.backup')) { kept++; continue; }
          fs.unlinkSync(file);
          if (item.name.endsWith('.pdf')) result.archivedPdfsRemoved++;
        } catch (error) {
          if (error.code === 'ENOENT') continue;
          result.pdfCleanupError ||= error.message;
          remaining.push(item);
        }
      }
      this.savePending(remaining);
    } catch (error) {
      // Workspace removal has already committed. An archive error must not reopen a removed paper.
      result.pdfCleanupError = error.message;
    }
    if (kept) result.archivedPdfsKept = kept;
    if (result.pdfCleanupError) result.pendingArchivedPdfs = this.pendingCount();
    return result;
  }
}

module.exports = { ArchiveCleanup, archiveRecord };

