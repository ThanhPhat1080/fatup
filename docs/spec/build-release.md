# Build, phát hành, triển khai, kiểm thử

> Một phần của [SPEC](../../SPEC.md). Đây là trạng thái **hiện tại**; đổi quyết định thì sửa file này trước, code sau.

## 11. Build, phát hành, triển khai, kiểm thử

### Build & phát hành

- `.github/workflows/release.yml` chạy khi push tag `v*`:
  - `desktop`: macOS (`.dmg`, arm64), Windows (`.exe` NSIS), Ubuntu (`AppImage`) bằng electron-builder, **không ký**. Đính kèm `latest*.yml` và `*.exe.blockmap` cho cập nhật tự động.
  - `android`: `assembleRelease`, ký bằng keystore từ secrets (`ANDROID_KEYSTORE_*`); thiếu secret thì ký bằng key debug ngẫu nhiên (bản sau không cài đè được bản trước).
  - Tạo **draft release**; phải bấm Publish thì app mới thấy bản mới.
- `.github/workflows/ci.yml` chạy khi push/PR: typecheck + test, build desktop, `assembleDebug` cho Android.

### Triển khai Cloudflare (người dùng chạy)

1. `npx wrangler login`
2. `npx wrangler r2 bucket create fatup-files`, `npx wrangler d1 create fatup` (chép `database_id` vào `worker/wrangler.toml`)
3. Trong `worker/`: `npm run db:migrate:remote`
4. Tạo R2 API token (Object Read & Write, chỉ bucket `fatup-files`), rồi `wrangler secret put R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ACCOUNT_ID`
5. `npm run token:new` rồi `wrangler secret put API_TOKEN`
6. `npm run deploy`

**Nâng cấp:** `npm run db:migrate:remote` rồi `npm run deploy`, theo thứ tự đó. Biến tùy chọn: `R2_QUOTA_GB` (đổi giới hạn hiển thị của thanh dung lượng). Free tier đủ dùng: R2 10 GB, Workers 100k request/ngày, D1 5 GB.

Bản két mã hóa (0.5.0) có thêm các bước kiểm sau deploy: xem mục Nâng cấp của [CHANGELOG.md](../../CHANGELOG.md). Không cần chạy lại `npm run r2:cors` vì két không đọc ETag nữa.

### Kiểm thử

Không ghi số lượng test ở đây (nhanh bị cũ); chạy `npm test` để biết. Cách viết test cho từng package: `CLAUDE.md` của package đó.

- **Worker** (vitest + Workers pool, D1/R2 giả lập; gồm link: tạo, trùng URL, danh sách, sửa tiêu đề/URL, cron và xem trước với `fetch` giả): auth, upload/complete, phân trang; đổi tên và thẻ màu (`PATCH`); thùng rác (xóa mềm, liệt kê, khôi phục, xóa vĩnh viễn, dọn sạch); két sắt (chuyển vào/ra, validate, xóa từ két; `/vault/*`: thiết lập, bộ đếm sai và khóa theo thời gian, khôi phục, đổi PIN; cất vào két theo `attempt`, `enc_object` và complete muộn; thùng rác của két; dọn bản rõ sót khi lấy ra); `/usage`; cron (chỉ thùng rác hết hạn, upload dở, `shares` hết hạn); link chia sẻ (`share.test.ts`: chủ file, route công khai, thu hồi khi vào két/thùng rác).
- **Desktop** (vitest; gồm `siteOf`/`normalizeUrl`/`extractUrl`, lọc link theo loại, `ApiClient` cho link): nhóm theo ngày, sắp xếp, ngưỡng và định dạng dung lượng, đặt tên tránh trùng, PIN lockout, i18n, `ApiClient`, so sánh version cập nhật, hàng đợi upload (server HTTP giả: stream, tiến độ, lỗi, hủy, upload vào két); két sắt (mã hóa FUV1, phiên và khóa, chuyển đổi, IPC không lộ khóa, hàm thuần của giao diện).
- **Web** (vitest; gồm share target giữ link qua khóa PIN): mã hóa token bằng PIN, quy tắc khóa sau 5 lần sai, và hàng đợi upload web (thứ tự file/thumbnail/complete, 2 file cùng lúc, giới hạn 100 MB, lỗi, hủy, vào két, đặt tên thiết bị); két trong trang (`vault-web.test.ts`, `vault-crypto.test.ts`).
- **E2E desktop** (Playwright cho Electron, API giả `desktop/e2e/mock-server.mjs`): chia theo vùng trong `desktop/e2e/areas/` — `setup` (lần đầu, màn khóa), `files` (danh sách, lọc, tìm kiếm, tải về, quan trọng, xem PDF, viewer ảnh, vào thùng rác), `share` (link chia sẻ, thu hồi, tiêu đề Thùng rác/Két sắt), `links` (lọc nền tảng, nhóm, xem trước), `settings` (QR sau PIN, chế độ tối), `vault` (thiết lập và recovery key, cổng 6 số với PIN sai, upload vào két, thùng rác của két; khi chưa giữ khóa thì popup PIN trên danh sách khi cất vào két, sai PIN và hủy, PIN đúng; khi đang giữ khóa thì cất không hỏi lại, và vào màn Két sắt vẫn hỏi PIN; thông báo khi cất lỗi); mỗi vùng chạy riêng được (`npm run e2e -- <vùng>`). Thêm `desktop/e2e/lock-phone.mjs` cho màn khóa trên điện thoại. CI chạy toàn bộ dưới `xvfb-run`.
- **Chưa có:** test render component; E2E cho bản PWA trong trình duyệt và cho upload thật. Android chỉ có unit test cho logic thuần (kể cả `Links.extractUrl`, `Api.createLink`); các test Android chạy trên CI vì máy phát triển có thể không có Android SDK.
