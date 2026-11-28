const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

function writeFileAtomically(file, bytes, { fileSystem = fs, temporaryId = randomUUID, temporaryBasename = '.paperbridge-export' } = {}) {
  const temporary = path.join(path.dirname(file), temporaryBasename + '.' + process.pid + '.' + temporaryId() + '.tmp');
  let descriptor = null;
  let ownsTemporary = false;
  try {
    descriptor = fileSystem.openSync(temporary, 'wx');
    ownsTemporary = true;
    fileSystem.writeFileSync(descriptor, bytes);
    fileSystem.closeSync(descriptor);
    descriptor = null;
    fileSystem.renameSync(temporary, file);
  } catch (error) {
    if (descriptor !== null) try { fileSystem.closeSync(descriptor); } catch { /* Preserve the original write error. */ }
    try { if (ownsTemporary && fileSystem.existsSync(temporary)) fileSystem.unlinkSync(temporary); } catch { /* Preserve the original write error. */ }
    throw error;
  }
}

module.exports = { writeFileAtomically };
