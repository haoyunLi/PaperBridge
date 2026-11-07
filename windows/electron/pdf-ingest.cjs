const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function validatedPdfBytes(bytes) {
  const source = Buffer.from(bytes);
  if (!source.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new Error('This file is not a valid PDF.');
  return source;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function atomicWrite(file, bytes, { fileSystem = fs, temporaryId = crypto.randomUUID } = {}) {
  fileSystem.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${temporaryId()}.tmp`;
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

function importPdfAsset(bytes, name, pdfPath, options = {}) {
  const source = validatedPdfBytes(bytes);
  const id = sha256(source);
  const destination = pdfPath(id);
  const fileSystem = options.fileSystem || fs;
  const matches = fileSystem.existsSync(destination) && sha256(fileSystem.readFileSync(destination)) === id;
  if (!matches) atomicWrite(destination, source, options);
  return { id, fingerprint: id, name: path.basename(String(name || 'Paper.pdf')), bytes: new Uint8Array(source) };
}

function independentPdfAsset(bytes, name, pdfPath, options = {}) {
  const source = validatedPdfBytes(bytes);
  const fingerprint = sha256(source);
  const fileSystem = options.fileSystem || fs;
  const randomUUID = options.randomUUID || crypto.randomUUID;
  for (let attempt = 0; attempt < 4; attempt++) {
    const id = sha256(`${fingerprint}${randomUUID()}`);
    if (fileSystem.existsSync(pdfPath(id))) continue;
    atomicWrite(pdfPath(id), source, options);
    return { id, fingerprint, name: `${path.basename(String(name || 'Paper.pdf'))} (new extraction)`,
      bytes: new Uint8Array(source), existing: null };
  }
  throw new Error('Could not allocate an independent PDF copy. Try again.');
}

async function selectIndependentPdfAsset({ showOpenDialog, owner, pdfPath, fileSystem = fs, ...options }) {
  const result = await showOpenDialog(owner, {
    title: 'Re-extract PDF as New Copy',
    buttonLabel: 'Extract New Copy',
    message: 'Choose the original PDF to parse with the current parser settings. A separate library copy will be created; saved edits, translations, and notes will not be replaced.',
    properties: ['openFile'],
    filters: [{ name: 'PDF documents', extensions: ['pdf'] }]
  });
  if (result.canceled || !result.filePaths?.[0]) return null;
  const selected = result.filePaths[0];
  return independentPdfAsset(fileSystem.readFileSync(selected), path.basename(selected), pdfPath,
    { ...options, fileSystem });
}

module.exports = { validatedPdfBytes, sha256, atomicWrite, importPdfAsset, independentPdfAsset, selectIndependentPdfAsset };
