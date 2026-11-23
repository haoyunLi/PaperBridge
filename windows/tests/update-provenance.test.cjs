const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { verifyUpdateProvenance, verifyBundle } = require('../electron/update-provenance.cjs');
// Genuine public build attestation for the two executables in windows-v0.2.91.
const proof = require('./fixtures/windows-v0.2.91-provenance.json');
const tag = 'windows-v0.2.91';
const setup = { tag, file: { name: 'PaperBridge-Windows-0.2.91-x64-Setup.exe', sha256: '65ea8a451305a658a27217b991c7f8defc8b4d7e0a09d6f36f4c6076b2cb9c5a' } };
const portable = { tag, file: { name: 'PaperBridge-Windows-0.2.91-x64-Portable.exe', sha256: 'e9468ee679aba918ff3ea59d4499578595499d95135cb2740274abfa0910d9b4' } };
const signal = new AbortController().signal;

test('the genuine GitHub attestation verifies both release EXEs offline against fresh trust roots', async () => {
  await verifyBundle(proof, setup, signal);
  await verifyBundle(proof, portable, signal);
  const other = { tag: 'windows-v0.2.90', file: { ...setup.file, name: setup.file.name.replace('.91', '.90') } };
  await assert.rejects(verifyBundle(proof, other, signal));
  await assert.rejects(verifyBundle(proof, { tag, file: { name: setup.file.name, sha256: portable.file.sha256 } }, signal), /does not identify/);
  const modified = structuredClone(proof);
  const statement = JSON.parse(Buffer.from(modified.dsseEnvelope.payload, 'base64'));
  statement.subject[0].digest.sha256 = 'a'.repeat(64);
  modified.dsseEnvelope.payload = Buffer.from(JSON.stringify(statement)).toString('base64');
  await assert.rejects(verifyBundle(modified, portable, signal));
  const missingLog = structuredClone(proof);
  missingLog.verificationMaterial.tlogEntries = [];
  await assert.rejects(verifyBundle(missingLog, setup, signal));
});

test('verified proofs survive restart, are rechecked offline, and corrupt cached proofs recover from GitHub', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'paperbridge-update-proof-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  let requests = 0;
  const name = 'PaperBridge-Windows-0.2.91-provenance.json';
  const fetchProof = async url => {
    assert.equal(url, 'https://github.com/haoyunLi/PaperBridge/releases/download/' + tag + '/' + name);
    requests++;
    return Response.json(proof);
  };
  await verifyUpdateProvenance(setup, dir, signal, fetchProof);
  await verifyUpdateProvenance(portable, dir, signal, async () => { throw new Error('offline'); });
  assert.equal(requests, 1);
  await fs.writeFile(path.join(dir, name), '{}');
  await assert.rejects(verifyUpdateProvenance(setup, dir, signal, async () => new Response(null, { status: 404 })), /HTTP 404/);
  await assert.rejects(verifyUpdateProvenance(setup, dir, signal, async () => new Response(Buffer.alloc(256 * 1024 + 1))), /size limit/);
  await verifyUpdateProvenance(portable, dir, signal, fetchProof);
  assert.equal(requests, 2);
  assert.deepEqual(await fs.readdir(dir), [name]);
});
