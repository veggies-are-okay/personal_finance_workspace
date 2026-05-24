#!/usr/bin/env bash
# PreToolUse(Bash) reminder hook.
# Fires the branch-finalization process reminder whenever a Bash command opens a PR
# (`gh pr create`), anywhere in the command (incl. compound `git push && gh pr create`).
# Non-blocking: only injects additionalContext; never denies (so the branch-finalization
# skill's own `gh pr create` is not blocked). Reads the PreToolUse hook JSON on stdin.
in=$(cat)
if printf '%s' "$in" | grep -q "gh pr create"; then
  printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"PR creation detected — open it via the branch-finalization skill: preflight gates, README upkeep, self-review, tiered PR description + happy-path proof, reviewer pass, then merge only on green. See .claude/rules/pull-requests.md."}}'
fi
exit 0
