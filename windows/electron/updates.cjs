const RELEASE_FEED = 'https://raw.githubusercontent.com/haoyunLi/PaperBridge/windows/desktop-app/windows/latest-release.json';
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

function releaseResult(tag, installerName, currentVersion, portableName, files) {
  if (typeof tag !== 'string') return null;
  const latestVersion = RELEASE_TAG.exec(tag)?.[1];
  if (!versionParts(currentVersion) || !versionParts(latestVersion)) return null;
  const names = [`PaperBridge-Windows-${latestVersion}-x64-Setup.exe`, `PaperBridge Setup ${latestVersion}.exe`];
  if (!names.includes(installerName)) return null;
  const verifiedFiles = {};
  const portable = `PaperBridge-Windows-${latestVersion}-x64-Portable.exe`;
  for (const name of [installerName, ...(portableName === portable ? [portable] : [])]) {
    const file = files?.[name];
    if (Number.isSafeInteger(file?.size) && file.size > 0 && typeof file.sha256 === 'string' && /^[a-f0-9]{64}$/.test(file.sha256)) {
      verifiedFiles[name] = { size: file.size, sha256: file.sha256 };
    }
  }
  return { ...(Object.keys(verifiedFiles).length > 0 && { files: verifiedFiles }), status: compareVersions(latestVersion, currentVersion) > 0 ? 'available' : 'current', currentVersion, latestVersion, tag,
    installerName, releaseUrl: releaseUrl(tag),
    ...(portableName === `PaperBridge-Windows-${latestVersion}-x64-Portable.exe` ? { portableName } : {}) };
}

function updateDownload(result, portable) {
  if (result?.status !== 'available') return null;
  const release = releaseResult(result.tag, result.installerName, result.currentVersion, result.portableName, result.files);
  if (release?.status !== 'available') return null;
  const filename = portable ? release.portableName : release.installerName;
  return filename ? { ...(release.files?.[filename] && { file: { name: filename, ...release.files[filename] } }), tag: release.tag, label: portable ? 'Download portable update' : 'Download installer',
    url: `https://github.com/haoyunLi/PaperBridge/releases/download/${release.tag}/${encodeURIComponent(filename)}` } : null;
}

function selectWindowsRelease(releases, currentVersion) {
  if (!versionParts(currentVersion) || !Array.isArray(releases)) throw new Error('Invalid release information.');
  const candidates = releases.flatMap(release => {
    if (release?.draft || release?.prerelease || !Array.isArray(release?.assets)) return [];
    const uploaded = release.assets.filter(asset => asset?.state === 'uploaded');
    const version = RELEASE_TAG.exec(release.tag_name)?.[1];
    const portableName = uploaded.find(asset => asset.name === `PaperBridge-Windows-${version}-x64-Portable.exe`)?.name;
    const files = Object.fromEntries(uploaded.filter(asset => typeof asset.name === 'string' && typeof asset.digest === 'string' && /^sha256:[a-f0-9]{64}$/.test(asset.digest)
      && asset.browser_download_url === `https://github.com/haoyunLi/PaperBridge/releases/download/${release.tag_name}/${encodeURIComponent(asset.name)}`)
      .map(asset => [asset.name, { size: asset.size, sha256: asset.digest.slice(7) }]));
    return uploaded.flatMap(asset => {
      const result = releaseResult(release.tag_name, asset.name, currentVersion, portableName, files);
      return result ? [result] : [];
    });
  });
  candidates.sort((left, right) => compareVersions(right.latestVersion, left.latestVersion));
  return candidates[0] || { status: 'unpublished', currentVersion };
}

function releaseFromFeed(feed, currentVersion) {
  const version = feed?.version;
  if (typeof version !== 'string' || !versionParts(version)) throw new Error('Invalid Windows release version.');
  const tag = 'windows-v' + version;
  const prefix = 'PaperBridge-Windows-' + version + '-x64-';
  const setup = prefix + 'Setup.exe', portable = prefix + 'Portable.exe';
  const result = releaseResult(tag, setup, currentVersion, portable, {
    [setup]: feed.files?.Setup, [portable]: feed.files?.Portable
  });
  if (!result?.files?.[setup] || !result.files[portable]) throw new Error('Incomplete Windows release checksums.');
  return result;
}

async function checkWindowsRelease(currentVersion, fetchImpl = fetch) {
  try {
    const feed = await fetchImpl(RELEASE_FEED, {
      headers: { Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(6000)
    });
    if (feed.ok) return releaseFromFeed(await feed.json(), currentVersion);
  } catch { /* The release API can also serve installations that cannot reach the static feed. */ }
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
    : releaseResult(record.release?.tag, record.release?.installerName, currentVersion, record.release?.portableName, record.release?.files);
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
            : ['available', 'current'].includes(value?.status) && releaseResult(value.tag, value.installerName, version, value.portableName, value.files);
          if (!result || (value.latestVersion != null && value.latestVersion !== result.latestVersion)) throw new Error('Invalid Windows release information.');
          // Store identities only. URLs and available/current status are always rebuilt.
          memoryCache = { cacheVersion: 1, lastCheckAt: now(), release: result.status === 'unpublished' ? null
            : { tag: result.tag, installerName: result.installerName, ...(result.portableName && { portableName: result.portableName }), ...(result.files && { files: result.files }) } };
          try { store.saveUpdateCheckState(memoryCache); }
          catch { return { ...result, cachePersisted: false }; }
          return result;
        })
        .finally(() => { activeCheck = null; });
    }
    // Keep a known update visible while offline, without delaying the next retry.
    return automatic && cached?.result.status === 'available'
      ? activeCheck.catch(() => ({ ...cached.result, fromCache: true, stale: true, lastCheckAt: cached.lastCheckAt }))
      : activeCheck;
  };
}

module.exports = { releaseFromFeed, compareVersions, releaseUrl, updateDownload, selectWindowsRelease, checkWindowsRelease, createUpdateChecker };
