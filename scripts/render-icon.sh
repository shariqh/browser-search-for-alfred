#!/bin/bash
# Renders an SVG icon to a 512x512 PNG with an alpha channel:
#   scripts/render-icon.sh <svg> <png>
# qlmanage (Quick Look, ships with macOS) draws the thumbnail into a temporary
# folder as <name>.svg.png; the result is then moved into place, so a failed
# render never leaves a half-written PNG. Used only at development time.
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: $0 <svg> <png>" >&2
  exit 2
fi
svg="$1"
png="$2"
if [[ ! -f "$svg" ]]; then
  echo "render-icon: no such file: $svg" >&2
  exit 1
fi

tmp="$(mktemp -d)"
/usr/bin/qlmanage -t -s 512 -o "$tmp" "$svg" >/dev/null
out="$tmp/$(basename "$svg").png"
if [[ ! -f "$out" ]]; then
  echo "render-icon: qlmanage produced no PNG for $svg" >&2
  exit 1
fi
mkdir -p "$(dirname "$png")"
mv "$out" "$png"
# The empty temporary folder is left for the system to clear.
