const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { compareVersions } = require('./updates.cjs');
const { verifyUpdateProvenance } = require('./update-provenance.cjs');

async function matchesRelease(filename, file, signal) {
  const stat = await fs.promises.lstat(filename).catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (!stat?.isFile() || stat.size !== file.size) return false;
  const hash = crypto.createHash('sha256');
  for await (const bytes of fs.createReadStream(filename, { signal })) hash.update(bytes);
  return hash.digest('hex') === file.sha256;
}

// A dedicated Chromium session owns all its downloads, including late responses
// from a request cancelled before its DownloadItem existed.
function chromiumTransfer(session) {
  let pending;
  session.on('will-download', (event, item) => {
    const task = pending;
    const chain = item.getURLChain();
    if (!task || task.item || chain[0] !== task.url || !chain.every(url => url.startsWith('https://'))) {
      event.preventDefault();
      return;
    }
    task.item = item;
    item.setSavePath(task.destination);
    item.on('updated', () => {
      const received = item.getReceivedBytes();
      if (received > task.size) return task.stop(new Error('The download exceeds the published size.'));
      if (received !== task.received) { task.received = received; task.watch(); task.progress(received); }
    });
    item.once('done', (_event, state) => {
      if (state === 'completed') task.finish();
      else task.finish(new Error('Windows update download ' + state + '.'));
    });
  });
  return (download, destination, signal, progress) => new Promise((resolve, reject) => {
    signal.throwIfAborted();
    let timer;
    const abort = () => task.stop(signal.reason);
    const task = {
      url: download.url, size: download.file.size, destination, progress, received: 0, item: null,
      watch() {
        clearTimeout(timer);
        timer = setTimeout(() => task.stop(new Error('The Windows update download stopped responding.')), 90000);
      },
      stop(error) { task.finish(error); task.item?.cancel(); },
      finish(error) {
        clearTimeout(timer);
        if (pending === task) pending = null;
        signal.removeEventListener('abort', abort);
        if (error) reject(error); else resolve();
      }
    };
    pending = task;
    signal.addEventListener('abort', abort, { once: true });
    task.watch();
    try { session.downloadURL(task.url); } catch (error) { task.finish(error); }
  });
}

class UpdateDownload {
  constructor({ directory, transfer, notify, reveal, currentVersion, runningPortable, verifyProvenance = verifyUpdateProvenance }) {
    this.directory = directory;
    this.transfer = transfer;
    this.verifyProvenance = verifyProvenance;
    this.notify = notify;
    this.reveal = reveal;
    this.state = { phase: 'idle' };
    // Cleanup may encounter a locked installer. It runs independently of first
    // window creation, and finishes before a new transfer can create a partial.
    this.cleanup = currentVersion ? this.clean(currentVersion, runningPortable).catch(() => {}) : Promise.resolve();
  }

  publish(state) {
    this.state = state;
    this.notify(state);
  }

  cancel(tag) {
    // A user action applies only to the transfer still shown in the reader.
    if (tag !== undefined && (this.state.phase !== 'downloading' || this.state.tag !== tag)) return false;
    this.controller?.abort();
    this.controller = null;
    this.active = null;
    if (tag === undefined) this.download = null;
    this.manual = false;
    this.publish(tag === undefined ? { phase: 'idle' } : { tag, phase: 'cancelled' });
    return true;
  }

  matches(download) {
    const previous = this.download;
    return Boolean(previous && download && previous.url === download.url &&
      previous.file?.sha256 === download.file?.sha256 && previous.file?.size === download.file?.size);
  }

  prepare(download, { manual = false } = {}) {
    if (this.matches(download)) {
      if (manual) this.manual = true;
      if (this.active) return this.active;
      if (this.state.phase === 'ready' || (!manual && this.state.phase === 'cancelled')) return Promise.resolve();
    }
    this.cancel();
    this.manual = manual;
    this.download = download;
    if (!download.file) {
      this.publish({ tag: download.tag, phase: 'unverified' });
      return Promise.resolve();
    }
    const controller = new AbortController();
    this.controller = controller;
    this.publish({ tag: download.tag, phase: 'downloading', percent: 0 });
    this.active = this.save(download, controller.signal).then(() => {
      if (this.controller === controller) this.publish({ tag: download.tag, phase: 'ready' });
    }, error => {
      if (this.controller === controller) this.publish({ tag: download.tag, phase: 'failed', message: error.message });
    }).finally(() => {
      if (this.controller === controller) { this.controller = null; this.active = null; }
    });
    return this.active;
  }

  async save(download, signal) {
    await this.cleanup;
    signal.throwIfAborted();
    const { file, tag } = download;
    const final = path.join(this.directory, file.name);
    if (await matchesRelease(final, file, signal)) return this.verifyProvenance(download, this.directory, signal);
    signal.throwIfAborted();
    await fs.promises.mkdir(this.directory, { recursive: true });
    const temporary = await fs.promises.mkdtemp(path.join(this.directory, '.partial-'));
    // Keep space for Windows to attach the Internet zone stream before the verified file is renamed.
    const staged = path.join(temporary, 'update.exe');
    try {
      signal.throwIfAborted();
      await this.transfer(download, staged, signal, received => {
        const percent = Math.min(99, Math.floor(received * 100 / file.size));
        if (!signal.aborted && percent !== this.state.percent) this.publish({ tag, phase: 'downloading', percent });
      });
      if (!await matchesRelease(staged, file, signal)) throw new Error('The downloaded file failed the GitHub size or SHA-256 check.');
      await this.verifyProvenance(download, this.directory, signal);
      signal.throwIfAborted();
      await fs.promises.rename(staged, final);
    } finally {
      await fs.promises.rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }

  async verifiedFile(tag) {
    const download = this.download;
    if (this.state.phase !== 'ready' || download?.tag !== tag) throw new Error('No verified download is ready for this release.');
    const filename = path.join(this.directory, download.file.name);
    if (!await matchesRelease(filename, download.file)) {
      if (this.download === download) this.publish({ tag, phase: 'failed', message: 'The saved update changed or was moved. Check again to download it.' });
      throw new Error('The saved update no longer matches the release.');
    }
    if (this.download !== download) throw new Error('The available update changed.');
    return filename;
  }

  async show(tag) {
    this.reveal(await this.verifiedFile(tag));
  }

  async openInstaller(tag, openPath) {
    const version = /^windows-v(\d+\.\d+\.\d+)$/.exec(tag)?.[1];
    if (!version || this.download?.file?.name !== `PaperBridge-Windows-${version}-x64-Setup.exe`) throw new Error('A verified Setup update is required.');
    if (this.openingInstaller) {
      if (this.openingInstaller.download === this.download) return this.openingInstaller.completion;
      throw new Error('Another Windows Setup is already opening. Wait for Windows and try again.');
    }
    const completion = this.verifiedFile(tag).then(async filename => {
      const message = await openPath(filename);
      if (message) throw new Error(message);
    }).finally(() => { this.openingInstaller = null; });
    this.openingInstaller = { download: this.download, completion };
    return completion;
  }

  async clean(currentVersion, runningPortable) {
    const entries = await fs.promises.readdir(this.directory, { withFileTypes: true }).catch(error => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    for (const entry of entries) {
      const file = path.join(this.directory, entry.name);
      const version = /^PaperBridge-Windows-(\d+\.\d+\.\d+)-(?:x64-(?:Setup|Portable)\.exe|provenance\.json)$/.exec(entry.name)?.[1];
      if (entry.isDirectory() && /^\.partial-[a-zA-Z0-9]{6}$/.test(entry.name)) {
        await fs.promises.rm(file, { recursive: true, force: true });
      } else if (entry.isFile() && version && compareVersions(version, currentVersion) < 0 && file.toLowerCase() !== runningPortable?.toLowerCase()) {
        await fs.promises.unlink(file);
      }
    }
  }
}

module.exports = { UpdateDownload, chromiumTransfer };
