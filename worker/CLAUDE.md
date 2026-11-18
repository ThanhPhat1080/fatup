# worker/ — Cloudflare Worker (Hono + D1 + R2)

Spec: `docs/spec/data.md` (schema D1), `docs/spec/api.md` (API, liên kết, link chia sẻ), `docs/spec/lifecycle.md` (thùng rác, két, cron), `docs/spec/security.md`, `docs/spec/build-release.md` (deploy).

## Bản đồ

| File | Chứa |
|---|---|
| `src/index.ts` | điểm vào: `fetch` = `createApp()`, `scheduled` = cron hằng ngày (03:00 UTC) → `cleanup` |
| `src/app.ts` | mọi route. `/health` và `/s/*` được đăng ký **trước** middleware kiểm tra Bearer token; mọi route sau đó đều cần token |
| `src/share-public.ts`, `src/share-page.ts` | route công khai `/s/:token`, `/s/:token/file` và trang HTML không JS của chúng |
| `src/vault.ts` | két sắt mã hóa: `/vault/*` (trạng thái, thiết lập, mở két có bộ đếm sai, khôi phục, đổi PIN) và `/files/:id/vault/in`, `/vault/out` (mỗi lần cất vào là một `attempt` với object riêng `vault/<id>.<attempt>`, `in` đặt `in_vault = 1` ngay, complete ghi `enc_object`; dọn bản rõ sót). `registerVaultRoutes` được gọi trong `app.ts`. Đếm sai: `WRONG_ATTEMPT_SQL` |
| `src/presign.ts` | presigned URL S3 SigV4 (`aws4fetch`), `fileKey`/`thumbKey`, `vaultFileKey`/`vaultThumbKey`, `objectKeys` (cặp key theo `encrypted` và `enc_object`), `contentDisposition` theo RFC 5987; `get(..., { stable: true })` ký từ đầu giờ, sống 2 giờ (URL không đổi trong giờ đó; dùng cho ảnh gốc làm `thumbUrl`) |
| `src/import.ts`, `src/object-store.ts` | nhập ảnh từ thư mục của bucket (`IMPORT_PREFIX`) cho `POST /import/sync`: `importImages` (id xác định từ key + etag, thứ tự `pending` → copy → kiểm size → `ready` → xóa bản gốc nếu etag còn khớp), `normalizeImportPrefix` (từ chối `files/`, `thumbs/`, `vault/`, cả bucket). `ObjectStore` (list/head/copy/delete) đi qua **S3 API**, không qua binding `BUCKET` (bản `wrangler dev` có R2 giả lập riêng). Test tiêm `objectStore` vào `createApp`. Xem `docs/spec/api.md` 4.4, ADR 0018 |
| `src/preview.ts` | xem trước link: tải trang, đọc tiêu đề/og:image (có giới hạn dung lượng và thời gian) |
| `src/cleanup.ts` | cron: xóa file trong thùng rác > 30 ngày (kể cả thùng rác của két), upload dở > 24 giờ, bản rõ sót khi lấy ra khỏi két (`out_started_at` > 1 giờ), dòng `shares` hết hạn. `purge` xóa mọi key của hàng (kể cả theo `enc_object`), theo lô 100 id; `sweepVaultGarbage` (gọi cuối `cleanup`) dọn object rác dưới `vault/` (hàng đã mất hoặc attempt khác `enc_object`, tuổi > 1 giờ). Upload dở đi qua `purgePending`: xóa dòng trước và chỉ khi còn `pending`, rồi mới xóa object (một lần nhập có thể vừa hoàn tất dòng đó) |
| `src/env.ts` | binding: `DB`, `BUCKET`, secret `API_TOKEN`, `R2_*`, tùy chọn `R2_QUOTA_GB` |
| `migrations/NNNN_*.sql` | schema D1, áp dụng theo thứ tự |
| `public/` | bản build của `web/` (gitignore); phục vụ dạng file tĩnh |

Type dùng chung với client (`FileItem`, dạng request/response, giới hạn) nằm ở `@fatup/shared`, không ở đây.

## Test

`npm test -w @fatup/worker` — vitest với `@cloudflare/vitest-plugin` (giả lập D1/R2 thật, migration được áp dụng trong `test/setup.ts`).

- Tạo app bằng `createApp({ presigner: fakePresigner })` rồi gọi `app.request(path, init, env)`; xem các helper ở đầu `test/api.test.ts` (`call`, `postJson`, `upload`). Dùng lại chúng, đừng viết helper mới.
- Ghi object R2 thẳng vào `env.BUCKET`; xóa bảng trong `beforeEach`.
- Mạng (xem trước link) được tiêm vào dạng `fetch` giả (`test/preview.test.ts`); test không bao giờ gọi internet.
- File: `api.test.ts` (API chính, thùng rác, liên kết, cron), `share.test.ts` (link chia sẻ + thu hồi), `preview.test.ts`.
- Két sắt: `vault.test.ts` (bộ đếm sai, khóa theo thời gian, hai request song song, `GET /vault` không lộ bí mật), `vault-routes.test.ts` (setup, unlock, recover, `PUT /vault/pin`), `vault-files.test.ts` (upload vào két, `PATCH` `encMeta`, 426, `DELETE` và thùng rác của két, cron), `vault-move.test.ts` (`vault/in|out`, attempt, hai máy cùng cất một file).
- Nhập ảnh từ thư mục của bucket: `object-store.test.ts` (S3 qua `fetch` giả), `import.test.ts` (song song, ngắt giữa chừng, ghi đè, cron, lô 10), `import-route.test.ts` (`POST /import/sync`, `hasThumb`/`thumbUrl`), `thumb.test.ts` (thumbnail bù), `presign-stable.test.ts` (URL ổn định theo giờ).

## Quy tắc

- Schema mới → file mới `migrations/000N_<tên>.sql`. Không bao giờ sửa migration đã áp dụng. Test tự nhận migration mới.
- Thu hồi link chia sẻ nằm ở cấu trúc dữ liệu (trigger SQL `shares_revoke_on_hide`) — đừng chuyển vào code route. ADR 0003.
- Mọi lý do "link chết" trả cùng một `404`. Chỉ ảnh raster được phục vụ inline trên `/s/`. ADR 0004.
- API không gửi header CORS (PWA cùng origin); CORS của R2 nằm ở `r2-cors.json`.
- Lỗi đi qua `fail(c, status, code, message)` để client nhận `{ error: { code, message } }`. Ngoại lệ có chủ ý: `403`/`423` của `unlock` và `PUT /vault/pin` bằng `authKey` trả body phẳng `{ remaining, lockedUntil }`.
- Két sắt: `/vault/*` nằm sau middleware token như mọi route trừ `/health` và `/s/*`. Mọi UPDATE đếm sai là **một câu** (`WRONG_ATTEMPT_SQL`), đừng tách thành SELECT rồi UPDATE. `GET /vault` không bao giờ trả `auth_hash`, `server_secret`, `wrapped_mk_*` hay `rk_auth_hash`. `vault/in/complete` trên hàng chưa mã hóa phải kèm `attempt`; D1 chỉ ghi khóa của lần thử thắng (`UPDATE ... WHERE encrypted = 0`).
- Đổi schema két: thêm migration mới; `0009` đã được áp dụng ở đâu thì không bao giờ sửa lại.
- Sau khi đổi route hoặc bảng: `docs/spec/data.md` / `api.md` và mục "Nâng cấp" của `CHANGELOG.md` phải nói đã đổi gì.
