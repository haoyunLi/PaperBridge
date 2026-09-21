const RELEASES_API = 'https://api.github.com/repos/haoyunLi/PaperBridge/releases?per_page=100';
const RELEASE_TAG = /^windows-v(\d+\.\d+\.\d+)$/;

function versionParts(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(value));
  const parts = match?.slice(1).map(Number);
  return parts?.every(Number.isSafeInteger) ? parts : null;
}

function compareVersions(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  if (!a || !b) throw new Error('Invalid Windows version.');
  for (let index = 0; index < 3; index++) if (a[index] !== b[index]) return Math.sign(a[index] - b[index]);
  return 0;
}

function releaseUrl(tag) {
  if (!RELEASE_TAG.test(tag)) throw new Error('Invalid Windows release tag.');
  return `https://github.com/haoyunLi/PaperBridge/releases/tag/${tag}`;
}

function selectWindowsRelease(releases, currentVersion) {
  if (!versionParts(currentVersion) || !Array.isArray(releases)) throw new Error('Invalid release information.');
  const candidates = releases.filter(release => {
    const version = RELEASE_TAG.exec(release?.tag_name)?.[1];
    return versionParts(version) && !release.draft && !release.prerelease && Array.isArray(release.assets) &&
      release.assets.some(asset => asset?.state === 'uploaded' && asset.name === `PaperBridge Setup ${version}.exe`);
  });
  candidates.sort((left, right) => compareVersions(RELEASE_TAG.exec(right.tag_name)[1], RELEASE_TAG.exec(left.tag_name)[1]));
  const latest = candidates[0];
  if (!latest) return { status: 'unpublished', currentVersion };
  const latestVersion = RELEASE_TAG.exec(latest.tag_name)[1];
  return { status: compareVersions(latestVersion, currentVersion) > 0 ? 'available' : 'current', currentVersion, latestVersion, tag: latest.tag_name, releaseUrl: releaseUrl(latest.tag_name) };
}

async function checkWindowsRelease(currentVersion, fetchImpl = fetch) {
  const response = await fetchImpl(RELEASES_API, {
    headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': `PaperBridge-Windows/${currentVersion}` },
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error(`Release check failed (GitHub ${response.status}).`);
  return selectWindowsRelease(await response.json(), currentVersion);
}

function createUpdateChecker({ store, currentVersion, checkRelease = checkWindowsRelease, now = Date.now }) {
  let activeCheck = null;
  return function checkUpdates(automatic = false) {
    const version = currentVersion();
    if (automatic && (!store.settings().autoCheckUpdates || now() - store.lastUpdateCheckAt() < 24 * 60 * 60 * 1000)) {
      return Promise.resolve({ status: 'skipped', currentVersion: version });
    }
    if (!activeCheck) {
      activeCheck = Promise.resolve()
        .then(() => checkRelease(version))
        .then(result => {
          // A failed network request must not silence automatic checks for the next day.
          store.saveUpdateCheckAt(now());
          return result;
        })
        .finally(() => { activeCheck = null; });
    }
    return activeCheck;
  };
}

module.exports = { compareVersions, releaseUrl, selectWindowsRelease, checkWindowsRelease, createUpdateChecker };
