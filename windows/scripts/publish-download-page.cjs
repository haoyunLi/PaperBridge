const { isDeepStrictEqual } = require('node:util');
const { compareVersions, releaseFromFeed } = require('../electron/updates.cjs');

function updateDownloadPage(markdown, version, windowsGuide = false) {
  const sectionEnd = windowsGuide ? markdown.indexOf('\n## Windows and macOS features') : markdown.length;
  if (sectionEnd < 0) throw new Error('Missing end of the Windows download section.');
  const section = markdown.slice(0, sectionEnd);
  const versionMarker = windowsGuide
    ? /\[Windows (\d+\.\d+\.\d+) release and SHA-256 checksums\]/g
    : /^\*\*Windows (\d+\.\d+\.\d+) x64\*\*/gm;
  const headings = [...section.matchAll(versionMarker)];
  if (headings.length !== 1) throw new Error('Expected one Windows download version on the page.');
  const [heading, previous] = headings[0];
  if (compareVersions(previous, version) > 0) return markdown;

  function urls(value) {
    const base = 'https://github.com/haoyunLi/PaperBridge/releases';
    const tag = 'windows-v' + value;
    const prefix = base + '/download/' + tag + '/PaperBridge-Windows-' + value + '-x64-';
    return [prefix + 'Portable.exe', prefix + 'Setup.exe', base + '/tag/' + tag];
  }
  const previousURLs = urls(previous), nextURLs = urls(version), found = new Set();
  const updated = section.replace(/https:\/\/github\.com\/haoyunLi\/PaperBridge\/releases\/[^\s"'<>()[\]]+/g, link => {
    const index = previousURLs.indexOf(link);
    if (index < 0) return link;
    found.add(link);
    return nextURLs[index];
  });
  if (found.size !== previousURLs.length) throw new Error('Expected both EXE links and the Windows release notes on the project homepage.');
  return updated.replace(heading, heading.replace(previous, version)) + markdown.slice(sectionEnd);
}

async function publishDownloadPage({ repos, repo, feed, ref, windowsGuide = false }) {
  const verified = releaseFromFeed(feed, feed.version);
  if (ref !== 'refs/tags/' + verified.tag) throw new Error('The homepage version must match the verified release tag.');
  const branch = windowsGuide ? 'windows/desktop-app' : 'main';
  const location = { ...repo, path: windowsGuide ? 'windows/README.md' : 'README.md' };
  for (let attempt = 1; attempt <= 3; attempt++) {
    const { data: file } = await repos.getContent({ ...location, ref: branch });
    const { data: live } = await repos.getContent({ ...repo, path: 'windows/latest-release.json', ref: 'windows/desktop-app' });
    const published = JSON.parse(Buffer.from(live.content, 'base64').toString('utf8'));
    if (compareVersions(published.version, feed.version) > 0) return 'The feed has advanced to a newer release.';
    const current = releaseFromFeed(published, feed.version);
    if (current.tag !== verified.tag || !isDeepStrictEqual(current.files, verified.files)) {
      throw new Error('The published update feed must match the tested download files.');
    }
    const markdown = Buffer.from(file.content, 'base64').toString('utf8');
    const updated = updateDownloadPage(markdown, feed.version, windowsGuide);
    if (updated === markdown) return 'Homepage downloads are current or newer.';
    try {
      await repos.createOrUpdateFileContents({ ...location, branch, sha: file.sha,
        message: 'Link the verified Windows ' + feed.version + ' downloads',
        content: Buffer.from(updated).toString('base64') });
      return 'Updated ' + location.path + ' on ' + branch + ' for ' + verified.tag;
    } catch (error) {
      if (error.status !== 409 || attempt === 3) throw error;
    }
  }
}

module.exports = { updateDownloadPage, publishDownloadPage };
