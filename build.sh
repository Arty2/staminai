#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DIST="$SCRIPT_DIR/dist"
FILES="manifest.json content.js content.css icons/ LICENSE"

mkdir -p "$DIST"

read_version() {
  # Extract "version" from manifest.json without requiring jq
  grep -oE '"version"[[:space:]]*:[[:space:]]*"[^"]+"' "$SCRIPT_DIR/manifest.json" \
    | head -n1 | sed -E 's/.*"([^"]+)"[[:space:]]*$/\1/'
}

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

# Convert a file to a double-quoted JS/JSON string literal (on a single line).
# Escapes: backslash, double-quote, and newline.
to_js_string() {
  awk '
    BEGIN { printf "\"" }
    {
      gsub(/\\/, "\\\\")
      gsub(/"/,  "\\\"")
      printf "%s\\n", $0
    }
    END { printf "\"" }
  ' "$1"
}

build_userscript() {
  echo "Building Greasemonkey userscript (.user.js)..."
  local version out css_literal
  version="$(read_version)"
  out="$DIST/staminai.user.js"
  rm -f "$out"

  css_literal="$(to_js_string "$SCRIPT_DIR/content.css")"

  {
    cat <<EOF
// ==UserScript==
// @name         staminai
// @namespace    https://heracl.es/staminai
// @version      ${version}
// @description  The AI token stamina wheel for Claude
// @author       Heracles Papatheodorou and Claude
// @match        https://claude.ai/*
// @run-at       document-idle
// @homepageURL  https://heracl.es/staminai
// @supportURL   https://heracl.es/staminai
// @license      MIT
// @grant        none
// ==/UserScript==

(function () {
  "use strict";
  var __csw_style = document.createElement("style");
  __csw_style.textContent = ${css_literal};
  (document.head || document.documentElement).appendChild(__csw_style);
})();

EOF
    cat "$SCRIPT_DIR/content.js"
  } > "$out"

  echo "  → dist/staminai.user.js"
}

case "${1:-all}" in
  firefox)      build_firefox ;;
  chromium)     build_chromium ;;
  chrome)       build_chromium ;;
  userscript)   build_userscript ;;
  greasemonkey) build_userscript ;;
  all)
    build_firefox
    build_chromium
    build_userscript
    echo "Done."
    ;;
  *)
    echo "Usage: $0 [firefox|chromium|userscript|all]"
    exit 1
    ;;
esac
