// Exercise the packaged reader with genuine, independently downloaded release bytes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { _electron: electron } = require('playwright-core');
const { defaults } = require('../electron/storage.cjs');

async function run() {
  const [directory, version] = process.argv.slice(2);
  const root = path.resolve(__dirname, '..'), executablePath = process.env.PAPERBRIDGE_TEST_EXECUTABLE;
  const downloads = path.resolve(directory), tag = 'windows-v' + version, prefix = 'PaperBridge-Windows-' + version;
  const feed = { version, files: {} };
  for (const kind of ['Setup', 'Portable']) {
    const bytes = fs.readFileSync(path.join(downloads, prefix + '-x64-' + kind + '.exe'));
    feed.files[kind] = { size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  }
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'paperbridge-public-proof-'));
  try {
    for (const kind of ['Setup', 'Portable']) {
      const dir = path.join(workspace, kind), cache = path.join(dir, 'update-downloads');
      fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ ...defaults, autoCheckUpdates: false, autoDownloadUpdates: false, onboardingCompletedVersion: 1 }));
      const name = prefix + '-x64-' + kind + '.exe';
      const launch = () => electron.launch({ ...(executablePath && { executablePath }), cwd: root,
        args: [...(executablePath ? [] : ['.']), '--user-data-dir=' + path.join(dir, 'profile')],
        env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: dir, PORTABLE_EXECUTABLE_FILE: kind === 'Portable' ? path.join(dir, 'portable.exe') : '' } });
      for (const phase of ['download', 'offline', 'changed']) {
        const offline = phase !== 'download';
        if (phase === 'changed') {
          const proofFile = path.join(cache, prefix + '-provenance.json');
          const proof = JSON.parse(fs.readFileSync(proofFile, 'utf8'));
          const statement = JSON.parse(Buffer.from(proof.dsseEnvelope.payload, 'base64'));
          statement.subject[0].name += '.modified';
          proof.dsseEnvelope.payload = Buffer.from(JSON.stringify(statement)).toString('base64');
          fs.writeFileSync(proofFile, JSON.stringify(proof));
        }
        const app = await launch();
        try {
          const page = await app.firstWindow();
          await page.locator('.welcome').waitFor();
          await app.evaluate(({ app }, { feed, offline, fixture }) => {
            // Simulate a prior version discovering this precise release before its feed is promoted.
            app.getVersion = () => '0.0.1';
            const original = global.fetch;
            global.proofFetches = 0;
            global.fetch = (url, options) => {
              if (String(url).endsWith('/windows/latest-release.json')) return Promise.resolve(Response.json(feed));
              if (String(url).endsWith('-provenance.json')) {
                global.proofFetches++;
                if (offline) throw new Error('Offline after restart');
                if (fixture) return Promise.resolve(new Response(fixture));
              }
              return original(url, options);
            };
          }, { feed, offline, fixture: process.env.PAPERBRIDGE_PROOF_FIXTURE ? fs.readFileSync(process.env.PAPERBRIDGE_PROOF_FIXTURE, 'utf8') : null });
          if (!offline) {
            fs.mkdirSync(cache, { recursive: true });
            fs.copyFileSync(path.join(downloads, name), path.join(cache, name));
          }
          await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
          await page.getByRole('tab', { name: 'Updates', exact: true }).click();
          const settings = page.getByRole('dialog');
          await settings.getByRole('button', { name: 'Check now', exact: true }).click();
          await settings.getByRole('button', { name: kind === 'Setup' ? 'Download installer' : 'Download portable update', exact: true }).click();
          const status = settings.getByRole('status').filter({ hasText: /Download complete|Could not verify|failed/i });
          await status.waitFor({ timeout: 45000 });
          if (phase === 'changed') {
            assert.match(await status.innerText(), /Could not verify the GitHub build proof/);
            assert.equal(await settings.getByRole('button', { name: 'Open installer' }).count(), 0);
            assert.equal(await settings.getByRole('button', { name: 'Show downloaded update' }).count(), 0);
            assert.equal(await app.evaluate(() => global.proofFetches), 1);
            continue;
          }
          assert.equal(await status.innerText(), 'Download complete. SHA-256 and GitHub build proof verified.');
          assert.equal(await app.evaluate(() => global.proofFetches), offline ? 0 : 1);
          assert.ok(fs.existsSync(path.join(cache, prefix + '-provenance.json')));
          assert.equal(await settings.getByRole('button', { name: 'Show downloaded update' }).count(), 1);
        } finally { await app.close(); }
      }
      console.log(kind + ' verified the public signed proof, reused it offline and rejected a changed statement.');
    }
  } finally { await fs.promises.rm(workspace, { recursive: true, force: true, maxRetries: 4 }); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
