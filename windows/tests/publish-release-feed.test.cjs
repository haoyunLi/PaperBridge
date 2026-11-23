const test = require('node:test');
const assert = require('node:assert/strict');
const { publishReleaseFeed } = require('../scripts/publish-release-feed.cjs');

function fixture() {
  const feed = { version: '0.2.45', files: { Setup: { size: 20, sha256: 'a'.repeat(64) }, Portable: { size: 15, sha256: 'b'.repeat(64) } } };
  const tag = 'windows-v' + feed.version;
  const published = { tag_name: tag, assets: Object.entries(feed.files).map(([kind, file]) => {
    const name = 'PaperBridge-Windows-' + feed.version + '-x64-' + kind + '.exe';
    return { name, size: file.size, state: 'uploaded', digest: 'sha256:' + file.sha256,
      browser_download_url: 'https://github.com/haoyunLi/PaperBridge/releases/download/' + tag + '/' + name };
  }) };
  const state = { previous: { ...feed, version: '0.2.44' }, writes: [] };
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64');
  const repos = {
    getContent: async options => {
      assert.equal(options.ref, 'windows/desktop-app');
      return { data: { sha: 'current-blob', content: encode(state.previous) } };
    },
    getReleaseByTag: async options => { assert.equal(options.tag, tag); return { data: published }; },
    createOrUpdateFileContents: async options => {
      assert.equal(options.path, 'windows/latest-release.json'); assert.equal(options.branch, 'windows/desktop-app');
      assert.equal(options.sha, 'current-blob');
      state.writes.push(JSON.parse(Buffer.from(options.content, 'base64').toString('utf8')));
      state.previous = state.writes.at(-1);
    }
  };
  return { feed, published, state, repos, run: (promotePrerelease = false) => publishReleaseFeed({ repos, repo: { owner: 'haoyunLi', repo: 'PaperBridge' }, ref: 'refs/tags/' + tag, feed, promotePrerelease }) };
}

test('only publishes verified release bytes, idempotently', async () => {
  const f = fixture();
  await f.run(); await f.run();
  assert.deepEqual(f.state.writes, [f.feed]);
  f.published.assets[0].digest = 'sha256:' + 'c'.repeat(64);
  await assert.rejects(f.run(), /changed/);
  f.published.prerelease = true;
  await assert.rejects(f.run(), /changed/);
  assert.equal(f.state.writes.length, 1);
});

test('the fallback update channel only sees a prerelease after both public downloads have been verified', async () => {
  const f = fixture();
  Object.assign(f.published, { id: 712, prerelease: true });
  let promotions = 0;
  f.repos.updateRelease = async options => {
    assert.equal(options.release_id, 712);
    assert.equal(options.make_latest, 'false');
    assert.equal(options.prerelease, false);
    promotions++;
    f.published.prerelease = false;
    return { data: f.published };
  };
  const original = f.published.assets[0].digest;
  f.published.assets[0].digest = 'sha256:' + 'c'.repeat(64);
  await assert.rejects(f.run(true), /changed/);
  assert.equal(promotions, 0);
  f.published.assets[0].digest = original;
  await f.run(true);
  await f.run(true);
  assert.equal(promotions, 1);
  assert.deepEqual(f.state.writes, [f.feed]);
});

test('a draft or a newer verified channel prevents prerelease promotion', async () => {
  const f = fixture();
  f.repos.updateRelease = () => assert.fail('must not publish');
  Object.assign(f.published, { draft: true, prerelease: true });
  await assert.rejects(f.run(true), /changed/);
  f.published.draft = false;
  f.state.previous = { ...f.feed, version: '0.2.46' };
  await f.run(true);
  assert.deepEqual(f.state.writes, []);
});

test('conflicting publication re-reads the channel and keeps a newer release', async () => {
  const f = fixture();
  let attempts = 0;
  f.repos.createOrUpdateFileContents = async () => {
    attempts++; f.state.previous = { ...f.feed, version: '0.2.46' };
    throw Object.assign(new Error('File changed'), { status: 409 });
  };
  await f.run();
  assert.equal(attempts, 1);
  assert.equal(f.state.previous.version, '0.2.46');
});
