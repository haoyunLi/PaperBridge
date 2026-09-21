const RELEASES_API = 'https://api.github.com/repos/haoyunLi/PaperBridge/releases?per_page=100';
const RELEASE_TAG = /^windows-v(\d+\.\d+\.\d+)$/;
const CHECK_INTERVAL = 24 * 60 * 60 * 1000;

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

function releaseResult(tag, installerName, currentVersion) {
  if (typeof tag !== 'string') return null;
  const latestVersion = RELEASE_TAG.exec(tag)?.[1];
  if (!versionParts(currentVersion) || !versionParts(latestVersion) || installerName !== `PaperBridge Setup ${latestVersion}.exe`) return null;
  return { status: compareVersions(latestVersion, currentVersion) > 0 ? 'available' : 'current', currentVersion, latestVersion, tag,
    installerName, releaseUrl: releaseUrl(tag) };
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
  return releaseResult(latest.tag_name, `PaperBridge Setup ${latestVersion}.exe`, currentVersion);
}

async function checkWindowsRelease(currentVersion, fetchImpl = fetch) {
  const response = await fetchImpl(RELEASES_API, {
    headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': `PaperBridge-Windows/${currentVersion}` },
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error(`Release check failed (GitHub ${response.status}).`);
  return selectWindowsRelease(await response.json(), currentVersion);
}

function validatedCache(record, currentVersion, time) {
  if (!record || record.cacheVersion !== 1 || !Number.isSafeInteger(record.lastCheckAt) || record.lastCheckAt <= 0 || record.lastCheckAt > time) return null;
  const result = record.release === null ? { status: 'unpublished', currentVersion }
    : releaseResult(record.release?.tag, record.release?.installerName, currentVersion);
  return result ? { result, lastCheckAt: record.lastCheckAt } : null;
}

function createUpdateChecker({ store, currentVersion, checkRelease = checkWindowsRelease, now = Date.now }) {
  let activeCheck = null;
  let memoryCache = null;
  return function checkUpdates(automatic = false) {
    const version = currentVersion();
    const time = now();
    if (automatic && !store.settings().autoCheckUpdates) {
      return Promise.resolve({ status: 'skipped', currentVersion: version });
    }
    let persisted = null;
    try { persisted = validatedCache(store.updateCheckState(), version, time); } catch { /* A cache read failure must not block an update check. */ }
    const memory = validatedCache(memoryCache, version, time);
    const cached = memory && (!persisted || memory.lastCheckAt >= persisted.lastCheckAt) ? memory : persisted;
    if (automatic && cached && time - cached.lastCheckAt < CHECK_INTERVAL) {
      return Promise.resolve(cached.result.status === 'available' ? { ...cached.result, fromCache: true }
        : { status: 'skipped', currentVersion: version });
    }
    if (!activeCheck) {
      activeCheck = Promise.resolve()
        .then(() => checkRelease(version))
        .then(value => {
          const result = value?.status === 'unpublished' ? { status: 'unpublished', currentVersion: version }
            : ['available', 'current'].includes(value?.status) && releaseResult(value.tag, value.installerName, version);
          if (!result || (value.latestVersion != null && value.latestVersion !== result.latestVersion)) throw new Error('Invalid Windows release information.');
          // Store identities only. URLs and available/current status are always rebuilt.
          memoryCache = { cacheVersion: 1, lastCheckAt: now(), release: result.status === 'unpublished' ? null
            : { tag: result.tag, installerName: result.installerName } };
          try { store.saveUpdateCheckState(memoryCache); }
          catch { return { ...result, cachePersisted: false }; }
          return result;
        })
        .finally(() => { activeCheck = null; });
    }
    // Keep a known update visible while offline, without delaying the next retry.
    return automatic && cached?.result.status === 'available'
      ? activeCheck.catch(() => ({ ...cached.result, fromCache: true, stale: true }))
      : activeCheck;
  };
}

module.exports = { compareVersions, releaseUrl, selectWindowsRelease, checkWindowsRelease, createUpdateChecker };
