#!/bin/zsh

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_PATH="$PROJECT_DIR/PaperBridge.xcodeproj"
SCHEME_NAME="PaperBridge"
BUILD_DIR="$PROJECT_DIR/build"
APP_PATH="$BUILD_DIR/Build/Products/Release/PaperBridge.app"
DEFAULT_XCODE_DEVELOPER_DIR="/Applications/Xcode.app/Contents/Developer"

resolve_developer_dir() {
  if [[ -n "${DEVELOPER_DIR:-}" && -x "${DEVELOPER_DIR}/usr/bin/xcodebuild" ]]; then
    printf '%s\n' "$DEVELOPER_DIR"
    return 0
  fi

  if command -v xcode-select >/dev/null 2>&1; then
    local selected_dir
    selected_dir="$(xcode-select -p 2>/dev/null || true)"
    if [[ -n "$selected_dir" && -x "${selected_dir}/usr/bin/xcodebuild" ]]; then
      printf '%s\n' "$selected_dir"
      return 0
    fi
  fi

  if [[ -x "${DEFAULT_XCODE_DEVELOPER_DIR}/usr/bin/xcodebuild" ]]; then
    printf '%s\n' "$DEFAULT_XCODE_DEVELOPER_DIR"
    return 0
  fi

  return 1
}

if ! XCODE_DEVELOPER_DIR="$(resolve_developer_dir)"; then
  echo "Full Xcode was not found."
  echo "Install Xcode, or run:"
  echo "  sudo xcode-select -s /Applications/Xcode.app/Contents/Developer"
  exit 1
fi

export DEVELOPER_DIR="$XCODE_DEVELOPER_DIR"

if ! "$DEVELOPER_DIR/usr/bin/xcodebuild" -checkFirstLaunchStatus >/dev/null 2>&1; then
  cat <<'EOF'
Xcode first-launch setup is not finished yet.

Run these commands once, then rerun ./build_app.sh:

  sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
  sudo xcodebuild -license accept
  sudo xcodebuild -runFirstLaunch
EOF
  exit 1
fi

if [[ ! -d "$PROJECT_PATH" ]]; then
  echo "Project not found: $PROJECT_PATH"
  exit 1
fi

echo "Building $SCHEME_NAME..."

"$DEVELOPER_DIR/usr/bin/xcodebuild" \
  -project "$PROJECT_PATH" \
  -scheme "$SCHEME_NAME" \
  -configuration Release \
  -derivedDataPath "$BUILD_DIR" \
  CODE_SIGNING_ALLOWED=NO \
  build

if [[ ! -d "$APP_PATH" ]]; then
  echo "Build finished, but the app bundle was not found at:"
  echo "  $APP_PATH"
  exit 1
fi

cat <<EOF

Build finished successfully.

App bundle:
  $APP_PATH

Open it with:
  open "$APP_PATH"

Open the build folder with:
  open "$(dirname "$APP_PATH")"
EOF
