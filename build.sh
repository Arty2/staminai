#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DIST="$SCRIPT_DIR/dist"
FILES="manifest.json content.js content.css icons/ LICENSE"

mkdir -p "$DIST"

build_firefox() {
  echo "Building Firefox (.xpi)..."
  rm -f "$DIST/staminai-firefox.xpi"
  cd "$SCRIPT_DIR"
  zip -r "$DIST/staminai-firefox.xpi" $FILES
  echo "  → dist/staminai-firefox.xpi"
}

build_chromium() {
  echo "Building Chrome/Edge (.zip)..."
  rm -f "$DIST/staminai-chromium.zip"
  cd "$SCRIPT_DIR"
  zip -r "$DIST/staminai-chromium.zip" $FILES
  echo "  → dist/staminai-chromium.zip"
}

case "${1:-all}" in
  firefox)  build_firefox ;;
  chromium) build_chromium ;;
  chrome)   build_chromium ;;
  all)
    build_firefox
    build_chromium
    echo "Done."
    ;;
  *)
    echo "Usage: $0 [firefox|chromium|all]"
    exit 1
    ;;
esac
