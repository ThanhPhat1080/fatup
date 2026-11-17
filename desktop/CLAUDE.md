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
| `src/vault-session.ts` | `VaultSession`: phiên két mã hóa (giữ master key trong `#private`, không bao giờ extractable; `setup`/`unlock`/`recover`/`changePin`/`decryptList`/`encryptMetaFor`/`fileKey`). **Không import Node** vì bản web dùng lại; `ApiClient` và hàm kiểm tra PIN app được truyền vào |
| `src/main/vault-ipc.ts` | logic IPC của két mã hóa ở main, **không import Electron** (test được): `createVaultHandlers(deps)` (trạng thái/thiết lập/mở/khôi phục/đổi PIN, `listVault` đã giải mã, `fileBytes`/`download`/`copyImageBytes`/`previewUrl`) và `vaultProtocol` phục vụ `fatup-vault://thumb|file/<id>` từ bộ nhớ (chỉ khi két mở, không ghi đĩa). `index.ts` chỉ định tuyến tới đây (`owns(id)`) và gọi `vaultClose()` ở `lock`/`reset`. Renderer không bao giờ nhận `MK`/`DEK`/`S` |
| `src/main/uploader.ts` | `UploadManager` (hàng đợi, 2 file cùng lúc, tiến độ, hủy); upload vào két mã hóa file (stream `encryptStream`) và thumbnail trước khi PUT, lỗi `vault_locked` nếu két đóng |
| `src/main/previews.ts`, `src/preview-cache.ts`, `src/main/webpreview.ts` | ảnh xem trước của link (`fatup-preview://`) và xem trang web trong app |
| `src/renderer/src/components/Main.tsx` | màn hình chính (file lớn nhất; tab, bộ lọc, menu, thao tác hàng loạt) |
| `src/renderer/src/components/Files.tsx` | hiển thị dạng lưới/danh sách |
| `src/renderer/src/components/Lock*.tsx`, `Moria*`, `Fellowship`, `VaultGate` | màn hình khóa có hoạt họa và cổng két sắt |
| `src/renderer/src/lib/format.ts` | hàm thuần: nhóm, sắp xếp, lọc, dung lượng — có unit test |
| `src/renderer/src/lib/i18n.ts` | từ điển `en` và `vi` |
| `e2e/smoke.mjs` | runner E2E: chạy các vùng trong `e2e/areas/`, mỗi vùng một mock server + profile riêng |
| `e2e/harness.mjs` | phần dùng chung: `createHarness`, `launch`, `launchReady` (setup nhanh, PIN 1234), `log` (watchdog), `shot`, `kind`, `showAll`, `typePin` |
| `e2e/areas/*.mjs` | các vùng E2E: `setup` (lần đầu + màn khóa), `files`, `share`, `links`, `settings` |
| `e2e/lock-phone.mjs`, `e2e/mock-server.mjs` | màn khóa trên khung điện thoại; API giả dùng chung |

## Test

- Unit: `npm test -w @fatup/desktop` (vitest, `test/*.test.ts`). Logic giao diện được test qua hàm thuần trong `lib/` — đặt logic mới ở đó, không đặt trong component, để test được. `test/uploader.test.ts` chạy một HTTP server giả.
- E2E: `npm run e2e` chạy mọi vùng; `npm run e2e -- links share` (hoặc `E2E_ONLY=links,share`) chỉ chạy các vùng đó; đã build rồi thì `node e2e/smoke.mjs links` (trong `desktop/`) để bỏ bước build. `npm run e2e:lock -w @fatup/desktop` cho màn khóa trên điện thoại. Cần màn hình (CI bọc bằng `xvfb-run`). `SCREENSHOT_DIR=…` lưu ảnh chụp (lỗi thì có `failure-<vùng>.png`); `E2E_VERBOSE=1` in từng bước.
  - Mỗi vùng bắt đầu từ trạng thái sạch (mock server, profile, thư mục tải về riêng), nên không phụ thuộc thứ tự. Thêm vùng mới: tạo `e2e/areas/<tên>.mjs` export `run(h)`, rồi thêm vào `AREAS` trong `smoke.mjs`.
  - Thêm kiểm tra cho một tính năng: đặt vào vùng của tính năng đó, bắt đầu bằng `h.launchReady()`. API giả là `e2e/mock-server.mjs` — thêm route/dữ liệu vào đó khi cần (`test/e2e-mock.test.ts` kiểm tra dữ liệu giả).
- Chưa có test render component. Với thay đổi về hình ảnh/tương tác, kiểm tra bằng agent `e2e-verifier` hoặc bằng tay, và nói rõ đã dùng cách nào.
- Khi cần verify lại code khi fix bug, implement feature, chỉ cần chạy E2E những khu vực liên quan (`npm run e2e -- <vùng>`), không chạy lại toàn bộ. Chỉ chạy lại toàn bộ trước khi tạo PR.

## Quy tắc

- Renderer không có quyền Node (`contextIsolation`, `sandbox`) và không bao giờ thấy token API; mọi thứ đi qua `window.fatup`.
- Mọi chuỗi hiển thị cho người dùng phải có cả `en` và `vi` trong `lib/i18n.ts`.
- Bố cục điện thoại (PWA) quan trọng: màn cảm ứng không có hover, giữ lâu 450 ms để chọn, nút bấm 40–44 px (`docs/spec/web.md` §10.2).
