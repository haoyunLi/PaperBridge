const test = require('node:test');
const assert = require('node:assert/strict');
const { updateDownloadPage, publishDownloadPage } = require('../scripts/publish-download-page.cjs');

function homepage(version) {
  const base = 'https://github.com/haoyunLi/PaperBridge/releases';
  const tag = 'windows-v' + version;
  const prefix = base + '/download/' + tag + '/PaperBridge-Windows-' + version + '-x64-';
  return ['[Download Mac](' + base + '/latest)', '**Windows ' + version + ' x64** is free.',
    '<a href="' + prefix + 'Portable.exe">Portable</a>', '[Portable](' + prefix + 'Portable.exe)',
    '[Installer](' + prefix + 'Setup.exe)', '[Release](' + base + '/tag/' + tag + ')',
    'The changelog mentions 0.2.6 and links to ' + base + '/tag/windows-v0.2.60.'].join('\n');
}

test('refreshes the direct EXE links and version while preserving Mac, prose and unrelated tags', () => {
  assert.equal(updateDownloadPage(homepage('0.2.6'), '0.2.70'), homepage('0.2.70'));
  assert.equal(updateDownloadPage(homepage('0.2.70'), '0.2.6'), homepage('0.2.70'));
  assert.throws(() => updateDownloadPage(homepage('0.2.6').replace('x64-Setup.exe', 'Setup.zip'), '0.2.70'), /both EXE links/);
});

test('preserves simultaneous changes to main, checks both asset hashes, and never rolls the page back', async () => {
  const version = '0.2.70';
  const feed = { version, files: { Setup: { sha256: 'a'.repeat(64), size: 123 }, Portable: { sha256: 'b'.repeat(64), size: 100 } } };
  let published = feed, page = homepage('0.2.69'), writes = 0;
  const branch = 'windows/desktop-app';
  const repos = {
    async getContent({ ref, path }) {
      assert.equal(path, ref === 'main' ? 'README.md' : 'windows/latest-release.json');
      assert.ok([branch, 'main'].includes(ref));
      return { data: { sha: String(writes), content: Buffer.from(ref === 'main' ? page : JSON.stringify(published)).toString('base64') } };
    },
    async createOrUpdateFileContents({ path, branch, sha, content }) {
      assert.equal(path, 'README.md');
      assert.equal(branch, 'main');
      assert.equal(sha, String(writes++));
      if (writes === 1) {
        page += '\nA concurrent Mac edit.';
        throw Object.assign(new Error('Conflicting change'), { status: 409 });
      }
      page = Buffer.from(content, 'base64').toString('utf8');
    }
  };
  const run = () => publishDownloadPage({ repos, repo: { owner: 'haoyunLi', repo: 'PaperBridge' }, ref: 'refs/tags/windows-v' + version, feed });
  await run(); await run();
  assert.equal(page, homepage(version) + '\nA concurrent Mac edit.');
  assert.equal(writes, 2);
  published = { ...feed, files: { ...feed.files, Setup: { ...feed.files.Setup, sha256: 'c'.repeat(64) } } };
  await assert.rejects(run(), /must match/);
  published = { ...feed, version: '0.2.71' };
  await run();
  assert.equal(writes, 2);
});
