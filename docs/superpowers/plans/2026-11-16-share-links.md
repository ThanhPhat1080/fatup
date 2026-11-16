# Share links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the owner share one image/file with a public, read-only link (no login) that opens a small page and a download, with optional expiry, and that **dies immediately** when the file goes to the Vault or the trash (and never revives).

**Architecture:** A `shares` table (one row per file) plus an SQL trigger that deletes the row whenever `files.deleted_at` is set or `files.in_vault` becomes 1. Owner routes (`/files/:id/share`, behind the existing token) manage it. Two public routes (`/s/:token`, `/s/:token/file`), registered before the auth middleware, run one JOIN query on every request and stream the file from the R2 binding (never a presigned URL, which cannot be revoked). The desktop/web UI gets a Share dialog, a badge and a bulk action.

**Tech Stack:** Hono + D1 + R2 (Workers, vitest workers pool), Electron/React renderer shared with the PWA.

**Spec:** `docs/superpowers/specs/2026-11-16-share-links-design.md`
**Prototype:** `docs/superpowers/prototypes/share-links/index.html` (dashboard + the share form in variants A/B/C; the chosen form is a **combination**: variant B (popover anchored to the icon) when the Users icon is clicked, variant A (dialog) when **Chia sẻ… / Quản lý chia sẻ…** is chosen from the menu; both fold into Task 7, the rest go to a throwaway branch). The recipient page is **not** prototyped: it is a centered card (spec §4.5) and the user reviews it in a second browser once the Worker serves it.

## Global Constraints

- Only `kind IN ('image','file')`, `status='ready'`, `deleted_at IS NULL`, `in_vault = 0` can have or keep a link. Link/text → `400 not_shareable`; pending/trash/vault → `404`.
- Token = 24 random bytes, base64url (32 chars). One share per file (`UNIQUE(file_id)`). Expiry ∈ {null, 1, 7, 30} days, counted from "now" on every set; changing expiry keeps the token; sharing again after expiry or revoke makes a **new** token.
- Revocation is structural: trigger `shares_revoke_on_hide` on `files`. Restore / un-vault must **not** revive a link.
- Public routes need no token but expose nothing else; every other route still returns 401 without a token.
- Every public request runs the single JOIN query from spec §4.4. All "dead" reasons (unknown token, expired, stopped, trashed, vaulted, deleted) return the **identical** `404` page.
- Public responses: `Cache-Control: no-store`, `X-Robots-Tag: noindex, nofollow`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`; file responses add `Content-Security-Policy: sandbox; default-src 'none'`.
- Same-origin safety: only `image/jpeg|png|gif|webp|avif` may be inline (`?inline=1`, no download count); everything else, SVG and HTML included, is `attachment`. `Content-Disposition` uses RFC 5987 for non-ASCII names (`contentDisposition` in `worker/src/presign.ts` already does this; reuse it).
- All values in the HTML page pass through `escapeHtml`; the page has no JS.
- No `Range` support, no rate limiting, no Open Graph tags (spec §5, §7).
- Dashboard UI (spec §4.7): an **Đã chia sẻ** filter chip in the island placed right after the Liên kết/File/Ảnh group (a `.chips-divider` between them, green `--success` tone, count, AND with the kind tabs and search, hidden in Vault/trash); a `Users` icon-only button (no text) left of the pencil on shared items only, tooltip growing to the **left** (absolutely positioned, never shifts layout); clicking it opens the share form. List: reuse the existing 68px `.col-actions` column, no grid-template change. Grid: the icon floats over the end of the name, always visible, sliding left when the hover-only pencil appears.
- UI strings in both `en` and `vi` (`desktop/src/renderer/src/lib/i18n.ts`). No change to the Android app.
- Upgrade order: `npm run db:migrate` then `npm run deploy:worker`; desktop release + PWA deploy for the UI.

## Review Focus

- A file in the Vault or trash, then restored/un-vaulted: the old link must stay dead and a new share must give a different token.
- Setting `deleted_at` or `in_vault` by raw SQL (no route) still removes the share.
- A token for a trashed file vs a made-up token vs an expired one: byte-identical response bodies and status.
- File named `<img src=x onerror=alert(1)>.html` or `"; filename=evil` : page escapes it; download header stays well-formed; the file is `attachment`, never inline.
- An uploaded `.svg` or `.html` is never served inline on the app's origin.
- Vietnamese file name (`Hợp đồng thuê nhà.pdf`) downloads with the right name.
- `GET /files` and every other API route without a token → 401 after the public routes are added.
- The trigger exists on **real D1** (not just miniflare) before release (Task 8).

## Working agreement (same as the expiry fix)

Tests first, run them red for the expected reason, commit the tests; then implement without editing them (enable the freeze hook with `touch .claude/tests-frozen`). Work on branch `feat/share-links` cut from `main`; never commit `.github/workflows/ci.yml` (the user's own pending change).

---

### Task 1: Shared types and constants

**Files:**
- Modify: `shared/src/index.ts`
- Test: `desktop/test/share.test.ts`

**Interfaces:**
- Produces (exported from `@fatup/shared`):
  - `SHARE_EXPIRY_DAYS = [1, 7, 30] as const`, `type ShareExpiryDays = 1 | 7 | 30`
  - `SHARE_TOKEN_BYTES = 24`
  - `type ShareInfo = { token: string; url: string; expiresAt: number | null; downloads: number; lastAccessAt: number | null; createdAt: number }`
  - `type SetShareRequest = { expiresInDays: ShareExpiryDays | null }`
  - `FileItem` adds `shared: boolean`
  - `isShareable(item: Pick<FileItem, 'kind' | 'deletedAt' | 'inVault'>): boolean` — true for image/file outside trash and vault (the UI uses it to show the menu item)
  - `formatShareList(rows: { name: string; url: string }[]): string` — `name: url` per line, `\n` joined (for "Sao chép tất cả")

- [ ] **Step 1: Failing tests** in `desktop/test/share.test.ts`: `isShareable` is true for `image`/`file` with `deletedAt: null, inVault: false`, false for `link`, `text`, a trashed file, a vaulted file; `formatShareList([{name:'a.jpg',url:'https://x/s/1'},{name:'b.pdf',url:'https://x/s/2'}])` equals `'a.jpg: https://x/s/1\nb.pdf: https://x/s/2'`; `formatShareList([])` is `''`.
- [ ] **Step 2:** `npm test -w @fatup/desktop -- share` → FAIL (exports missing).
- [ ] **Step 3:** Implement the types/constants/helpers. `FileItem.shared` is required: Task 3 fills it, so run `npm run typecheck` only after Task 3.
- [ ] **Step 4:** Same test command → PASS.
- [ ] **Step 5:** Commit `feat(shared): share types, isShareable, formatShareList`.

### Task 2: Migration, trigger, and revocation tests (red first)

**Files:**
- Create: `worker/migrations/0008_shares.sql`
- Test: `worker/test/share.test.ts` (new file; also add `DELETE FROM shares` before `DELETE FROM files` in the `beforeEach` of both test files that reset `files`)

- [ ] **Step 1: Failing tests** in `worker/test/share.test.ts` (reuse the `upload`, `call`, `postJson` helpers: copy them into a small `worker/test/helpers.ts` if importing from `api.test.ts` is awkward). Revocation cases, each asserting that **before** the action `GET /s/:token` is 200, and **after** it `GET /s/:token` and `GET /s/:token/file` are 404 and `GET /files/:id/share` is 404:
  1. `DELETE /files/:id` (trash)
  2. `PUT /files/:id/vault` `{inVault:true}`
  3. `DELETE /files/:id/share`
  4. `expires_at` in the past (set by SQL)
  5. trash then `DELETE /files/:id/permanent`
  6. trash, backdate `deleted_at` 31 days, `cleanup(env)`
  And the "never revives" cases: trash → `POST /files/:id/restore` → still 404 and `GET /files/:id/share` is 404, then `PUT /files/:id/share` creates a **different** token; vault → `PUT vault {inVault:false}` → still dead. Plus the structural case: `UPDATE files SET deleted_at = ? WHERE id = ?` and, separately, `UPDATE files SET in_vault = 1 WHERE id = ?` by raw SQL each delete the `shares` row.
  (These tests need routes that do not exist yet, so they fail with 404/500 at first. Step 2 below makes sure they fail for the *right* reason once the routes exist, see Task 3 Step 4.)
- [ ] **Step 2:** Create `0008_shares.sql` exactly as in spec §4.2 (table, `UNIQUE(file_id)`, trigger).
- [ ] **Step 3:** `npm test -w @fatup/worker -- share` → the two raw-SQL trigger tests PASS (they only need the migration); the route-based tests still FAIL because the routes are missing.
- [ ] **Step 4:** Commit tests + migration: `test(worker): share revocation cases` / `feat(worker): shares table and revoke trigger`.

### Task 3: Owner API

**Files:**
- Modify: `worker/src/app.ts` (routes, `toItem`, `Row`), `worker/src/env.ts` only if needed
- Test: `worker/test/share.test.ts` (extend with the cases below, written first)

**Interfaces:**
- Consumes: `ShareInfo`, `SetShareRequest`, `SHARE_EXPIRY_DAYS`, `SHARE_TOKEN_BYTES` (Task 1)
- Produces: `GET|PUT|DELETE /files/:id/share`; `FileItem.shared`

- [ ] **Step 1: Failing tests:** `PUT` creates (201) with a 32-char url-safe token and `url` = `<origin>/s/<token>`; second `PUT` with another expiry returns 200, **same token**, new `expiresAt` = now + days; `expiresInDays: null` clears expiry; `GET` returns the info, `404 not_shared` when none; `DELETE` is idempotent; `400 bad_expiry` for `2`, `'7'`, `0`; `400 not_shareable` for a link and for text; `404` for a trashed file, a vaulted file, a `pending` upload and an unknown id; after expiry `PUT` returns a **new** token; `FileItem.shared` is true in `GET /files` for a shared file, false after `DELETE .../share`, and false when expired; no token → 401.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. Token: `crypto.getRandomValues(new Uint8Array(SHARE_TOKEN_BYTES))` → base64url without padding. `PUT` on an expired existing row: `DELETE` it then `INSERT` (new token). Compute `shared` for lists with `EXISTS(SELECT 1 FROM shares s WHERE s.file_id = files.id AND (s.expires_at IS NULL OR s.expires_at > ?))` selected as a column, or with one extra query per page (`SELECT file_id FROM shares WHERE file_id IN (...)`); pick whichever keeps `Row` and `toItem` simplest, and make `toItem` take the flag.
- [ ] **Step 4:** Run the whole `share.test.ts` → the Task 2 revocation tests that only need the owner routes and `/s/...` public routes still fail only on the missing public routes (they call `/s/:token`); the owner-API tests PASS. `npm run typecheck`.
- [ ] **Step 5:** Commit `feat(worker): owner API for share links`.

### Task 4: Public routes `/s/:token` and `/s/:token/file`

**Files:**
- Create: `worker/src/share-public.ts` (query, headers, streaming; exports `mountShare(app)` or `shareRoutes()`)
- Modify: `worker/src/app.ts` (register **before** `app.use('*', auth)`)
- Test: `worker/test/share.test.ts` (extend; written first)

- [ ] **Step 1: Failing tests:** `/s/:token` is 200 `text/html` **without** a token header; contains the file name (escaped), size, a Download link to `/s/<token>/file`; for an image also an `<img src="/s/<token>/file?inline=1">`; for a PDF no `<img>`. `/s/:token/file` returns the exact bytes with `Content-Disposition: attachment; filename="..."; filename*=UTF-8''...` (Vietnamese name round-trips), correct `Content-Type`, `Content-Length`; `downloads` goes 0 → 1; `last_access_at` set. `?inline=1` on a `.jpg` is `inline`, does **not** bump `downloads`; on `.svg`, `.html`, `.pdf` is `404`. Unknown, expired, stopped, trashed and vaulted tokens all give **byte-identical** 404 bodies and the same headers. `GET /files` without a token is still 401. Security headers from Global Constraints present on both routes. A file named `<img src=x onerror=alert(1)>.pdf` is escaped in the page and the `Content-Disposition` stays well-formed. R2 object missing while the row says ready → 404, no crash.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. One `SELECT f.*, s.token, s.expires_at ... WHERE ...` (spec §4.4) per request; stream with `env.BUCKET.get(fileKey(id))` → `new Response(obj.body, { headers })`; bump counters with `UPDATE shares SET downloads = downloads + 1, last_access_at = ?` (page and inline: only `last_access_at`) via `c.executionCtx.waitUntil` when available (fall back to `await` in tests). `app.notFound` for non-share routes stays JSON.
- [ ] **Step 4:** Run `share.test.ts` → all PASS, including every Task 2 revocation case. Run the whole worker suite (`npm test -w @fatup/worker`) → all PASS (the previously passing 76 stay green). `npm run typecheck`.
- [ ] **Step 5:** Commit `feat(worker): public share routes`.

### Task 5: Recipient page renderer

**Files:**
- Create: `worker/src/share-page.ts` (`renderSharePage(info)`, `renderDeadPage()`, `escapeHtml`)
- Test: `worker/test/share-page.test.ts`

- [ ] **Step 1: Failing tests:** `escapeHtml` handles `& < > " '`; `renderSharePage` for an image includes `<img>` and escapes the name; for a non-image there is no `<img>`; `renderDeadPage()` is identical for any input (takes no arguments); neither page contains `<script`; both carry the CSP meta-equivalent values that Task 4 sets as headers (the headers themselves are tested in Task 4).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement the centered-card design (spec §4.5), keeping to it: no JS, inline CSS, `prefers-color-scheme`, phone width. Wire Task 4 to use it. **Step 4:** PASS. **Step 5:** Commit `feat(worker): share page`.

### Task 6: Cleanup and docs for the Worker

**Files:**
- Modify: `worker/src/cleanup.ts`, `worker/test/api.test.ts` only for the `beforeEach` change from Task 2

- [ ] **Step 1: Failing test** (in `share.test.ts`): an expired share row (`expires_at` in the past) is removed by `cleanup(env)`; a not-yet-expired one stays; `purge` also removes `shares` rows for the purged ids even if the foreign key is not enforced (insert a share row for a trashed file by raw SQL after dropping the trigger's effect, or insert directly and call `purge`).
- [ ] **Step 2:** FAIL. **Step 3:** Add `DELETE FROM shares WHERE expires_at IS NOT NULL AND expires_at < ?` to `cleanup`, and `DELETE FROM shares WHERE file_id IN (...)` to `purge` before deleting `files`. **Step 4:** PASS + full worker suite + typecheck. **Step 5:** Commit `feat(worker): clean up expired shares`.

### Task 7: Client API and UI (desktop + web)

**Files:**
- Modify: `desktop/src/shared-ipc.ts`, `desktop/src/main/api.ts`, `desktop/src/main/index.ts` (+ `preload`), `web/src/browser-api.ts`, `desktop/src/renderer/src/components/Files.tsx`, `Main.tsx`, `lib/i18n.ts`, `styles.css`
- Create: `desktop/src/renderer/src/components/ShareDialog.tsx`, `ShareListDialog.tsx` (bulk result)
- Modify (e2e): `desktop/e2e/mock-server.mjs`, `desktop/e2e/smoke.mjs`

**Interfaces:**
- Consumes: `ShareInfo`, `SetShareRequest`, `isShareable`, `formatShareList`, `FileItem.shared`
- Produces: `FatupApi.getShare(id)`, `setShare(id, expiresInDays)`, `stopShare(id)`; each returns the project's existing `Result` shape.

- [ ] **Step 1: Mock server first.** Add the three routes to `desktop/e2e/mock-server.mjs` with the same revocation rule (a file moved to trash or vault drops its share) and `shared` in the item JSON.
- [ ] **Step 2: Failing e2e steps** in `smoke.mjs`: share a file from the menu → dialog shows a link and the row gets the `Users` icon **left of the pencil**, and the pencil's x position, the row height and every other column are unchanged (measure before/after, as the pencil-alignment assertion does); hovering the icon shows the tooltip fully inside the window and to the icon's left; clicking the icon opens the share form; the **Đã chia sẻ** chip shows the right count, filters to shared files only, combines (AND) with the Ảnh/File tabs, and is absent in the Vault and trash; copy button puts the link on the clipboard; change expiry; select two files → bulk Share → list with two links; move the shared file to the Vault → icon gone, chip count drops, toast mentions the link; trash → Undo restores the file **without** the icon. Run `npm run e2e` (build first; `env -u ELECTRON_RUN_AS_NODE` here) → FAIL.
- [ ] **Step 3: Implement** API + IPC + browser-api; `ShareDialog` in the **winning variant** from the prototype; the `Users` icon button (`SharedButton`, with `data-tip` tooltip CSS) in `Row` and `Tile`; the **Đã chia sẻ** chip + `sharedOnly` filter state in `Main.tsx` next to `importantOnly` (reset when entering Vault/trash); menu item (hidden when `!isShareable(item)` and in Vault/trash views); selection-bar button + `ShareListDialog` with per-row copy and "Sao chép tất cả" using `formatShareList`; toast text when moving a shared file to the Vault/trash; i18n for `en` and `vi`. Keep the rename pencil column and `col-actions` layout from the previous change intact.
- [ ] **Step 4:** `npm test`, `npm run typecheck`, `npm run build:desktop`, `npm run e2e` → all PASS.
- [ ] **Step 5:** Commit `feat(ui): share dialog, badge and bulk share`.

### Task 8: Docs, real-environment check, release notes

**Files:**
- Modify: `SPEC.md` (finalize section numbers if the design changed), `README.md`, `CHANGELOG.md` ("Chưa phát hành": **Thêm**: share links; **Nâng cấp**: migration `0008`, order `db:migrate` → `deploy:worker`, desktop release + PWA deploy needed for the UI), `docs/superpowers/specs/2026-11-16-share-links-design.md` (status → "đã triển khai")

- [ ] **Step 1:** Update docs; remove "Chia sẻ link công khai" from the "Không" column of the SPEC scope table (already done at spec time; verify).
- [ ] **Step 2: Real D1 check (user runs the deploy):** after `db:migrate`, run `wrangler d1 execute fatup --remote --command "SELECT name FROM sqlite_master WHERE type='trigger'"` and expect `shares_revoke_on_hide`. Then share a file, trash it with the app, open the link in a private window → "Link không còn hiệu lực". If the trigger is missing or inert, stop and apply the fallback in spec §5 (explicit `revokeShares` in the routes).
- [ ] **Step 3:** Full verification: `npm test`, `npm run typecheck`, `npm run e2e`, then the manual checklist in spec §4.8 (private window: image, PDF, Vietnamese name, large file; then Vault and reload).
- [ ] **Step 4:** Commit `docs: share links`. Open the PR from `feat/share-links`; **do not release** until the user says so.

---

## Prototype disposition

When the user picks the winning variant: fold it into Tasks 5 and 7 (rewritten properly; the prototype has no tests and mutates in-memory state), then commit the whole `docs/superpowers/prototypes/share-links/` folder to a throwaway branch `proto/share-links` and keep it **out of `main`**, with a note of the chosen variant and why in the PR description.
