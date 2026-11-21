const { isDeepStrictEqual } = require('node:util');
const { compareVersions, releaseFromFeed, selectWindowsRelease } = require('../electron/updates.cjs');

async function publishReleaseFeed({ repos, repo, ref, feed }) {
  const release = releaseFromFeed(feed, feed.version);
  if (ref !== 'refs/tags/' + release.tag) throw new Error('The verified feed must match the release tag.');
  const location = { ...repo, path: 'windows/latest-release.json' };
  const branch = 'windows/desktop-app';
  for (let attempt = 1; attempt <= 3; attempt++) {
    const { data: file } = await repos.getContent({ ...location, ref: branch });
    const previous = JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'));
    const existing = releaseFromFeed(previous, feed.version);
    if (compareVersions(existing.latestVersion, feed.version) > 0) return 'A newer verified release is already published.';

    // A same-tag rebuild can replace assets. Only announce the exact files still on GitHub.
    const { data: published } = await repos.getReleaseByTag({ ...repo, tag: release.tag });
    const live = selectWindowsRelease([published], feed.version);
    if (live.tag !== release.tag || !isDeepStrictEqual(live.files, release.files)) {
      throw new Error('The public Windows assets changed since the download test.');
    }
    if (existing.tag === release.tag && isDeepStrictEqual(existing.files, release.files)) return 'Feed is current.';
    try {
      await repos.createOrUpdateFileContents({ ...location, branch, sha: file.sha,
        message: 'Publish verified Windows update ' + feed.version,
        content: Buffer.from(JSON.stringify(feed, null, 2) + '\n').toString('base64') });
      return 'Published ' + release.tag;
    } catch (error) {
      if (error.status !== 409 || attempt === 3) throw error;
    }
  }
}

module.exports = { publishReleaseFeed };
