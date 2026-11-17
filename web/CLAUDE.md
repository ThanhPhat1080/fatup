# web/ — lớp vỏ PWA bọc giao diện desktop

Spec: `docs/spec/web.md` (PWA, upload từ web, giao diện điện thoại), `docs/spec/security.md` (mã hóa token trên web).

Giao diện **không ở đây**: `src/entry.ts` cài bridge cho trình duyệt rồi import `desktop/src/renderer/src/main`. Sửa giao diện thì đọc `desktop/CLAUDE.md`.

## Bản đồ

| File | Chứa |
|---|---|
| `src/entry.ts` | điểm vào: nhận link từ Web Share Target, `installBrowserApi()`, tải giao diện desktop, đăng ký service worker |
| `src/browser-api.ts` | `window.fatup` cho trình duyệt (cài đặt `FatupApi` trong `desktop/src/shared-ipc.ts`) bằng `fetch` + `localStorage`. Các lời gọi két mã hóa đi qua `createWebVault`; `lock`/`reset` gọi `vaultClose()`; mục két không bao giờ đi vào `previews` (Cache Storage) |
| `src/vault-web.ts` | `createWebVault(deps)`: két mã hóa trong bộ nhớ trang, dùng lại `VaultSession`, `createVaultCore` (`desktop/src/vault-handlers.ts`) và `createVaultMover`. Thumbnail/xem trước là `blob:` URL từ byte đã giải mã, `vaultClose()` (đồng bộ) thu hồi mọi URL; tải về qua `saveFile`; chuyển file cũ chạy nền sau `vaultSetupCommit`/`vaultSetup`/unlock/recover; thiết lập hai bước `vaultSetupPrepare`/`vaultSetupCommit`; R2 phải cho CORS lộ header `ETag` (move-in đọc nó từ PUT); `uploadEncryptor()` cho `WebUploadManager`. Không ghi `localStorage`/IndexedDB/Cache Storage, không nhận kho ảnh xem trước |
| `src/vault.ts` | token mã hóa AES-GCM, khóa dẫn xuất từ PIN (PBKDF2-SHA256, 310 000 vòng); quy tắc sai PIN 5 lần |
| `src/uploader.ts` | `WebUploadManager` (cùng interface hàng đợi với `UploadManager` của desktop; XHR để có tiến độ; thumbnail bằng canvas). Upload vào két: mã hóa file + thumbnail trong bộ nhớ (`encryptBytes`), tên/loại giả, `vault: { encMeta, encKey }`; két đóng hoặc thiếu `deps.vault` → lỗi `vault_locked`, không tạo gì |
| `src/share.ts` | `takeSharedLink` / giữ link qua màn hình PIN |
| `src/preview-store.ts` | ảnh xem trước của link trong Cache Storage |
| `public/` | manifest (có `share_target`), service worker `sw.js`, icon |

## Build / dev

- `vite build` xuất ra `../worker/public/` (Worker phục vụ thư mục này). `npm run deploy -w @fatup/worker` build web trước.
- `npm run dev:web` với `FATUP_SERVER=https://…workers.dev` (hoặc `web/.env.local`) chuyển các đường dẫn API liệt kê trong `vite.config.ts` → `API_PATHS`. **Thêm đường dẫn API cấp đầu mới thì phải thêm vào đó.**

## Test

`npm test -w @fatup/web` — vitest chạy trong node, test nằm cạnh mã nguồn (`src/*.test.ts`). Phụ thuộc được tiêm vào (`WebUploadDeps`); làm theo cách đó thay vì mock biến toàn cục.

## Quy tắc

- Service worker chỉ cache app shell/asset: không bao giờ cache API, presigned URL, hay trang chia sẻ `/s/`.
- Không ghi dữ liệu két (khóa, tên giải mã, byte) vào `localStorage`/IndexedDB/Cache Storage, và không đưa mục két vào `preview-store`.
- Đổi `FatupApi` thì phải đổi cả bridge này (và preload + main của Electron).
