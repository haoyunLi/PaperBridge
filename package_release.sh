#!/bin/zsh

set -euo pipefail

# Build, sign, notarize, and validate a GitHub Release DMG using only Xcode and
# tools included with macOS. This script intentionally never creates an
# unsigned public artifact.

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_PATH="$PROJECT_DIR/PaperBridge.xcodeproj"
SCHEME_NAME="PaperBridge"
BUILD_DIR="$PROJECT_DIR/build-release"
APP_PATH="$BUILD_DIR/Build/Products/Release/PaperBridge.app"
DIST_DIR="$PROJECT_DIR/dist"
DMG_ROOT="$BUILD_DIR/dmg-root"
DEFAULT_XCODE_DEVELOPER_DIR="/Applications/Xcode.app/Contents/Developer"
NOTARY_PROFILE="${NOTARY_PROFILE:-PaperBridge-notary}"

fail() {
  printf 'Error: %s\n' "$1" >&2
  exit 1
}

resolve_developer_dir() {
  if [[ -n "${DEVELOPER_DIR:-}" && -x "${DEVELOPER_DIR}/usr/bin/xcodebuild" ]]; then
    printf '%s\n' "$DEVELOPER_DIR"
    return 0
  fi

  local selected_dir=""
  selected_dir="$(xcode-select -p 2>/dev/null || true)"
  if [[ -n "$selected_dir" && -x "${selected_dir}/usr/bin/xcodebuild" ]]; then
    printf '%s\n' "$selected_dir"
    return 0
  fi

  if [[ -x "${DEFAULT_XCODE_DEVELOPER_DIR}/usr/bin/xcodebuild" ]]; then
    printf '%s\n' "$DEFAULT_XCODE_DEVELOPER_DIR"
    return 0
  fi

  return 1
}

find_signing_identity() {
  local identities=""
  identities="$(
    printf '%s\n' "$AVAILABLE_IDENTITIES" \
      | sed -n 's/.*"\(Developer ID Application:.*\)"/\1/p'
  )"
  printf '%s\n' "${identities%%$'\n'*}"
}

[[ -d "$PROJECT_PATH" ]] || fail "Project not found at $PROJECT_PATH"

XCODE_DEVELOPER_DIR="$(resolve_developer_dir)" || fail "Full Xcode is required."
export DEVELOPER_DIR="$XCODE_DEVELOPER_DIR"

AVAILABLE_IDENTITIES="$(security find-identity -v -p codesigning)"
SIGNING_IDENTITY="${DEVELOPER_ID_APPLICATION:-$(find_signing_identity)}"
if [[ -z "$SIGNING_IDENTITY" ]]; then
  fail "No Developer ID Application certificate was found. Create one in Xcode > Settings > Accounts > Manage Certificates, then run this script again."
fi

if [[ "$AVAILABLE_IDENTITIES" != *"\"$SIGNING_IDENTITY\""* ]]; then
  fail "The requested signing identity is not available in this keychain: $SIGNING_IDENTITY"
fi

if ! xcrun notarytool history --keychain-profile "$NOTARY_PROFILE" >/dev/null 2>&1; then
  fail "Notary profile '$NOTARY_PROFILE' is missing or invalid. Create it with: xcrun notarytool store-credentials '$NOTARY_PROFILE' --apple-id 'YOUR_APPLE_ID' --team-id 'YOUR_TEAM_ID'"
fi

printf 'Building a Universal Release app...\n'
rm -rf "$BUILD_DIR"
mkdir -p "$DIST_DIR"

"$DEVELOPER_DIR/usr/bin/xcodebuild" \
  -project "$PROJECT_PATH" \
  -scheme "$SCHEME_NAME" \
  -configuration Release \
  -derivedDataPath "$BUILD_DIR" \
  ARCHS="arm64 x86_64" \
  ONLY_ACTIVE_ARCH=NO \
  CODE_SIGNING_ALLOWED=NO \
  clean build

[[ -d "$APP_PATH" ]] || fail "Release app was not produced at $APP_PATH"

APP_BINARY="$APP_PATH/Contents/MacOS/PaperBridge"
[[ -x "$APP_BINARY" ]] || fail "The PaperBridge executable is missing from the app bundle."
APP_ARCHITECTURES="$(lipo -archs "$APP_BINARY")"
if [[ " $APP_ARCHITECTURES " != *" arm64 "* || " $APP_ARCHITECTURES " != *" x86_64 "* ]]; then
  fail "The release must contain both arm64 and x86_64 architectures. Found: $APP_ARCHITECTURES"
fi

VERSION="${VERSION_OVERRIDE:-$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP_PATH/Contents/Info.plist")}"
[[ -n "$VERSION" ]] || fail "The app version could not be read from Info.plist."
DMG_PATH="$DIST_DIR/PaperBridge-$VERSION.dmg"
CHECKSUM_PATH="$DMG_PATH.sha256"
LATEST_DMG_PATH="$DIST_DIR/PaperBridge.dmg"
LATEST_CHECKSUM_PATH="$LATEST_DMG_PATH.sha256"

printf 'Signing PaperBridge.app with %s...\n' "$SIGNING_IDENTITY"
codesign \
  --force \
  --options runtime \
  --timestamp \
  --sign "$SIGNING_IDENTITY" \
  "$APP_PATH"
codesign --verify --deep --strict --verbose=2 "$APP_PATH"

printf 'Creating signed disk image...\n'
rm -rf "$DMG_ROOT"
mkdir -p "$DMG_ROOT"
ditto "$APP_PATH" "$DMG_ROOT/PaperBridge.app"
ln -s /Applications "$DMG_ROOT/Applications"
rm -f "$DMG_PATH" "$CHECKSUM_PATH" "$LATEST_DMG_PATH" "$LATEST_CHECKSUM_PATH"
hdiutil create \
  -volname "PaperBridge $VERSION" \
  -srcfolder "$DMG_ROOT" \
  -format UDZO \
  -ov \
  "$DMG_PATH"
codesign --force --timestamp --sign "$SIGNING_IDENTITY" "$DMG_PATH"
codesign --verify --verbose=2 "$DMG_PATH"

printf 'Submitting the DMG to Apple for notarization...\n'
xcrun notarytool submit \
  "$DMG_PATH" \
  --keychain-profile "$NOTARY_PROFILE" \
  --wait \
  --timeout 45m

printf 'Attaching and validating the notarization ticket...\n'
xcrun stapler staple "$DMG_PATH"
xcrun stapler validate "$DMG_PATH"
spctl -a -vv --type open --context context:primary-signature "$DMG_PATH"

DMG_DIGEST="$(shasum -a 256 "$DMG_PATH" | awk '{print $1}')"
printf '%s  %s\n' "$DMG_DIGEST" "$(basename "$DMG_PATH")" > "$CHECKSUM_PATH"

# Keep a stable asset name so releases/latest/download/PaperBridge.dmg always
# resolves to the newest signed and notarized release.
ditto "$DMG_PATH" "$LATEST_DMG_PATH"
printf '%s  %s\n' "$DMG_DIGEST" "$(basename "$LATEST_DMG_PATH")" > "$LATEST_CHECKSUM_PATH"
xcrun stapler validate "$LATEST_DMG_PATH"
spctl -a -vv --type open --context context:primary-signature "$LATEST_DMG_PATH"

cat <<EOF

Release package is ready:
  $DMG_PATH
  $CHECKSUM_PATH
  $LATEST_DMG_PATH
  $LATEST_CHECKSUM_PATH

Run ./publish_release.sh to upload these files to the matching GitHub Release.
Homebrew is not required by you or by people downloading PaperBridge.
EOF
