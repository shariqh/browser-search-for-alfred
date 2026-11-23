#!/bin/bash
# Milestone gate: does a real Firefox start our JXA helper, and does the `tab` script filter
# get real Firefox tabs through it?  Run it with: npm run check:firefox
#
# It never touches the Firefox you are using. web-ext starts a SEPARATE Firefox with a fresh
# temporary profile (web-ext's default) and passes -no-remote, so it cannot attach to a running
# Firefox. The throwaway add-on keeps the manifest's own add-on ID, so the real registration
# file applies to it.
#
# Side effect, on purpose: step 1 installs the helper copy and our registration file in the
# real ~/Library, exactly as the workflow's "Set up Firefox" action does.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$PWD"
WEBEXT_LOG="$ROOT/.superpowers/check-real-firefox-webext.log"
WAIT_SECONDS=30

mkdir -p "$(dirname "$WEBEXT_LOG")"

# Job control gives the background web-ext its own process group, so one signal reaches web-ext
# and the Firefox it started, and nothing else (never the Firefox you are using).
set -m

WEBEXT_PID=""

fail() {
  echo "REAL FIREFOX: FAIL: $1"
  exit 1
}

stop_webext() {
  [ -n "$WEBEXT_PID" ] || return 0
  # SIGINT is the signal web-ext documents for a clean shutdown: it closes its Firefox.
  kill -INT "$WEBEXT_PID" 2>/dev/null || true
  local i
  for i in $(seq 1 20); do
    kill -0 "$WEBEXT_PID" 2>/dev/null || break
    sleep 0.5
  done
  # Still there: end the whole group (web-ext, its Firefox, the helper Firefox started).
  if kill -0 "$WEBEXT_PID" 2>/dev/null; then
    kill -TERM -- "-$WEBEXT_PID" 2>/dev/null || true
    sleep 2
  fi
  WEBEXT_PID=""
}
trap stop_webext EXIT

# 1. Install the helper copy and register it (the workflow's own "Set up Firefox" action).
setup_out="$(/usr/bin/osascript -l JavaScript workflow/act.js '{"action":"setup-firefox"}' 2>&1)" ||
  fail "setup-firefox failed: $setup_out"

# 2. Start a separate Firefox with the add-on. --no-input: web-ext must not read the terminal.
./node_modules/.bin/web-ext run \
  --source-dir addon \
  --firefox /Applications/Firefox.app \
  --start-url https://example.com/ \
  --no-input --no-reload \
  >"$WEBEXT_LOG" 2>&1 &
WEBEXT_PID=$!

# 3. Poll the real script filter until an item's subtitle mentions example.com.
# The gate must not query a real Chrome (an Apple Event, and possibly an Automation prompt).
export BSA_SKIP_CHROME=1
deadline=$((SECONDS + WAIT_SECONDS))
last_output=""
found=0
while [ "$SECONDS" -lt "$deadline" ]; do
  kill -0 "$WEBEXT_PID" 2>/dev/null || fail "web-ext exited early (see $WEBEXT_LOG)"
  last_output="$(/usr/bin/osascript -l JavaScript workflow/tab.js "" 2>&1 || true)"
  if printf '%s' "$last_output" | node -e '
    const items = JSON.parse(require("fs").readFileSync(0, "utf8")).items || [];
    process.exit(items.some((i) => String(i.subtitle || "").includes("example.com")) ? 0 : 1);
  ' 2>/dev/null; then
    found=1
    break
  fi
  sleep 2
done

# 4. Stop web-ext, then report.
if [ "$found" -ne 1 ]; then
  echo "--- helper processes: $(pgrep -fl firefox-helper.js || echo none)"
  echo "--- last tab.js output: $last_output"
  stop_webext
  fail "no Firefox tab with example.com within ${WAIT_SECONDS}s (web-ext log: $WEBEXT_LOG)"
fi
echo "--- helper processes during run:"
pgrep -fl firefox-helper.js || true
stop_webext
echo "REAL FIREFOX: PASS"
