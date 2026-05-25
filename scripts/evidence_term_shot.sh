#!/usr/bin/env bash
# Render a terminal transcript (a text file of REAL captured command/test output)
# into a PNG via Playwright's bundled Chromium — the turnkey "happy-path proof"
# screenshot for backend/DB/CLI PRs (`.claude/rules/pull-requests.md` §3).
#
# Why the CLI (not the Playwright MCP): the MCP here is pinned to the system
# `chrome` channel, whose installer needs sudo. `npx playwright screenshot`
# uses the no-sudo bundled chromium (install once: `npx playwright install chromium`).
#
# Usage:
#   scripts/evidence_term_shot.sh <input.txt> <output.png> ["Title"]
# Example:
#   uv run pytest tests/test_loader.py -v --no-cov | tee /tmp/p.txt
#   scripts/evidence_term_shot.sh /tmp/p.txt pull_requests/evidence/<slug>/proof.png "P3.x — loader proof"
set -euo pipefail
IN="${1:?input text file}"; OUT="${2:?output png path}"; TITLE="${3:-happy-path proof}"
mkdir -p "$(dirname "$OUT")"
TMP_HTML="$(mktemp /tmp/evidence_XXXXXX.html)"
BODY="$(python3 -c 'import html,sys; sys.stdout.write(html.escape(open(sys.argv[1]).read()))' "$IN")"
TITLE_ESC="$(printf '%s' "$TITLE" | python3 -c 'import html,sys; sys.stdout.write(html.escape(sys.stdin.read()))')"
cat > "$TMP_HTML" <<HTML
<!doctype html><meta charset="utf-8"><style>
body{margin:0;background:#0d1117;font-family:Menlo,Consolas,monospace}
.t{width:880px;margin:16px auto;border:1px solid #30363d;border-radius:10px;overflow:hidden}
.b{background:#161b22;padding:8px 12px;color:#8b949e;font-size:12px}
.d{height:11px;width:11px;border-radius:50%;display:inline-block;margin-right:6px;vertical-align:middle}
pre{margin:0;padding:14px 16px;color:#c9d1d9;font-size:13px;line-height:1.5;white-space:pre-wrap}
</style><div class="t"><div class="b"><span class="d" style="background:#ff5f56"></span><span class="d" style="background:#ffbd2e"></span><span class="d" style="background:#27c93f"></span> ${TITLE_ESC}</div><pre>${BODY}</pre></div>
HTML
npx --yes playwright screenshot --browser chromium --full-page "file://${TMP_HTML}" "$OUT" >/dev/null 2>&1
rm -f "$TMP_HTML"
echo "wrote $OUT"
