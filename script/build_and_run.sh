#!/bin/zsh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD="$ROOT/build-dev.noindex"
USER_APPLICATIONS="${PAPERBRIDGE_DEV_APP_DIR:-${HOME}/Applications}"
APP="$USER_APPLICATIONS/PaperBridge Dev.app"
EXECUTABLE="$APP/Contents/MacOS/PaperBridge Dev"
MODE=run
ISOLATED=0
for option in "$@"; do
  case "$option" in
    --isolated) ISOLATED=1 ;;
    --verify|--debug|--logs|--telemetry) MODE="$option" ;;
    *) printf 'Usage: %s [--isolated] [--verify|--debug|--logs|--telemetry]\n' "$0"; exit 2 ;;
  esac
done

# Stop only this development build, never the installed release.
pkill -f "$EXECUTABLE" >/dev/null 2>&1 || true
mkdir -p "$BUILD" "$USER_APPLICATIONS"
touch "$BUILD/.metadata_never_index"
PACKAGE_FLAGS=()
PACKAGE_CACHE="$ROOT/build-release.noindex/DerivedData/SourcePackages"
if [[ -d "$PACKAGE_CACHE/checkouts/Sparkle" ]]; then
  PACKAGE_FLAGS=(-clonedSourcePackagesDirPath "$PACKAGE_CACHE" -disableAutomaticPackageResolution)
fi
xcodebuild -quiet -project "$ROOT/PaperBridge.xcodeproj" -scheme PaperBridge \
  -configuration Debug -destination "platform=macOS,arch=$(uname -m)" \
  -derivedDataPath "$BUILD" -packageAuthorizationProvider netrc \
  "${PACKAGE_FLAGS[@]}" CONFIGURATION_BUILD_DIR="$USER_APPLICATIONS" \
  CODE_SIGNING_ALLOWED=NO build

APP_ARGS=()
if (( ISOLATED )); then
  APP_ARGS=(--paperbridge-workspace "$BUILD/QAWorkspace")
fi
if [[ "$MODE" == --debug ]]; then
  exec lldb -- "$EXECUTABLE" "${APP_ARGS[@]}"
fi
open -n "$APP" --args "${APP_ARGS[@]}"
case "$MODE" in
  --verify) sleep 2; pgrep -f "$EXECUTABLE" >/dev/null ;;
  --logs) exec /usr/bin/log stream --info --style compact --predicate 'process == "PaperBridge Dev"' ;;
  --telemetry) exec /usr/bin/log stream --info --style compact --predicate 'subsystem == "com.haoyunli.PaperBridge.dev"' ;;
esac
printf 'Opened %s\n' "$APP"
