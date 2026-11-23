const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const repository = 'https://github.com/haoyunLi/PaperBridge';
const workflow = '.github/workflows/windows.yml';
const maximumProofBytes = 256 * 1024;

function releaseProof(download) {
  const version = /^windows-v(\d+\.\d+\.\d+)$/.exec(download.tag)?.[1];
  if (!version || !['Setup', 'Portable'].some(kind => download.file.name === 'PaperBridge-Windows-' + version + '-x64-' + kind + '.exe') ||
      !/^[a-f0-9]{64}$/.test(download.file.sha256)) throw new Error('Invalid Windows update identity.');
  return 'PaperBridge-Windows-' + version + '-provenance.json';
}

async function verifyBundle(bundle, download, signal) {
  releaseProof(download);
  const ref = 'refs/tags/' + download.tag;
  const identity = repository + '/' + workflow + '@' + ref;
  // Each verification starts from the Sigstore trust roots shipped in the app.
  // A cached bundle or a writable download folder cannot supply its own roots.
  const trust = await fs.mkdtemp(path.join(os.tmpdir(), 'paperbridge-trust-'));
  try {
    const { createVerifier } = require('./sigstore-verifier.cjs');
    const options = { certificateIssuer: 'https://token.actions.githubusercontent.com', certificateIdentityURI: identity,
      // Fulcio encodes the runner environment and immutable repository ID as DER UTF8Strings.
      certificateOIDs: { '1.3.6.1.4.1.57264.1.11': '\x0c\x0dgithub-hosted', '1.3.6.1.4.1.57264.1.15': '\x0c\x0a1206422036' },
      tufCachePath: trust, timeout: 4000, retry: 0 };
    try {
      (await createVerifier({ ...options, tufForceCache: true })).verify(bundle);
    } catch (cause) {
      signal.throwIfAborted();
      if (!['CERTIFICATE_ERROR', 'PUBLIC_KEY_ERROR'].includes(cause.code)) throw cause;
      // A rotated authority can be retrieved through Sigstore's signed TUF metadata.
      (await createVerifier(options)).verify(bundle);
    }
    signal.throwIfAborted();
    const envelope = bundle.dsseEnvelope;
    if (envelope?.payloadType !== 'application/vnd.in-toto+json') throw new Error('Expected a signed in-toto statement.');
    const statement = JSON.parse(Buffer.from(envelope.payload, 'base64').toString('utf8'));
    const build = statement.predicate?.buildDefinition;
    const source = build?.externalParameters?.workflow;
    if (statement._type !== 'https://in-toto.io/Statement/v1' || statement.predicateType !== 'https://slsa.dev/provenance/v1' ||
        build?.buildType !== 'https://actions.github.io/buildtypes/workflow/v1' || source?.repository !== repository ||
        source?.path !== workflow || source?.ref !== ref || statement.predicate?.runDetails?.builder?.id !== identity ||
        build?.internalParameters?.github?.runner_environment !== 'github-hosted' ||
        !statement.subject?.some(item => item.name === download.file.name && item.digest?.sha256 === download.file.sha256)) {
      throw new Error('The signed release does not identify this PaperBridge download.');
    }
  } finally {
    await fs.rm(trust, { recursive: true, force: true });
  }
}

async function readPublicProof(url, signal, fetchImpl) {
  const request = AbortSignal.any([signal, AbortSignal.timeout(20000)]);
  const response = await fetchImpl(url, { signal: request, headers: { Accept: 'application/octet-stream' } });
  if (!response.ok) { await response.body?.cancel(); throw new Error('GitHub returned HTTP ' + response.status + '.'); }
  const parts = [];
  let bytes = 0;
  for await (const part of response.body) {
    bytes += part.length;
    if (bytes > maximumProofBytes) throw new Error('Build proof exceeds the size limit.');
    parts.push(part);
  }
  return JSON.parse(Buffer.concat(parts).toString('utf8'));
}

async function verifyUpdateProvenance(download, directory, signal, fetchImpl = fetch) {
  const name = releaseProof(download);
  const cached = path.join(directory, name);
  try {
    const stat = await fs.lstat(cached);
    if (stat.isFile() && stat.size <= maximumProofBytes) {
      await verifyBundle(JSON.parse(await fs.readFile(cached, 'utf8')), download, signal);
      return;
    }
  } catch { signal.throwIfAborted(); }
  const url = repository + '/releases/download/' + download.tag + '/' + name;
  let proof;
  try {
    proof = await readPublicProof(url, signal, fetchImpl);
    await verifyBundle(proof, download, signal);
  } catch (cause) {
    signal.throwIfAborted();
    throw new Error('Could not verify the GitHub build proof for this Windows update. ' + cause.message);
  }
  const temporary = await fs.mkdtemp(path.join(directory, '.partial-'));
  try {
    const staged = path.join(temporary, name);
    await fs.writeFile(staged, JSON.stringify(proof), { signal });
    signal.throwIfAborted();
    await fs.rename(staged, cached);
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
}

module.exports = { verifyUpdateProvenance, verifyBundle };
