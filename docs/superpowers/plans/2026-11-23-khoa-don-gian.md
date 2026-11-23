# Khóa đơn giản (tùy chọn "Dùng khóa LOTR") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thêm checkbox "Dùng khóa LOTR" (mặc định tắt); khi tắt, màn khóa app và cổng Két sắt dùng một cánh cửa Moria nhẹ (một lớp sáng đổi `opacity` chậm), cổng Két sắt có chữ VAULT.

**Architecture:** Thêm `Prefs.lotrLock` (lưu như theme, dùng chung desktop và web). Hàm thuần `lib/lock-scene.ts` quyết định cảnh nào hiển thị. Component mới `SimpleDoor` dùng lại `MoriaDoor` (`DoorBody`, `DoorDefs` không có bộ lọc phát sáng). `Lock.tsx` và `VaultGate.tsx` rẽ nhánh theo `lotrLock`; nhánh tick giữ nguyên code cũ.

**Tech Stack:** React + TS (renderer dùng chung desktop/PWA), vitest, Playwright e2e của desktop.

**Spec:** `docs/superpowers/specs/2026-11-23-khoa-don-gian-design.md`

## Global Constraints

- Mặc định `lotrLock: false` cho mọi thiết bị, kể cả config/localStorage cũ không có khóa này.
- Chuỗi hiển thị có cả `en` và `vi` trong `desktop/src/renderer/src/lib/i18n.ts`. Chữ "VAULT" trên cửa là cố định, không dịch.
- Nhịp sáng khoảng 4 giây; mở cửa mờ dần khoảng 0,3 giây; sai PIN chỉ lắc ô PIN (`.pin--shake`, có sẵn trong `PinInput`).
- Bản đơn giản **không** dùng: `feGaussianBlur`/`filter`, `halo`, đá, vệt sáng hắt, `moria-leaf`, `moria__flash`, `LockBackdrop`, ông phù thủy, bom.
- Đổi `shared-ipc.ts` → sửa cả `main/config.ts` và `web/src/browser-api.ts` (cả hai tự merge `prefs`).
- `prefers-reduced-motion`: lớp sáng đứng yên, PIN đúng vào ngay.
- PIN, bộ đếm sai, khóa tạm, `vaultUnlock`: không đổi.
- Code, comment, commit bằng tiếng Anh; chỉ commit khi người dùng yêu cầu (người dùng đã yêu cầu release trước đó; commit trên nhánh mới từ `main`, không push trừ khi được bảo).

## Review Focus

- Config/localStorage cũ không có `lotrLock` → phải là `false` (test ở Task 1).
- Đổi checkbox khi đang ở màn Cài đặt rồi khóa app → màn khóa dùng giá trị mới (Task 4: `Lock` nhận `lotr` từ `state.prefs` sau `reload`).
- Cổng Két sắt bản đơn giản: PIN đúng vào ngay, Quay lại thoát ngay, không còn timer 3,4 giây (Task 4).
- 6 ô PIN vừa trong thân cửa ở màn hẹp 320 px (Task 3 CSS, kiểm bằng e2e ảnh chụp).
- e2e cũ kiểm cảnh Moria đầy đủ (`lock-phone.mjs`) vẫn chạy được vì bật `lotrLock` trước (Task 4).

---

### Task 1: Tùy chọn `lotrLock` và hàm chọn cảnh

**Model:** Sonnet (đổi hợp đồng `Prefs` mà nhiều package phụ thuộc)

**Files:**
- Modify: `desktop/src/shared-ipc.ts` (`Prefs`)
- Modify: `desktop/src/main/config.ts` (`DEFAULT_PREFS`)
- Modify: `web/src/browser-api.ts` (`DEFAULT_PREFS`)
- Create: `desktop/src/renderer/src/lib/lock-scene.ts`
- Test: `desktop/test/lock-scene.test.ts`; thêm ca vào test của config (tìm trong `desktop/test/main.test.ts` chỗ test `Config`/prefs, nếu không có thì ghi trong `lock-scene.test.ts`)

**Interfaces:**
- Produces: `Prefs.lotrLock: boolean`;
  `type LockScene = 'moria' | 'gate' | 'simple'`;
  `lockScene(lotr: boolean, phone: boolean): LockScene` (tắt → `'simple'`; bật → `phone ? 'gate' : 'moria'`);
  `vaultGateStill(lotr: boolean, still: boolean): boolean` (tắt → `true`; bật → `still`).

- [ ] **Step 1: Write the failing tests** in `lock-scene.test.ts`: `lockScene(false, false)`, `lockScene(false, true)` đều `'simple'`; `lockScene(true, false)` `'moria'`; `lockScene(true, true)` `'gate'`; `vaultGateStill(false, false)` `true`, `vaultGateStill(true, false)` `false`, `vaultGateStill(true, true)` `true`. Thêm: `DEFAULT_PREFS.lotrLock === false` (import từ `main/config`), và một config đọc từ JSON cũ không có `lotrLock` cho ra `prefs.lotrLock === false` (theo cách test config hiện có tạo `Config` từ file).
- [ ] **Step 2: Run** `npm test -w @fatup/desktop -- lock-scene` → FAIL (module/field thiếu).
- [ ] **Step 3: Implement** `lotrLock: boolean` trong `Prefs`; `lotrLock: false` trong cả hai `DEFAULT_PREFS`; tạo `lock-scene.ts` đúng chữ ký trên (không import DOM).
- [ ] **Step 4: Run** `npm test -w @fatup/desktop -- lock-scene && npm run typecheck` → PASS.
- [ ] **Step 5: Commit** `feat: lotrLock pref and lock scene chooser`.

### Task 2: Checkbox ở Cài đặt và chuỗi i18n

**Model:** Haiku

**Files:**
- Modify: `desktop/src/renderer/src/lib/i18n.ts` (thêm `lotrLock`, `lotrLockHint` cả `en` và `vi`)
- Modify: `desktop/src/renderer/src/components/Settings.tsx` (hàng mới sau hàng Appearance, cùng cấu trúc `settings__row`)
- Modify: `desktop/src/renderer/src/styles.css` (chỉ nếu cần để checkbox + mô tả đẹp trong `settings__row`)

**Interfaces:**
- Consumes: `state.prefs.lotrLock`, `onPrefs({ lotrLock })` (Task 1).
- Produces: chuỗi `t.lotrLock` (`en` "Use LOTR lock", `vi` "Dùng khóa LOTR"), `t.lotrLockHint` (`en` "Off: a simple, lighter lock screen. Better for phones.", `vi` "Tắt: màn khóa đơn giản, nhẹ hơn. Hợp với điện thoại.").

- [ ] **Step 1: Add strings** vào cả hai từ điển (kiểu từ điển buộc đủ khóa; typecheck bắt thiếu).
- [ ] **Step 2: Add the row**: `<input type="checkbox" checked={state.prefs.lotrLock} onChange={(e) => onPrefs({ lotrLock: e.target.checked })}>` có `aria-label={t.lotrLock}`, nhãn `t.lotrLock`, dòng mô tả `t.lotrLockHint`; cảm ứng nút ≥ 40 px (`docs/spec/web.md` §10.2).
- [ ] **Step 3: Run** `npm run typecheck` → PASS.
- [ ] **Step 4: Commit** `feat: LOTR lock checkbox in settings`.

### Task 3: Cánh cửa đơn giản `SimpleDoor`

**Model:** Sonnet (đụng `DoorDefs` dùng chung với cảnh đầy đủ)

**Files:**
- Modify: `desktop/src/renderer/src/components/MoriaDoor.tsx`: `DoorDefs({ glow = true }: { glow?: boolean })`; `glow === false` thì không xuất `<filter id="moria-glow">`. Hành vi mặc định không đổi.
- Create: `desktop/src/renderer/src/components/SimpleDoor.tsx`
- Modify: `desktop/src/renderer/src/styles.css` (khối `.sdoor*` mới, đặt sau khối `.gate`)
- Test: `desktop/test/simple-door.test.ts`

**Interfaces:**
- Consumes: `BASE, CX, DoorBody, DoorDefs` từ `MoriaDoor.tsx`.
- Produces: `SimpleDoor(props: { open: boolean; cells?: 4 | 6; label?: string; children: ReactNode; below?: ReactNode })`. `children` là ô PIN đặt trên thân cửa; `label` (ví dụ `"VAULT"`) là chữ đặt trên đỉnh cửa; `below` là dòng lỗi/nút. Class gốc `sdoor`, thêm `sdoor--open` khi `open`, `sdoor--6` khi `cells === 6`.

- [ ] **Step 1: Write the failing test** `simple-door.test.ts`: (a) `renderToStaticMarkup(<SimpleDoor open={false} label="VAULT">x</SimpleDoor>)` chứa `VAULT`, `sdoor__lit`, không chứa `feGaussianBlur`, `moria-glow`, `gate__halo`, `gate__stones`; (b) `open` → chứa `sdoor--open`; (c) đọc `styles.css`, các rule có selector bắt đầu `.sdoor` không chứa `filter:`, `blur(`, `moria-leaf`; rule `.sdoor__lit` có `animation:` với thời lượng ≥ 3s và `will-change: opacity`; có `@media (prefers-reduced-motion: reduce)` đặt `animation: none` cho `.sdoor__lit`.
- [ ] **Step 2: Run** `npm test -w @fatup/desktop -- simple-door` → FAIL.
- [ ] **Step 3: Implement `SimpleDoor`**: một SVG nền (cùng `VIEW_BOX` với `LockGate`: x 525, y 190, w 550, h 560) gồm `DoorDefs glow={false}`, tường `moria-rock`, `DoorBody`, và `<use href="#moria-frame" opacity=.16>`/`#moria-inner` mờ; một SVG thứ hai `sdoor__lit` chỉ chứa `<use href="#moria-frame"/>` và `<use href="#moria-inner"/>` (không filter). Không `stones`, không `halo`, không mặt nền. Ô PIN đặt như `.gate__pin` (tọa độ theo `cqw`); `.sdoor--6` thu nhỏ ô còn khoảng 6cqw để 6 ô vừa trong thân cửa ở 320 px. `open`: `.sdoor` mờ dần 0,3 s (`opacity`), không `moria-leaf`/burst/flash.
- [ ] **Step 4: Implement CSS** `.sdoor`, `.sdoor__door`, `.sdoor__base`, `.sdoor__lit` (animation 4s ease-in-out infinite giữa `opacity` 0.7 và 1, `will-change: opacity`), `.sdoor__label` (chữ in hoa cách chữ rộng, màu `#d6efff`, không `text-shadow` lớn), `.sdoor__pin`, `.sdoor--open`, khối reduced-motion, `.sdoor__below` (dùng lại kiểu `.gate__below`).
- [ ] **Step 5: Run** `npm test -w @fatup/desktop -- simple-door && npm run typecheck` → PASS; chạy cả `vault-styles` và `moria`-liên quan (`npm test -w @fatup/desktop`) để chắc cảnh đầy đủ không đổi.
- [ ] **Step 6: Commit** `feat: lightweight SimpleDoor for the lock screens`.

### Task 4: Nối vào màn khóa app, cổng Két sắt và e2e

**Model:** Haiku

**Files:**
- Modify: `desktop/src/renderer/src/App.tsx`: `<Lock lotr={state.prefs.lotrLock} .../>`
- Modify: `desktop/src/renderer/src/components/Lock.tsx`: prop `lotr: boolean`; chọn cảnh bằng `lockScene(lotr, phone)`; `'simple'` → `<SimpleDoor open={open} below={below}>{pin}</SimpleDoor>`; `prefersReducedMotion()` giữ nguyên; thời gian chờ mở cửa của bản đơn giản là 300 ms thay cho `OPEN_MS`.
- Modify: `desktop/src/renderer/src/components/VaultGate.tsx`: prop `lotr: boolean`; hook giữ nguyên thứ tự (chỉ rẽ nhánh ở JSX); `stillGate()` thay bằng `vaultGateStill(lotr, stillGate())` (cả `goBack` và `submit`); `!lotr` → `<div className="lockscreen vaultscreen">` không có `LockBackdrop`, thay phần `LockWizard` bằng `<SimpleDoor open={false} cells={6} label="VAULT" below={…}>` chứa `PinInput` (`length={VAULT_PIN_LENGTH}`), dòng lỗi, nút Quay lại, `hint` nếu có; bản đơn giản không dùng `Boom`.
- Modify: `desktop/src/renderer/src/components/Main.tsx:981`: truyền `lotr={state.prefs.lotrLock}`.
- Modify: `desktop/e2e/lock-phone.mjs` (và mọi chỗ e2e cần cảnh đầy đủ): trước khi khóa, `await page.evaluate(() => window.fatup.setPrefs({ lotrLock: true }))`.
- Modify: `desktop/e2e/areas/settings.mjs` (hoặc `vault.mjs` cho phần két): thêm kiểm tra mới.

**Interfaces:**
- Consumes: `lockScene`, `vaultGateStill` (Task 1); `SimpleDoor` (Task 3); `t.lotrLock` (Task 2).

- [ ] **Step 1: Wire** như trên; kiểm `npm run typecheck`.
- [ ] **Step 2: e2e settings**: sau `launchReady()` (mặc định tắt), nhấn "Khóa" → thấy `.sdoor`, không có `.moria`; nhập `1234` → vào lại app. Mở Cài đặt, tick "Dùng khóa LOTR", khóa lại → thấy `.moria` (cảnh đầy đủ) hoặc `.gate` (cửa sổ hẹp). Mở Két sắt khi chưa tick → thấy chữ `VAULT` trong `.sdoor`, không có `.wizard`; Quay lại thoát ngay (không chờ 3,4 giây).
- [ ] **Step 3: Run** `npm run e2e -- settings vault setup` và `npm run e2e:lock -w @fatup/desktop` → PASS (cần màn hình; nếu không chạy được máy này thì nói rõ, đừng báo pass).
- [ ] **Step 4: Run** `npm run typecheck && npm test` → PASS.
- [ ] **Step 5: Commit** `feat: simple lock screens when LOTR lock is off`.

### Task 5: Tài liệu

**Model:** Haiku (agent `doc-keeper`)

**Files:**
- Modify: `docs/spec/desktop-ui.md` (§ màn hình khóa và cổng két: thêm khóa đơn giản, mặc định tắt, tùy chọn ở Cài đặt; sửa các câu đang nói điện thoại tự dùng cửa rút gọn: nay điện thoại chỉ dùng `LockGate` khi tick), `docs/spec/web.md` nếu nhắc màn khóa điện thoại
- Create: `docs/decisions/0020-khoa-don-gian-mac-dinh.md` (ADR: khóa mặc định đơn giản vì lag; tick để dùng cảnh LOTR; phương án C là dự phòng) và thêm một dòng vào `docs/decisions/README.md`
- Modify: `CHANGELOG.md` (phiên bản kế tiếp, mục **Thêm/Đổi**, **Nâng cấp**: không migration, không đổi server; người dùng cũ sẽ thấy khóa đơn giản cho tới khi tick lại)
- Modify: `desktop/CLAUDE.md` (bản đồ: `SimpleDoor.tsx`, `lib/lock-scene.ts`)

- [ ] **Step 1:** cập nhật các file trên; ghi mọi "Quyết định do Claude tự đưa ra" trong spec vào ADR.
- [ ] **Step 2: Run** `npm run docs:check` → không cảnh báo thiếu.
- [ ] **Step 3: Commit** `docs: simple lock screens (LOTR lock off by default)`.
