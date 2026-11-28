const fs = require('node:fs');
const path = require('node:path');
const { writeFileAtomically } = require('./atomic-file.cjs');

const managedName = /^[a-f0-9]{64}\.pdf(?:\.\d+\.[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.tmp)?$/;

class ArchiveCleanup {
  constructor(root, directory, papers) {
    this.directory = directory;
    this.papers = papers;
    this.record = path.join(root, 'pending-archived-pdfs.json');
  }

  pending() {
    try {
      if (!fs.lstatSync(this.record, { throwIfNoEntry: false })?.isFile()) return [];
      const saved = JSON.parse(fs.readFileSync(this.record, 'utf8'));
      return Array.isArray(saved) ? saved.filter(item => typeof item?.name === 'string' &&
        managedName.test(item.name) && typeof item.revision === 'string') : [];
    } catch { return []; }
  }

  savePending(records) {
    if (records.length) writeFileAtomically(this.record, JSON.stringify(records), { temporaryBasename: '.paperbridge-cleanup' });
    else fs.rmSync(this.record, { force: true });
  }

  keepAll() {
    // A subsequent reset with the default choice also cancels earlier cleanup requests.
    try { this.savePending([]); return { archivedPdfsRemoved: 0 }; }
    catch (error) { return { archivedPdfsRemoved: 0, pdfCleanupError: error.message }; }
  }

  remove({ retry = false } = {}) {
    const result = { archivedPdfsRemoved: 0 };
    const remaining = [];
    let kept = 0;
    try {
      const location = fs.lstatSync(this.directory, { throwIfNoEntry: false });
      if (location && !location.isDirectory()) throw new Error('The PDF archive is not a local directory.');
      const candidates = !location ? [] : retry ? this.pending() : fs.readdirSync(this.directory, { withFileTypes: true })
        .filter(item => item.isFile() && managedName.test(item.name));
      for (const item of candidates) {
        const file = path.join(this.directory, item.name);
        let revision = item.revision;
        try {
          const stat = fs.lstatSync(file, { bigint: true, throwIfNoEntry: false });
          if (!stat?.isFile()) continue;
          const current = [stat.dev, stat.ino, stat.birthtimeNs, stat.size, stat.mtimeNs].join(':');
          if (retry) {
            const paper = path.join(this.papers, item.name.slice(0, 64) + '.json');
            if (current !== revision || fs.existsSync(paper) || fs.existsSync(paper + '.backup')) { kept++; continue; }
          }
          revision = current;
          fs.unlinkSync(file);
          if (item.name.endsWith('.pdf')) result.archivedPdfsRemoved++;
        } catch (error) {
          if (error.code === 'ENOENT') continue;
          result.pdfCleanupError ||= error.message;
          if (revision) remaining.push({ name: item.name, revision });
        }
      }
      this.savePending(remaining);
    } catch (error) {
      // Workspace removal has already committed. An archive error must not reopen a removed paper.
      result.pdfCleanupError = error.message;
    }
    if (kept) result.archivedPdfsKept = kept;
    if (result.pdfCleanupError) result.pendingArchivedPdfs = this.pending().length;
    return result;
  }
}

module.exports = { ArchiveCleanup };

