#!/bin/zsh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD="$ROOT/build-audit-fixes"
APP="$BUILD/Build/Products/Debug/PaperBridge.app"
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
pkill -f "$APP/Contents/MacOS/PaperBridge" >/dev/null 2>&1 || true
PACKAGE_FLAGS=()
if [[ -d "$ROOT/build-update/SourcePackages/checkouts/Sparkle" ]]; then
  PACKAGE_FLAGS=(-clonedSourcePackagesDirPath "$ROOT/build-update/SourcePackages" -disableAutomaticPackageResolution)
fi
xcodebuild -quiet -project "$ROOT/PaperBridge.xcodeproj" -scheme PaperBridge \
  -configuration Debug -destination "platform=macOS,arch=$(uname -m)" \
  -derivedDataPath "$BUILD" "${PACKAGE_FLAGS[@]}" CODE_SIGNING_ALLOWED=NO build

APP_ARGS=()
if (( ISOLATED )); then
  APP_ARGS=(--paperbridge-workspace "$BUILD/QAWorkspace")
fi
if [[ "$MODE" == --debug ]]; then
  exec lldb -- "$APP/Contents/MacOS/PaperBridge" "${APP_ARGS[@]}"
fi
open -n "$APP" --args "${APP_ARGS[@]}"
case "$MODE" in
  --verify) sleep 2; pgrep -f "$APP/Contents/MacOS/PaperBridge" >/dev/null ;;
  --logs) exec /usr/bin/log stream --info --style compact --predicate 'process == "PaperBridge"' ;;
  --telemetry) exec /usr/bin/log stream --info --style compact --predicate 'subsystem == "com.haoyunli.PaperBridge"' ;;
esac
printf 'Opened %s\n' "$APP"
