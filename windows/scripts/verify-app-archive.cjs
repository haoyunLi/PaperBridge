const asar = require('@electron/asar');
const { createHash } = require('node:crypto');
const path = require('node:path');

function verifyAppArchive(archive, expectedVersion) {
  asar.uncache(archive);
  let files = 0;
  function verifyDirectory(directory, prefix) {
    for (const [name, entry] of Object.entries(directory.files)) {
      const filename = path.join(prefix, name);
      if (entry.files) {
        verifyDirectory(entry, filename);
      } else if (entry.link) {
        // The target's contents are verified under their own archive name.
        asar.statFile(archive, filename, true);
      } else {
        const bytes = asar.extractFile(archive, filename);
        const digest = createHash('sha256').update(bytes).digest('hex');
        if (entry.integrity?.algorithm !== 'SHA256' || entry.size !== bytes.length || digest !== entry.integrity.hash) {
          throw new Error('Packaged file failed its ASAR integrity check: ' + filename);
        }
        files++;
      }
    }
  }
  try {
    verifyDirectory(asar.getRawHeader(archive).header, '');
    const manifest = JSON.parse(asar.extractFile(archive, 'package.json'));
    if (manifest.version !== expectedVersion || manifest.main !== 'electron/main.cjs') {
      throw new Error('Unexpected reader version or entry point in the packaged application.');
    }
    for (const filename of [manifest.main, 'electron/preload.cjs', 'dist/index.html']) {
      if (!(asar.statFile(archive, path.normalize(filename)).size > 0)) throw new Error('Missing packaged reader file: ' + filename);
    }
    return files;
  } finally { asar.uncache(archive); }
}

module.exports = function afterPack({ appOutDir, packager }) {
  const count = verifyAppArchive(path.join(appOutDir, 'resources', 'app.asar'), packager.appInfo.version);
  console.log('Verified SHA-256 for ' + count + ' packaged application files.');
};
module.exports.verifyAppArchive = verifyAppArchive;

