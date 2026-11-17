# desktop/ — app Electron; renderer của nó cũng là giao diện của PWA

Spec: `docs/spec/desktop-ui.md` (màn hình, liên kết, chia sẻ, lightbox, upload, dung lượng, theme, cập nhật, i18n, kiến trúc Electron, màn hình khóa).

**Bộ React trong `src/renderer/` được phát hành hai lần**: trong Electron, và trong PWA (`web/` import `src/renderer/src/main`). Mọi thay đổi giao diện ảnh hưởng cả hai. Khác biệt duy nhất là bridge `window.fatup`: của Electron đến từ `src/preload/`, của web từ `web/src/browser-api.ts`. Cả hai cài đặt `FatupApi` trong `src/shared-ipc.ts`.

## Bản đồ

| Đường dẫn | Chứa |
|---|---|
| `src/shared-ipc.ts` | `FatupApi` (hợp đồng của bridge), `AppState`, `Item`, `UploadJob`… Đổi file này → sửa **cả** `src/preload/index.ts`, `src/main/index.ts` (IPC handler) và `web/src/browser-api.ts` |
| `src/main/index.ts` | main process của Electron: cửa sổ, IPC handler, tải về |
| `src/main/api.ts` | `ApiClient` (fetch tới Worker). Bản web cũng dùng |
| `src/main/config.ts`, `pin.ts` | config trong `userData`, token qua `safeStorage`, PIN scrypt + khóa khi sai |
| `src/vault-session.ts` | `VaultSession`: phiên két mã hóa (giữ master key trong `#private`, không bao giờ extractable; `setup` (= `prepareSetup` + `commitSetup`: tạo khóa và recovery key mà chưa gọi server, rồi mới POST sau khi người dùng xác nhận)/`unlock`/`recover`/`changePin` (bộ đếm thế hệ: `close()` chen vào lúc đang chờ thì lời gọi trả lỗi `closed`, không mở lại két)/`decryptList` (mục không giải mã được thì đánh dấu `unreadable`, không làm hỏng cả danh sách)/`reencryptMeta` (đổi tên, sửa URL)/`encryptMetaFor`/`fileKey`). **Không import Node** vì bản web dùng lại; `ApiClient` và hàm kiểm tra PIN app (`boolean` hoặc `Promise<boolean>`: web phải chờ PBKDF2) được truyền vào |
| `src/vault-handlers.ts` | `createVaultCore(deps)`: logic các lời gọi két mã hóa dùng chung cho desktop và web, **không import Node/Electron** (trạng thái/thiết lập hai bước `vaultSetupPrepare`+`vaultSetupCommit`/mở/khôi phục/đổi PIN, `listVault` đã giải mã (két đóng giữa chừng thì trả `vault_locked` và không ghi nhớ mục nào), `updateFile` (đổi tên = `encMeta` mới), `addLink` (liên kết thẳng vào két, mã hóa 0 byte), `fileBytes`/`download`/`copyImageBytes`/`previewUrl`, `serve`). Phần khác nhau giữa hai nơi được truyền vào: `saveDownload` (ghi đĩa / `saveFile`) và `views` (`VaultViews`: `fatup-vault://` ở desktop, `blob:` URL ở web, thu hồi hết khi đóng két) |
| `src/main/vault-ipc.ts` | lớp mỏng của desktop trên `createVaultCore`, **không import Electron** (test được): `createVaultHandlers(deps)` thêm ghi file tải về xuống thư mục (`uniqueFileName`) và `vaultProtocol` phục vụ `fatup-vault://thumb|file/<id>` từ bộ nhớ (chỉ khi két mở, không ghi đĩa). `index.ts` chỉ định tuyến tới đây (`owns(id)`) và gọi `vaultClose()` ở `lock`/`reset`. Renderer không bao giờ nhận `MK`/`DEK`/`S` |
| `src/main/vault-mover.ts` | `createVaultMover(deps)`, **không import Electron**: `moveIn`/`moveOut` (từng file: tải → mã hóa/giải mã trong bộ nhớ → PUT → complete; lỗi một file chỉ đưa id vào `failed`, không dừng cả loạt) và `migrateLegacy` (mã hóa mục két cũ chưa mã hóa, cả trong thùng rác của két), `startMigration` (chạy nền, mỗi lần một) và `moveOutIds` (lấy ra theo id; mục két cũ còn rõ được mã hóa trước). Chuyển vào két gửi `etag` (header ETag của PUT `vault/<id>`) cho `moveInComplete`, 409 `item_changed` thì thử lại một lần từ đầu; chuyển ra mà lỗi sau khi đã PUT bản rõ thì gọi `moveInComplete` không etag để server dọn bản rõ. Chạy lại sau khi bị ngắt là an toàn. `index.ts` và `web/src/vault-web.ts` cùng dùng nó: gọi từ `vaultMoveIn`/`vaultMoveOut`, phát tiến trình (`vaultProgress`), và chạy `startMigration` sau khi `vaultSetup`/`vaultSetupCommit`/`vaultUnlock`/`vaultRecover` thành công |
| `src/main/uploader.ts` | `UploadManager` (hàng đợi, 2 file cùng lúc, tiến độ, hủy); upload vào két mã hóa file (stream `encryptStream`) và thumbnail trước khi PUT, lỗi `vault_locked` nếu két đóng |
| `src/main/previews.ts`, `src/preview-cache.ts`, `src/main/webpreview.ts` | ảnh xem trước của link (`fatup-preview://`) và xem trang web trong app |
| `src/renderer/src/components/Main.tsx` | màn hình chính (file lớn nhất; tab, bộ lọc, menu, thao tác hàng loạt) |
| `src/renderer/src/components/Files.tsx` | hiển thị dạng lưới/danh sách |
| `src/renderer/src/components/Lock*.tsx`, `Moria*`, `Fellowship` | màn hình khóa có hoạt họa |
| `src/renderer/src/components/VaultGate.tsx`, `LockWizard` (dùng chung với cổng két) | cổng 6 số của két sắt, có ông phù thủy và hiệu ứng nổ |
| `src/renderer/src/components/VaultSetup.tsx`, `VaultRecover.tsx`, `VaultPinChange.tsx` | trình thiết lập hai bước (PIN, recovery key, xác nhận 2 nhóm), màn khôi phục, đổi PIN két trong Cài đặt |
| `src/renderer/src/components/VaultTrash.tsx`, `VaultTrashIcon.tsx`, `VaultFrame.tsx` | thùng rác của két (sidebar 70% / toàn màn hình ≤ 720 px), icon của nó, khung chế độ két (`vault-mode`) |
| `src/renderer/src/lib/vault.ts` | hàm thuần của két: bước thiết lập, thông báo cổng và lỗi, kế hoạch cất vào két, xác nhận recovery key — có unit test. Logic giao diện két đặt ở đây, không ở component |
| `src/renderer/src/lib/format.ts` | hàm thuần: nhóm, sắp xếp, lọc, dung lượng — có unit test |
| `src/renderer/src/lib/i18n.ts` | từ điển `en` và `vi` |
| `src/main/web-globals.d.ts` | khai báo kiểu `CryptoKey`, `BodyInit` cho các test (project không có DOM lib) |
| `e2e/smoke.mjs` | runner E2E: chạy các vùng trong `e2e/areas/`, mỗi vùng một mock server + profile riêng |
| `e2e/harness.mjs` | phần dùng chung: `createHarness`, `launch`, `launchReady` (setup nhanh, PIN 1234), `log` (watchdog), `shot`, `kind`, `showAll`, `typePin` |
| `e2e/areas/*.mjs` | các vùng E2E: `setup` (lần đầu + màn khóa), `files`, `share`, `links`, `settings`, `vault` (két sắt: thiết lập + recovery key, upload, thùng rác của két, khóa sai PIN) |
| `e2e/lock-phone.mjs`, `e2e/mock-server.mjs` | màn khóa trên khung điện thoại; API giả dùng chung |

## Test

- Unit: `npm test -w @fatup/desktop` (vitest, `test/*.test.ts`). Logic giao diện được test qua hàm thuần trong `lib/` — đặt logic mới ở đó, không đặt trong component, để test được. `test/uploader.test.ts` chạy một HTTP server giả.
- Két sắt: `test/vault-crypto.test.ts` (FUV1, khóa, recovery key), `vault-session.test.ts` (phiên, setup hai bước, bộ đếm thế hệ), `vault-api.test.ts` (client `/vault/*`), `vault-mover.test.ts` (cất, lấy ra, chuyển đổi), `vault-ipc.test.ts` (IPC và scheme, renderer không nhận khóa), `vault-ui.test.ts` (`lib/vault.ts`), `vault-styles.test.ts`, `vault-shared.test.ts`, `vault-wiring.test.ts`.
- E2E: `npm run e2e` chạy mọi vùng; `npm run e2e -- links share` (hoặc `E2E_ONLY=links,share`) chỉ chạy các vùng đó; đã build rồi thì `node e2e/smoke.mjs links` (trong `desktop/`) để bỏ bước build. `npm run e2e:lock -w @fatup/desktop` cho màn khóa trên điện thoại. Cần màn hình (CI bọc bằng `xvfb-run`). `SCREENSHOT_DIR=…` lưu ảnh chụp (lỗi thì có `failure-<vùng>.png`); `E2E_VERBOSE=1` in từng bước.
  - Mỗi vùng bắt đầu từ trạng thái sạch (mock server, profile, thư mục tải về riêng), nên không phụ thuộc thứ tự. Thêm vùng mới: tạo `e2e/areas/<tên>.mjs` export `run(h)`, rồi thêm vào `AREAS` trong `smoke.mjs`.
  - Thêm kiểm tra cho một tính năng: đặt vào vùng của tính năng đó, bắt đầu bằng `h.launchReady()`. API giả là `e2e/mock-server.mjs` — thêm route/dữ liệu vào đó khi cần (`test/e2e-mock.test.ts` kiểm tra dữ liệu giả và các route két). Két sắt trong API giả giữ bản mã như client gửi, không giải mã; PUT trả header `ETag` và `vault/in/complete` đòi `etag` khớp như Worker; thời gian khóa rút ngắn bằng `E2E_VAULT_LOCK_SCALE` (mặc định 1).
- Chưa có test render component. Với thay đổi về hình ảnh/tương tác, kiểm tra bằng agent `e2e-verifier` hoặc bằng tay, và nói rõ đã dùng cách nào.
- Khi cần verify lại code khi fix bug, implement feature, chỉ cần chạy E2E những khu vực liên quan (`npm run e2e -- <vùng>`), không chạy lại toàn bộ. Chỉ chạy lại toàn bộ trước khi tạo PR.

## Quy tắc

- Renderer không có quyền Node (`contextIsolation`, `sandbox`) và không bao giờ thấy token API; mọi thứ đi qua `window.fatup`.
- Mọi chuỗi hiển thị cho người dùng phải có cả `en` và `vi` trong `lib/i18n.ts`.
- Bố cục điện thoại (PWA) quan trọng: màn cảm ứng không có hover, giữ lâu 450 ms để chọn, nút bấm 40–44 px (`docs/spec/web.md` §10.2).
