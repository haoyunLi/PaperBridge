const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

function replaceFileAtomically(file, { bytes, source }, { fileSystem = fs, temporaryId = randomUUID, temporaryBasename = '.paperbridge-export' } = {}) {
  const temporary = path.join(path.dirname(file), temporaryBasename + '.' + process.pid + '.' + temporaryId() + '.tmp');
  let descriptor = null;
  let ownsTemporary = false;
  try {
    descriptor = fileSystem.openSync(temporary, 'wx');
    ownsTemporary = true;
    if (source == null) fileSystem.writeFileSync(descriptor, bytes);
    fileSystem.closeSync(descriptor);
    descriptor = null;
    if (source != null) fileSystem.copyFileSync(source, temporary);
    fileSystem.renameSync(temporary, file);
  } catch (error) {
    if (descriptor !== null) try { fileSystem.closeSync(descriptor); } catch { /* Preserve the original write error. */ }
    try { if (ownsTemporary && fileSystem.existsSync(temporary)) fileSystem.unlinkSync(temporary); } catch { /* Preserve the original write error. */ }
    throw error;
  }
}

function writeFileAtomically(file, bytes, options) {
  return replaceFileAtomically(file, { bytes }, options);
}

function copyFileAtomically(source, file, options) {
  return replaceFileAtomically(file, { source }, options);
}

module.exports = { writeFileAtomically, copyFileAtomically };
