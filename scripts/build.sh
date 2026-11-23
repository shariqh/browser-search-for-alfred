#!/bin/bash
# Builds the two files you hand out:
#   dist/Browser-Search-for-Alfred.alfredworkflow   (the contents of workflow/)
#   dist/browser-search-for-alfred-addon.zip        (the contents of addon/)
# Each zip is built in a temporary folder and moved into place, so a failed
# build never leaves a half-written file and files removed from the source
# never linger in an old archive.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$root/dist"
tmp="$(mktemp -d)"

build_zip() { # source folder, output file
  local out="$tmp/$(basename "$2")"
  (cd "$1" && /usr/bin/zip -r -X -q "$out" . -x '*.DS_Store')
  mv "$out" "$2"
}

build_zip "$root/workflow" "$root/dist/Browser-Search-for-Alfred.alfredworkflow"
build_zip "$root/addon" "$root/dist/browser-search-for-alfred-addon.zip"

echo "Built:"
echo "  $root/dist/Browser-Search-for-Alfred.alfredworkflow"
echo "  $root/dist/browser-search-for-alfred-addon.zip"
