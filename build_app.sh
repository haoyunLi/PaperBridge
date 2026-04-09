#!/bin/zsh

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_PATH="$PROJECT_DIR/PaperBridge.xcodeproj"
SCHEME_NAME="PaperBridge"
BUILD_DIR="$PROJECT_DIR/build"
APP_PATH="$BUILD_DIR/Build/Products/Release/PaperBridge.app"
XCODE_DEVELOPER_DIR="/Applications/Xcode.app/Contents/Developer"

if [[ ! -d "$XCODE_DEVELOPER_DIR" ]]; then
  echo "Xcode.app was not found at /Applications/Xcode.app"
  echo "Install full Xcode first, then run this script again."
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
