#!/usr/bin/env bash
# Doc-drift check: warns when code changed on this branch but the docs that usually describe it did not.
# Compares the working tree (committed + uncommitted + untracked) against the merge-base with BASE.
#
# Usage: scripts/check-docs.sh [--strict] [BASE]     (BASE defaults to main; npm run docs:check)
#   --strict  exit 1 when there is a warning (for CI); otherwise always exit 0.
# The rules are hints, not proof: a pure refactor needs no doc change. Say so in the PR and move on.

set -euo pipefail

strict=0
base=main
for arg in "$@"; do
  case "$arg" in
    --strict) strict=1 ;;
    *) base="$arg" ;;
  esac
done

cd "$(git rev-parse --show-toplevel)"
if ! mb=$(git merge-base "$base" HEAD 2>/dev/null); then
  echo "docs:check: không tìm thấy merge-base với '$base'" >&2
  exit 2
fi

changed=$( { git diff --name-only "$mb"; git ls-files --others --exclude-standard; } | sort -u)
# Files added, deleted or renamed (the CLAUDE.md maps list files by name).
moved=$( { git diff --name-only --diff-filter=ADR "$mb"; git ls-files --others --exclude-standard; } | sort -u)

if [ -z "$changed" ]; then
  echo "docs:check: không có thay đổi so với $base."
  exit 0
fi

has() { printf '%s\n' "$changed" | grep -Eq "$1"; }
warnings=0
warn() { echo "  ! $1"; warnings=$((warnings + 1)); }

echo "docs:check so với $base ($(printf '%s\n' "$changed" | wc -l | tr -d ' ') file đã đổi)"

# Each code area and the spec file(s) that describe it (see the index in SPEC.md).
if has '^worker/migrations/'; then
  has '^docs/spec/data\.md$' || warn "có migration mới/đổi nhưng docs/spec/data.md (§3) không đổi"
  has '^CHANGELOG\.md$' || warn "có migration mới/đổi nhưng CHANGELOG.md không đổi (cần mục 'Nâng cấp': migrate trước, deploy sau)"
fi

if has '^worker/src/|^shared/src/'; then
  has '^docs/spec/(api|lifecycle|security|data)\.md$|^SPEC\.md$|^docs/decisions/' \
    || warn "code worker/shared đã đổi nhưng docs/spec/api.md, lifecycle.md, security.md (và docs/decisions/) đều không đổi"
fi

if has '^desktop/src/|^web/src/|^web/public/'; then
  has '^docs/spec/(desktop-ui|web|security)\.md$|^docs/decisions/' \
    || warn "code giao diện đã đổi nhưng docs/spec/desktop-ui.md và web.md đều không đổi"
fi

if has '^android/app/src/main/'; then
  has '^docs/spec/android\.md$' || warn "code Android đã đổi nhưng docs/spec/android.md (§8) không đổi"
fi

if has '^\.github/workflows/|^package\.json$|/package\.json$|^worker/wrangler\.toml$'; then
  has '^docs/spec/build-release\.md$|^docs/development\.md$|^README\.md$|(^|/)CLAUDE\.md$' \
    || echo "  · CI, script npm hoặc wrangler.toml đổi: xem docs/spec/build-release.md, docs/development.md, README.md và lệnh trong CLAUDE.md có cần sửa không"
fi

for f in $(printf '%s\n' "$changed" | grep -E '^docs/spec/[^/]+\.md$' || true); do
  [ -f "$f" ] && ! grep -q "(${f})" SPEC.md && warn "$f chưa có trong mục lục của SPEC.md"
done

if has '^(worker/src|shared/src|desktop/src|web/src|web/public|android/app/src/main)/'; then
  has '^CHANGELOG\.md$' || warn "code app đã đổi nhưng CHANGELOG.md chưa có mục nào"
fi

if has '^desktop/src/shared-ipc\.ts$'; then
  has '^web/src/browser-api\.ts$' || warn "FatupApi (desktop/src/shared-ipc.ts) đã đổi nhưng web/src/browser-api.ts thì không (ADR 0005)"
  has '^desktop/src/preload/' || warn "FatupApi đã đổi nhưng desktop/src/preload/ thì không (ADR 0005)"
fi

if has '^desktop/src/renderer/' && ! has 'lib/i18n\.ts$'; then
  echo "  · giao diện đổi mà i18n.ts không đổi: không sao nếu không có chữ hiển thị nào thay đổi"
fi

src_moved=$(printf '%s\n' "$moved" | grep -E '^(worker|web|desktop|shared|android)/.*\.(ts|tsx|kt|mjs|sql)$' | grep -Ev '(\.test\.|/test/)' || true)
if [ -n "$src_moved" ] && ! has '(^|/)CLAUDE\.md$'; then
  warn "có file nguồn được thêm/xóa/đổi tên nhưng không CLAUDE.md nào đổi; kiểm tra bản đồ của package:"
  printf '%s\n' "$src_moved" | sed 's/^/      /'
fi

if has '^docs/decisions/0' && ! has '^docs/decisions/README\.md$'; then
  warn "một ADR đã đổi nhưng docs/decisions/README.md (danh sách) thì không"
fi

ledgers=$(ls .superpowers/sdd/*/progress.md 2>/dev/null || true)
if [ -n "$ledgers" ] && grep -l 'Ruling' $ledgers >/dev/null 2>&1; then
  echo "  · sổ SDD có dòng 'Ruling' (bị gitignore): đảm bảo mỗi ruling làm đổi hành vi đã thành ADR"
fi

if [ "$warnings" -eq 0 ]; then
  echo "  ok: tài liệu có vẻ khớp với code."
  exit 0
fi
echo "$warnings cảnh báo. Nếu thay đổi không cần sửa tài liệu (chỉ refactor, chỉ test), ghi rõ trong PR."
[ "$strict" -eq 1 ] && exit 1
exit 0
