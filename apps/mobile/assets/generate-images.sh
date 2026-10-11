#!/usr/bin/env bash
# Renders the app icon, Android adaptive icon layers and splash image from the
# SVG sources in assets/source/. Run it after changing an SVG, then commit both.
#
#   apps/mobile/assets/generate-images.sh
#
# Needs network access the first time (npx fetches sharp-cli, pinned below).
set -euo pipefail

# Absolute paths: inside the npm workspace, npx doesn't keep the caller's directory.
DIR="$(cd "$(dirname "$0")" && pwd)"
sharp() { npx --yes sharp-cli@5.2.0 "$@" >/dev/null; }

# iOS rejects icons with an alpha channel, so flatten the opaque icon onto its tile colour.
sharp -i "$DIR/source/icon.svg" -o "$DIR/icon.png" flatten '#A9D4B4'
sharp -i "$DIR/source/adaptive-icon.svg" -o "$DIR/adaptive-icon.png"
sharp -i "$DIR/source/adaptive-icon-monochrome.svg" -o "$DIR/adaptive-icon-monochrome.png"
sharp -i "$DIR/source/splash-icon.svg" -o "$DIR/splash-icon.png"
