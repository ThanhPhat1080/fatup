# worker/ — Cloudflare Worker (Hono + D1 + R2)

Spec: `docs/spec/data.md` (schema D1), `docs/spec/api.md` (API, liên kết, link chia sẻ), `docs/spec/lifecycle.md` (thùng rác, két, cron), `docs/spec/security.md`, `docs/spec/build-release.md` (deploy).

## Bản đồ

| File | Chứa |
|---|---|
| `src/index.ts` | điểm vào: `fetch` = `createApp()`, `scheduled` = cron hằng ngày (03:00 UTC) → `cleanup` |
| `src/app.ts` | mọi route. `/health` và `/s/*` được đăng ký **trước** middleware kiểm tra Bearer token; mọi route sau đó đều cần token |
| `src/share-public.ts`, `src/share-page.ts` | route công khai `/s/:token`, `/s/:token/file` và trang HTML không JS của chúng |
| `src/presign.ts` | presigned URL S3 SigV4 (`aws4fetch`), `fileKey`/`thumbKey`, `contentDisposition` theo RFC 5987 |
| `src/preview.ts` | xem trước link: tải trang, đọc tiêu đề/og:image (có giới hạn dung lượng và thời gian) |
| `src/cleanup.ts` | cron: xóa file trong thùng rác > 30 ngày, upload dở > 24 giờ, dòng `shares` hết hạn |
| `src/env.ts` | binding: `DB`, `BUCKET`, secret `API_TOKEN`, `R2_*`, tùy chọn `R2_QUOTA_GB` |
| `migrations/NNNN_*.sql` | schema D1, áp dụng theo thứ tự |
| `public/` | bản build của `web/` (gitignore); phục vụ dạng file tĩnh |

Type dùng chung với client (`FileItem`, dạng request/response, giới hạn) nằm ở `@fatup/shared`, không ở đây.

## Test

`npm test -w @fatup/worker` — vitest với `@cloudflare/vitest-plugin` (giả lập D1/R2 thật, migration được áp dụng trong `test/setup.ts`).

- Tạo app bằng `createApp({ presigner: fakePresigner })` rồi gọi `app.request(path, init, env)`; xem các helper ở đầu `test/api.test.ts` (`call`, `postJson`, `upload`). Dùng lại chúng, đừng viết helper mới.
- Ghi object R2 thẳng vào `env.BUCKET`; xóa bảng trong `beforeEach`.
- Mạng (xem trước link) được tiêm vào dạng `fetch` giả (`test/preview.test.ts`); test không bao giờ gọi internet.
- File: `api.test.ts` (API chính, thùng rác, két sắt, liên kết, cron), `share.test.ts` (link chia sẻ + thu hồi), `preview.test.ts`.

## Quy tắc

- Schema mới → file mới `migrations/000N_<tên>.sql`. Không bao giờ sửa migration đã áp dụng. Test tự nhận migration mới.
- Thu hồi link chia sẻ nằm ở cấu trúc dữ liệu (trigger SQL `shares_revoke_on_hide`) — đừng chuyển vào code route. ADR 0003.
- Mọi lý do "link chết" trả cùng một `404`. Chỉ ảnh raster được phục vụ inline trên `/s/`. ADR 0004.
- API không gửi header CORS (PWA cùng origin); CORS của R2 nằm ở `r2-cors.json`.
- Lỗi đi qua `fail(c, status, code, message)` để client nhận `{ error: { code, message } }`.
- Sau khi đổi route hoặc bảng: `docs/spec/data.md` / `api.md` và mục "Nâng cấp" của `CHANGELOG.md` phải nói đã đổi gì.
