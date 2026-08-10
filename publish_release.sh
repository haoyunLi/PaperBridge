#!/bin/zsh

set -euo pipefail

# Build, sign, notarize, tag, and publish PaperBridge in one command. The
# stable PaperBridge.dmg asset keeps the website's latest-download URL valid.

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
PACKAGE_SCRIPT="$PROJECT_DIR/package_release.sh"
DIST_DIR="$PROJECT_DIR/dist"
APP_PLIST="$PROJECT_DIR/build-release/Build/Products/Release/PaperBridge.app/Contents/Info.plist"

fail() {
  printf 'Error: %s\n' "$1" >&2
  exit 1
}

command -v git >/dev/null 2>&1 || fail "Git is required."
command -v gh >/dev/null 2>&1 || fail "GitHub CLI is required. Install it from https://cli.github.com/."
[[ -x "$PACKAGE_SCRIPT" ]] || fail "package_release.sh is missing or is not executable."

cd "$PROJECT_DIR"

CURRENT_BRANCH="$(git branch --show-current)"
[[ "$CURRENT_BRANCH" == "main" ]] || fail "Run releases from the main branch. Current branch: $CURRENT_BRANCH"

git diff --quiet || fail "Commit or discard tracked working-tree changes before publishing."
git diff --cached --quiet || fail "Commit staged changes before publishing."
gh auth status >/dev/null 2>&1 || fail "GitHub CLI is not signed in. Run: gh auth login"

printf 'Checking the GitHub main branch...\n'
git fetch origin main
LOCAL_HEAD="$(git rev-parse HEAD)"
REMOTE_HEAD="$(git rev-parse origin/main)"
[[ "$LOCAL_HEAD" == "$REMOTE_HEAD" ]] || fail "Local main must match origin/main before publishing. Push or pull your changes first."

"$PACKAGE_SCRIPT"

[[ -f "$APP_PLIST" ]] || fail "The packaged app Info.plist was not found."
VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP_PLIST")"
[[ -n "$VERSION" ]] || fail "The app version could not be read from the packaged app."

TAG="v$VERSION"
VERSIONED_DMG="$DIST_DIR/PaperBridge-$VERSION.dmg"
VERSIONED_CHECKSUM="$VERSIONED_DMG.sha256"
LATEST_DMG="$DIST_DIR/PaperBridge.dmg"
LATEST_CHECKSUM="$LATEST_DMG.sha256"
ASSETS=("$VERSIONED_DMG" "$VERSIONED_CHECKSUM" "$LATEST_DMG" "$LATEST_CHECKSUM")

for asset in "${ASSETS[@]}"; do
  [[ -f "$asset" ]] || fail "Release asset is missing: $asset"
done

REMOTE_TAG_HEAD="$(git ls-remote --tags origin "refs/tags/$TAG^{}" | awk 'NR == 1 {print $1}')"
if [[ -z "$REMOTE_TAG_HEAD" ]]; then
  REMOTE_TAG_HEAD="$(git ls-remote --tags origin "refs/tags/$TAG" | awk 'NR == 1 {print $1}')"
fi

if [[ -n "$REMOTE_TAG_HEAD" && "$REMOTE_TAG_HEAD" != "$LOCAL_HEAD" ]]; then
  fail "$TAG already exists on GitHub for another commit. Increase the app version before publishing."
fi

if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  TAG_HEAD="$(git rev-list -n 1 "$TAG")"
  [[ "$TAG_HEAD" == "$LOCAL_HEAD" ]] || fail "$TAG already points to another commit. Increase the app version before publishing."
else
  git tag -a "$TAG" -m "PaperBridge $VERSION"
fi

if [[ -z "$REMOTE_TAG_HEAD" ]]; then
  git push origin "$TAG"
fi

if gh release view "$TAG" --repo haoyunLi/PaperBridge >/dev/null 2>&1; then
  printf 'Updating existing GitHub Release %s...\n' "$TAG"
  gh release upload "$TAG" "${ASSETS[@]}" --repo haoyunLi/PaperBridge --clobber
  gh release edit "$TAG" --repo haoyunLi/PaperBridge --title "PaperBridge $VERSION" --latest
else
  printf 'Creating GitHub Release %s...\n' "$TAG"
  gh release create "$TAG" "${ASSETS[@]}" \
    --repo haoyunLi/PaperBridge \
    --title "PaperBridge $VERSION" \
    --generate-notes \
    --latest
fi

cat <<EOF

PaperBridge $VERSION is published:
  https://github.com/haoyunLi/PaperBridge/releases/tag/$TAG

The website download URL now resolves automatically to this release:
  https://github.com/haoyunLi/PaperBridge/releases/latest/download/PaperBridge.dmg
EOF
