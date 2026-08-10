#!/bin/zsh

set -euo pipefail

# Build, sign, notarize, and validate a GitHub Release DMG using only Xcode and
# tools included with macOS. This script intentionally never creates an
# unsigned public artifact.

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_PATH="$PROJECT_DIR/PaperBridge.xcodeproj"
SCHEME_NAME="PaperBridge"
BUILD_DIR="$PROJECT_DIR/build-release"
DERIVED_DATA_PATH="$BUILD_DIR/DerivedData"
ARCHIVE_PATH="$BUILD_DIR/PaperBridge.xcarchive"
EXPORT_DIR="$BUILD_DIR/export"
EXPORT_OPTIONS_PATH="$BUILD_DIR/ExportOptions.plist"
APP_PATH="$EXPORT_DIR/PaperBridge.app"
DIST_DIR="$PROJECT_DIR/dist"
DMG_ROOT="$BUILD_DIR/dmg-root"
SPARKLE_UPDATES_DIR="$BUILD_DIR/sparkle-updates"
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

find_signing_identity_hash() {
  printf '%s\n' "$AVAILABLE_IDENTITIES" \
    | awk -v identity="\"$SIGNING_IDENTITY\"" \
      'index($0, identity) { print $2; exit }'
}

find_team_id() {
  local suffix="${SIGNING_IDENTITY##*\(}"
  printf '%s\n' "${suffix%\)}"
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

SIGNING_IDENTITY_HASH="${DEVELOPER_ID_APPLICATION_SHA1:-$(find_signing_identity_hash)}"
[[ -n "$SIGNING_IDENTITY_HASH" ]] || fail "The Developer ID Application certificate fingerprint could not be found."

DEVELOPMENT_TEAM_ID="${DEVELOPMENT_TEAM:-$(find_team_id)}"
[[ ${#DEVELOPMENT_TEAM_ID} -eq 10 ]] || fail "Set DEVELOPMENT_TEAM to the 10-character Apple Developer team ID."

if ! xcrun notarytool history --keychain-profile "$NOTARY_PROFILE" >/dev/null 2>&1; then
  fail "Notary profile '$NOTARY_PROFILE' is missing or invalid. Create it with: xcrun notarytool store-credentials '$NOTARY_PROFILE' --apple-id 'YOUR_APPLE_ID' --team-id 'YOUR_TEAM_ID'"
fi

printf 'Creating a signed Universal Xcode archive...\n'
rm -rf "$BUILD_DIR"
mkdir -p "$DIST_DIR"

"$DEVELOPER_DIR/usr/bin/xcodebuild" \
  -project "$PROJECT_PATH" \
  -scheme "$SCHEME_NAME" \
  -configuration Release \
  -destination "generic/platform=macOS" \
  -archivePath "$ARCHIVE_PATH" \
  -derivedDataPath "$DERIVED_DATA_PATH" \
  ARCHS="arm64 x86_64" \
  ONLY_ACTIVE_ARCH=NO \
  DEVELOPMENT_TEAM="$DEVELOPMENT_TEAM_ID" \
  CODE_SIGN_STYLE=Manual \
  CODE_SIGN_IDENTITY="$SIGNING_IDENTITY_HASH" \
  ENABLE_HARDENED_RUNTIME=YES \
  clean archive

cat > "$EXPORT_OPTIONS_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>destination</key>
  <string>export</string>
  <key>method</key>
  <string>developer-id</string>
  <key>signingCertificate</key>
  <string>$SIGNING_IDENTITY_HASH</string>
  <key>signingStyle</key>
  <string>manual</string>
  <key>teamID</key>
  <string>$DEVELOPMENT_TEAM_ID</string>
</dict>
</plist>
EOF

printf 'Exporting the Developer ID app...\n'
"$DEVELOPER_DIR/usr/bin/xcodebuild" \
  -exportArchive \
  -archivePath "$ARCHIVE_PATH" \
  -exportPath "$EXPORT_DIR" \
  -exportOptionsPlist "$EXPORT_OPTIONS_PATH"

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
APPCAST_PATH="$DIST_DIR/appcast.xml"

printf 'Validating PaperBridge.app signed with %s...\n' "$SIGNING_IDENTITY"
codesign --verify --deep --strict --verbose=2 "$APP_PATH"

printf 'Creating signed disk image...\n'
rm -rf "$DMG_ROOT"
mkdir -p "$DMG_ROOT"
ditto "$APP_PATH" "$DMG_ROOT/PaperBridge.app"
ln -s /Applications "$DMG_ROOT/Applications"
rm -f \
  "$DMG_PATH" \
  "$CHECKSUM_PATH" \
  "$LATEST_DMG_PATH" \
  "$LATEST_CHECKSUM_PATH" \
  "$APPCAST_PATH"
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

GENERATE_APPCAST="$(
  find "$DERIVED_DATA_PATH/SourcePackages/artifacts" \
    -type f \
    -name generate_appcast \
    -print \
    -quit
)"
[[ -x "$GENERATE_APPCAST" ]] || fail "Sparkle's generate_appcast tool was not found. Resolve the Sparkle package and try again."

printf 'Generating the signed Sparkle update feed...\n'
rm -rf "$SPARKLE_UPDATES_DIR"
mkdir -p "$SPARKLE_UPDATES_DIR"
ditto "$DMG_PATH" "$SPARKLE_UPDATES_DIR/$(basename "$DMG_PATH")"

RELEASE_NOTES_PATH="$SPARKLE_UPDATES_DIR/PaperBridge-$VERSION.md"
if [[ -n "${RELEASE_NOTES_FILE:-}" ]]; then
  [[ -f "$RELEASE_NOTES_FILE" ]] || fail "Release notes file not found: $RELEASE_NOTES_FILE"
  ditto "$RELEASE_NOTES_FILE" "$RELEASE_NOTES_PATH"
else
  cat > "$RELEASE_NOTES_PATH" <<EOF
# PaperBridge $VERSION

This is a signed and Apple-notarized PaperBridge update.

[View the full release history](https://github.com/haoyunLi/PaperBridge/releases)
EOF
fi

"$GENERATE_APPCAST" \
  --download-url-prefix "https://github.com/haoyunLi/PaperBridge/releases/download/v$VERSION/" \
  --embed-release-notes \
  --full-release-notes-url "https://github.com/haoyunLi/PaperBridge/releases/tag/v$VERSION" \
  --link "https://paperbridges.net" \
  --maximum-versions 1 \
  -o "$APPCAST_PATH" \
  "$SPARKLE_UPDATES_DIR"

xmllint --noout "$APPCAST_PATH"
/usr/bin/grep -q 'sparkle:edSignature=' "$APPCAST_PATH" || fail "The appcast has no EdDSA archive signature."
/usr/bin/grep -q '<!-- sparkle-signatures:' "$APPCAST_PATH" || fail "The appcast has no signed-feed block."
/usr/bin/grep -q '^edSignature:' "$APPCAST_PATH" || fail "The signed feed has no EdDSA signature."
/usr/bin/grep -q "PaperBridge-$VERSION.dmg" "$APPCAST_PATH" || fail "The appcast does not reference the versioned DMG."

cat <<EOF

Release package is ready:
  $DMG_PATH
  $CHECKSUM_PATH
  $LATEST_DMG_PATH
  $LATEST_CHECKSUM_PATH
  $APPCAST_PATH

Run ./publish_release.sh to upload these files to the matching GitHub Release.
Homebrew is not required by you or by people downloading PaperBridge.
EOF
