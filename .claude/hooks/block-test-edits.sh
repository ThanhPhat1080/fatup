#!/usr/bin/env bash
# PreToolUse hook (Edit|Write|NotebookEdit): while .claude/tests-frozen exists, refuse to
# modify test files. Used when making a failing test pass: the test must stay as committed.
# Freeze:   touch .claude/tests-frozen
# Unfreeze: rm .claude/tests-frozen

root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
[ -f "$root/.claude/tests-frozen" ] || exit 0

file=$(jq -r '.tool_input.file_path // .tool_input.notebook_path // empty')
[ -n "$file" ] || exit 0

case "$file" in
  */worker/test/* | */desktop/e2e/* | */android/*/src/test/* | */android/*/src/androidTest/* \
    | *.test.ts | *.test.tsx | *.spec.ts | *.spec.tsx | *Test.kt)
    echo "BLOCKED: $file is a test file and tests are frozen while a failing test is being made to pass (.claude/tests-frozen exists). Change the implementation, not the test. If the test itself is wrong, stop and ask the user to unfreeze it (rm .claude/tests-frozen)." >&2
    exit 2
    ;;
esac
exit 0
