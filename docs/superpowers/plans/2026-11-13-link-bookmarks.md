# Link bookmarks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Save links (shared from Android/PWA or typed into "Thêm liên kết") as `kind = 'link'` files that never expire, with lazy previews, domain categories, editable title/URL and a cowsay SVG fallback.

**Architecture:** A link is a `files` row (no R2 object, optional `thumbs/<id>.jpg`). The Worker gains `POST /links`, `POST /links/:id/preview` and extends `PATCH /files/:id`. Shared pure helpers (`siteOf`, `normalizeUrl`, `extractUrl`) serve Worker, UI, PWA and mirror in Kotlin. The desktop/web UI gets a Links tab; `kind=all` stays link-free for old clients.

**Tech Stack:** Hono + D1 + R2 (Workers, vitest workers pool), Electron/React renderer shared with the PWA, Kotlin (WorkManager).

**Spec:** `docs/superpowers/specs/2026-11-13-link-bookmarks-design.md`

## Global Constraints

- Link row: `kind='link'`, `mime='text/uri-list'`, `size=0`, `status='ready'`; only `http`/`https` URLs, max 2048 chars.
- `kind=all` on `GET /files` excludes links; trash lists every kind.
- Cron group 1 (30-day expiry) must skip `kind='link'`; trash purge (30 days) still deletes links.
- Preview fetch: timeout 4 s, ≤ 3 redirects, ≤ 512 KB HTML, image ≤ 1.5 MB with an `image/*` content type, no localhost/private-IP hosts; never overwrite the title when `title_set = 1`.
- Site categories: facebook (facebook.com, fb.com, fb.me, fb.watch), youtube (youtube.com, youtu.be), instagram (instagram.com), threads (threads.net, threads.com), shopee (shopee.vn, shopee.com, shp.ee), tiktok (tiktok.com), internet (everything else); subdomains match, lookalikes (`notfacebook.com`) do not.
- No real brand logos; UI strings in both `en` and `vi` (desktop `i18n.ts`, Android `values/` and `values-vi/`).
- Migration order on upgrade: `db:migrate:remote` then `deploy`.

## Review Focus

- URL with fragment/uppercase host/trailing junk typed by hand (`HTTPS://Example.COM/a#x`) → stored normalized, and de-duplicated against the same link.
- Shared text with no URL, or two URLs ("a https://x.com b https://y.com") → first URL wins; none → friendly "no link" message.
- Preview target that hangs, redirects forever, returns a non-image `og:image`, or points at `localhost` → link still saved, no error surfaced.
- Editing a link's URL to one that already exists → `409 duplicate_url` and the dialog says so.
- A link in the trash restored after > 30 days since it was saved → must survive the cron.

---

### Task 1: Shared helpers and types

**Files:**
- Modify: `shared/src/index.ts`
- Test: `desktop/test/links.test.ts`

**Interfaces:**
- Produces (all exported from `@fatup/shared`):
  - `type SiteCategory = 'facebook'|'youtube'|'instagram'|'threads'|'shopee'|'tiktok'|'internet'`; `const SITE_CATEGORIES: readonly SiteCategory[]` (display order as listed)
  - `normalizeUrl(raw: string): string | null` — trims, requires http/https, lowercases host, drops fragment, max 2048, returns `URL.href` minus fragment; `null` if invalid
  - `siteOf(url: string): SiteCategory`
  - `extractUrl(text: string): string | null` — first `https?://…` token, trailing `.,;)]}>"'` stripped, passed through `normalizeUrl`
  - `FileKind` adds `'link'`; `KindFilter` adds `'link'`; `FileItem` adds `url: string | null`, `site: SiteCategory | null` (null for non-links); `MAX_URL_LENGTH = 2048`
  - `CreateLinkRequest = { url: string; title?: string; device?: string }`

- [ ] **Step 1: Write failing tests** in `desktop/test/links.test.ts`: `siteOf('https://m.facebook.com/x')==='facebook'`, `siteOf('https://youtu.be/abc')==='youtube'`, `siteOf('https://vt.tiktok.com/x')==='tiktok'`, `siteOf('https://shp.ee/x')==='shopee'`, `siteOf('https://threads.net/@a')==='threads'`, `siteOf('https://notfacebook.com')==='internet'`, `siteOf('garbage')==='internet'`; `normalizeUrl('HTTPS://Example.COM/a#x')==='https://example.com/a'`, `normalizeUrl('ftp://x.com')===null`, `normalizeUrl('javascript:alert(1)')===null`, `normalizeUrl('x'.repeat(3000))===null`; `extractUrl('Xem cái này https://a.com/p?q=1. ok')==='https://a.com/p?q=1'`, two URLs → first, `extractUrl('no link')===null`.
- [ ] **Step 2:** Run `npm test -w @fatup/desktop -- links` → FAIL (exports missing).
- [ ] **Step 3:** Implement the helpers and type changes in `shared/src/index.ts`.
- [ ] **Step 4:** Run the same command → PASS; run `npm run typecheck` (expect worker/desktop errors only about the new required `FileItem` fields — fixed in later tasks; if blocking, make `url`/`site` assigned in Task 2 before running typecheck).
- [ ] **Step 5:** Commit `feat(shared): link types, siteOf, normalizeUrl, extractUrl`.

### Task 2: Worker storage and API for links

**Files:**
- Create: `worker/migrations/0005_links.sql`
- Modify: `worker/src/app.ts`, `worker/src/cleanup.ts`
- Test: `worker/test/api.test.ts`

**Interfaces:**
- Consumes: Task 1 helpers.
- Produces: `POST /links` (`CreateLinkRequest` → `FileItem`, 201 new / 200 existing); `GET /files?kind=link`; `PATCH /files/:id` accepts `url` for links; `Row` gains `url: string | null`, `previewed_at: number | null`, `title_set: number`; `toItem` fills `url` and `site`.

- [ ] **Step 1: Write failing tests** (new `describe('links')` in `worker/test/api.test.ts`): create returns kind `link`, name = hostname without title, name = title with title; `ftp:`/missing/over-2048 URL → 400; same URL twice → one row (second 200, same id); same URL after first is trashed → new row; `GET /files` (kind=all) omits links, `?kind=link` returns only links, `?trash=1` includes a trashed link, `?vault=1&kind=link` works after `PUT vault`; `GET /files/:id/download` on a link → 400 `not_a_file`; `PATCH {name}` sets `title_set` (later preview must not overwrite — asserted in Task 3); `PATCH {url:'https://b.com'}` on a link updates `url`, clears `thumbUrl`, deletes `thumbs/<id>.jpg` from the bucket; `PATCH {url}` equal to another link → 409 `duplicate_url`; `PATCH {url:'ftp://x'}` → 400; `PATCH {url}` on a file → 400; `/usage` unchanged by links; cleanup keeps a link whose `created_at` is 40 days old but deletes it when `deleted_at` is 40 days old; migration keeps existing rows (insert via `upload()` before… covered by applying all migrations in setup — assert `files` table still accepts `kind='image'`).
- [ ] **Step 2:** Run `npm test -w @fatup/worker` → new tests FAIL.
- [ ] **Step 3:** `0005_links.sql` rebuilds `files` as `files_new` with `kind IN ('image','file','text','link')` plus `url TEXT`, `previewed_at INTEGER`, `title_set INTEGER NOT NULL DEFAULT 0` (all existing columns preserved: deleted_at, retain_from, in_vault, tags), copies rows, drops and renames, recreates `idx_files_ready` and `idx_files_trash` (+ `idx_files_link_url` on `url` where `kind='link'`).
- [ ] **Step 4:** Implement in `app.ts`: `POST /links`; `kind` query accepts `link` and `all` adds `AND kind != 'link'`; download guard; PATCH extension (reset `previewed_at`, `has_thumb`, delete thumb from R2, reset name to hostname when `title_set=0`, set `title_set=1` on name change); `toItem` fills `url`/`site`. `cleanup.ts` group 1 adds `AND kind != 'link'`.
- [ ] **Step 5:** Run `npm test -w @fatup/worker` → all PASS. Commit `feat(worker): link bookmarks storage and API`.

### Task 3: Worker link preview

**Files:**
- Create: `worker/src/preview.ts`
- Modify: `worker/src/app.ts` (route), `worker/test/api.test.ts` or new `worker/test/preview.test.ts`

**Interfaces:**
- Produces: `fetchPreview(url: string, fetchImpl?: typeof fetch): Promise<{ title: string | null; image: { bytes: ArrayBuffer; type: string } | null }>` (never throws); `POST /links/:id/preview[?force=1]` → `FileItem` (404 for non-links/missing; without `force` and with `previewed_at` set it returns the item untouched). `createApp` options gain `fetch?: typeof fetch` so tests inject a fake.

- [ ] **Step 1: Write failing tests** with an injected fake fetch: og:title + og:image stored at `thumbs/<id>.jpg`, `has_thumb=1`, name replaced when `title_set=0`; name kept when `title_set=1`; `<title>` fallback; YouTube URL uses `https://www.youtube.com/oembed?...` and TikTok `https://www.tiktok.com/oembed?...`; fetch throws / non-HTML / hangs past timeout → 200, `previewed_at` set, nothing changed; `og:image` of `text/html` or > 1.5 MB ignored; `http://localhost`, `http://127.0.0.1`, `http://10.0.0.1`, `http://[::1]` rejected without calling fetch; redirect chain > 3 stops; second call without `force` doesn't call fetch, with `force=1` does; after `PATCH {url}` the preview runs again.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement `preview.ts`: manual redirect following (re-validating each hop's host), `AbortSignal.timeout(4000)`, read ≤ 512 KB via stream, regex meta parsing for `og:title|twitter:title|<title>` and `og:image|twitter:image` (resolve relative image URL), HTML-entity decode, oEmbed for youtube/tiktok via `siteOf`. Route writes thumb with `env.BUCKET.put(thumbKey(id), bytes, { httpMetadata: { contentType: 'image/jpeg' } })`.
- [ ] **Step 4:** Run → PASS. Commit `feat(worker): lazy link previews`.

### Task 4: Client bridge (desktop IPC and web)

**Files:**
- Modify: `desktop/src/main/api.ts`, `desktop/src/shared-ipc.ts`, `desktop/src/main/index.ts`, `desktop/src/preload/index.ts`, `web/src/browser-api.ts`, `desktop/src/renderer/src/lib/format.ts` (nothing else here)
- Test: `desktop/test/main.test.ts`

**Interfaces:**
- Consumes: Task 2/3 endpoints.
- Produces: `ApiClient.addLink(req: CreateLinkRequest): Promise<FileItem>`, `ApiClient.previewLink(id: string, force?: boolean): Promise<FileItem>`, `ApiClient.update` patch gains `url?: string`, `listAll` gains `kind?: 'all'|'link'`; `FatupApi.addLink(url: string, title?: string, vault?: boolean): Promise<Result<Item>>`, `FatupApi.previewLink(id: string, force?: boolean): Promise<Result<Item>>`, `FatupApi.openExternal(url: string): Promise<void>` (http/https only); `updateFile` patch gains `url`; `Tab` becomes `'all'|'image'|'file'|'link'` and `Prefs.viewModes` default adds `link: 'list'`; `list()`, `listVault()` return files **and** links merged (two requests, kind=all and kind=link).

- [ ] **Step 1: Write failing tests** in `desktop/test/main.test.ts` with a fake fetch: `addLink` POSTs `/links` with the body; `previewLink(id,true)` POSTs `/links/<id>/preview?force=1`; `listAll({kind:'link'})` sends `kind=link`; `update(id,{url})` PATCHes the URL.
- [ ] **Step 2:** Run `npm test -w @fatup/desktop` → FAIL.
- [ ] **Step 3:** Implement the `ApiClient` methods, then the IPC handlers/preload/web bridge (web `openExternal` = `window.open(url,'_blank','noopener')`; desktop = `shell.openExternal` after an http/https check). `addLink` with `vault=true` follows up with `setVault`. Stored prefs without `viewModes.link` must default (merge in `load()` of both desktop `config.ts` and `web/src/browser-api.ts`).
- [ ] **Step 4:** Run `npm test` and `npm run typecheck` → PASS. Commit `feat: link bridge for desktop and web`.

### Task 5: Links UI

**Files:**
- Create: `desktop/src/renderer/src/components/CowThumb.tsx`, `SiteBadge.tsx`, `AddLinkDialog.tsx`, `LinkEditPopover.tsx`
- Modify: `desktop/src/renderer/src/components/Main.tsx`, `Files.tsx`, `Tags.tsx` (only if the popover reuses it), `lib/i18n.ts`, `lib/format.ts`, `styles.css`
- Test: `desktop/test/renderer.test.ts`

**Interfaces:**
- Consumes: Task 4 bridge; `siteOf`, `SITE_CATEGORIES`, `extractUrl`, `normalizeUrl`.
- Produces: pure helpers in `format.ts`: `matchesSite(item: {url: string|null}, site: SiteCategory | 'all'): boolean`, `siteCounts(items): Record<SiteCategory | 'all', number>`, `linkHost(url: string): string`; components `CowThumb({size?: number})`, `SiteBadge({site})`.

- [ ] **Step 1: Write failing tests** in `renderer.test.ts` for `matchesSite`, `siteCounts`, `linkHost('https://www.example.com/a')==='example.com'`, `matchesQuery` over title **and** URL for links (add `matchesLink(item, query)`), and that the "all" tab predicate excludes links.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement helpers; `CowThumb` is a small inline SVG cow (ASCII-cow-like: body, spots, head, two eyes, udder) with `currentColor` strokes and token fills; `SiteBadge` draws the seven small glyph badges (no real logos, Internet = globe). `Main.tsx`: tab "Liên kết" (hidden count-free), site chip row with counts shown on the link tab only, "Thêm liên kết" button (next to Upload; ⌘/Ctrl+L), `open(item)` opens links via `openExternal`, kind-`all` tab excludes links, link-tab view mode, lazy preview effect (after the list loads: unpreviewed = links with `!item.thumbUrl && !previewedFlag` → hmm needs `previewed` — see below), "Tải lại xem trước" calls `previewLink(id,true)`. `Files.tsx`: link rows/cards show thumbnail or `CowThumb`, title, `SiteBadge` + host, tags, pencil opening `LinkEditPopover` (title + URL fields, tag dots, Enter/blur saves, Esc cancels, invalid URL red, `duplicate_url` → message "Liên kết này đã có"); menu entries Open, Copy link, Edit link, Reload preview. `AddLinkDialog`: URL field (prefilled from clipboard when it holds a URL, on focus), optional title; adds into the vault when the vault is open.
- [ ] **Step 4:** To know which links still need a preview, `FileItem` must expose it: add `previewed: boolean` to `FileItem` in `shared` and fill it in `toItem` (`previewed_at !== null`) — do this in Task 1/2 if building in order (the plan implementer adds the field to the Task 1 `FileItem` change and Task 2 `toItem`). Lazy preview effect: newest first, 2 concurrent, at most 20 per app open, patch the item in state when each finishes; newly added link previews immediately.
- [ ] **Step 5:** Run `npm test` and `npm run typecheck`. Then run the app per the `run` skill (web build against `wrangler dev` or the desktop mock server) and verify by hand: add a link, edit title/URL, filter by site, set a colour tag, open it, cow shows without image, dark mode. Commit `feat(ui): links tab, categories, edit and add dialogs, cowsay fallback`.

### Task 6: PWA share target

**Files:**
- Modify: `web/public/manifest.webmanifest`, `web/src/entry.ts`, `web/src/browser-api.ts` (or new `web/src/share.ts`), `README.md`
- Create: `web/src/share.ts`
- Test: `web/src/share.test.ts`

**Interfaces:**
- Produces: `takeSharedLink(search: string): { url: string; title?: string } | null` (reads `url`, `text`, `title` params; URL from `url` param else `extractUrl(text)`); `stashSharedLink(link)` / `popSharedLink()` over `sessionStorage` (try/catch). The UI, once `unlocked` becomes true, pops the stash, calls `addLink`, shows toast "Đã lưu liên kết", switches to the Links tab.

- [ ] **Step 1: Write failing tests**: `takeSharedLink('?text=Xem%20https%3A%2F%2Fa.com%2Fp&title=T')` → `{url:'https://a.com/p', title:'T'}`; `?url=https%3A%2F%2Fb.com` → url; no URL → `null`; stash/pop round-trips once (second pop `null`).
- [ ] **Step 2:** Run `npm test -w @fatup/web` → FAIL.
- [ ] **Step 3:** Implement; `entry.ts` stashes on load and `history.replaceState` strips the query; manifest gets `share_target` `{"action":"/","method":"GET","params":{"title":"title","text":"text","url":"url"}}`; the `Main` mount effect consumes the stash (guard against double-fire in React StrictMode). README notes the Android delay/reinstall caveat.
- [ ] **Step 4:** Run → PASS; manually load `/?text=…` in the built web app, confirm the link survives the PIN screen and saves once. Commit `feat(web): PWA share target for links`.

### Task 7: Android share of links

**Files:**
- Modify: `android/app/src/main/java/dev/fatup/app/ShareActivity.kt`, `Api.kt`, `UploadWorker.kt` (or new `LinkWorker.kt`), `res/values/strings.xml`, `res/values-vi/strings.xml`
- Create: `android/app/src/main/java/dev/fatup/app/Links.kt`
- Test: `android/app/src/test/java/dev/fatup/app/LogicTest.kt`

**Interfaces:**
- Produces: `fun extractUrl(text: String?): String?` in `Links.kt` (same rules as the TS helper); `Api.createLink(url: String, title: String?, device: String): Result` posting to `/links`; `LinkWorker.enqueue(context, url, title)` with network constraint and exponential backoff (401 and 4xx do not retry).

- [ ] **Step 1: Write failing Kotlin unit tests** for `extractUrl` mirroring the TS cases.
- [ ] **Step 2:** Run `cd android && ./gradlew testDebugUnitTest` → FAIL.
- [ ] **Step 3:** Implement. `ShareActivity`: if `ACTION_SEND` has no `EXTRA_STREAM` and `EXTRA_TEXT` holds a URL → enqueue `LinkWorker`, toast "Đã gửi liên kết"/`link_sent`; text without URL → toast `no_link_found`; title from `EXTRA_SUBJECT`/`EXTRA_TITLE`. Add both strings to `values` and `values-vi`.
- [ ] **Step 4:** Run `./gradlew testDebugUnitTest assembleDebug` → PASS (if the Android SDK is unavailable locally, say so and rely on CI). Commit `feat(android): share links to FatUp`.

### Task 8: Docs and final verification

**Files:** Modify `SPEC.md`, `README.md`.

- [ ] **Step 1:** Update `SPEC.md` (v4 banner; scope table; §3 migration `0005`; §4 API; §8 Android; §9 UI; §10 PWA share target; §12 table; §13 Phase 2 link bookmarks) in Vietnamese, matching the final code.
- [ ] **Step 2:** Run `npm test` and `npm run typecheck` at the root; expected all PASS. Report exact counts.
- [ ] **Step 3:** Commit `docs: spec v4 for link bookmarks`.
