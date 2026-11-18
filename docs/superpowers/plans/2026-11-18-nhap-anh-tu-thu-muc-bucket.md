# Nhập ảnh từ thư mục của app khác trong bucket: plan triển khai

> **Cho agent thực hiện:** dùng superpowers:subagent-driven-development (khuyến nghị) hoặc superpowers:executing-plans, từng task một. Mỗi step có checkbox `- [ ]`. Theo `CLAUDE.md`: agent `test-writer` viết test thất bại trước, rồi `touch .claude/tests-frozen`; agent cài đặt dùng đúng `Model:` của task.

**Mục tiêu:** ảnh app khác ghi vào `d30/` trong bucket hiện ở danh sách chính của Fatup (desktop và web) khi mở/làm mới; mỗi ảnh được di chuyển sang `files/<id>`, không bao giờ thành hai dòng.

**Kiến trúc:** `POST /import/sync` (Worker) liệt kê `IMPORT_PREFIX` qua S3 API, tính id xác định từ (key, etag), `INSERT OR IGNORE` dòng `pending`, copy trong R2, kiểm kích thước, đánh dấu `ready`, rồi mới xóa bản gốc. Client gọi nó khi làm mới (cách nhau ≥ 30 giây). Desktop tạo thumbnail bù; client khác hiện ảnh gốc qua `thumbUrl`.

**Công nghệ:** Hono + D1 + R2 (vitest workers pool), `aws4fetch` (đã có), Electron/React dùng chung với PWA.

**Spec:** `docs/superpowers/specs/2026-11-18-nhap-anh-tu-thu-muc-bucket-design.md`

**Nhánh/worktree:** làm trong worktree riêng tách từ `main` (nhánh `feat/vault-e2ee` còn thay đổi chưa commit). `app.ts` sẽ chạm file mà nhánh két cũng sửa; xử lý xung đột khi merge.

## Ràng buộc chung

- **Không migration.** Không đổi schema D1.
- Chỉ ảnh: đuôi (không phân biệt hoa thường) `png jpg jpeg gif webp bmp heic heif avif`; key không kết thúc bằng `/`; `0 < size ≤ MAX_FILE_SIZE` (100 MB). Còn lại bỏ qua, **không bao giờ xóa**.
- Mỗi lần `POST /import/sync` nhập tối đa **20** ảnh (`IMPORT_BATCH`); client gọi cách nhau ≥ **30 giây** (`IMPORT_SYNC_MIN_GAP_MS`).
- Thứ tự bất biến mỗi ảnh: id → `INSERT OR IGNORE pending` → copy → kiểm size → `ready` (+`created_at` = giờ upload của object) → xóa bản gốc. **Bản gốc chỉ bị xóa sau `ready`.**
- Id = ULID có phần thời gian là `uploaded` (ms) và phần ngẫu nhiên từ `SHA-256(key + "\0" + etag)`.
- Mọi thao tác R2 của việc nhập (list, head, copy, delete) đi qua S3 API (`ObjectStore`), **không** qua binding `BUCKET`; file không đi qua Worker (ADR 0002).
- Nhãn thiết bị của ảnh nhập = `IMPORT_PREFIX` bỏ dấu `/` cuối (ví dụ `d30`), tối đa 64 ký tự.
- `IMPORT_PREFIX` rỗng/không có = tính năng tắt. Prefix không được là rỗng, `/`, `files/`, `thumbs/`, `vault/` (hoặc nằm trong chúng): coi như tắt.
- Lỗi quét **không hiện cho người dùng** và không chặn danh sách.
- Chuỗi hiển thị phải có `en` và `vi` (hiện không thêm chuỗi mới nào).
- Chỉ commit/push khi người dùng yêu cầu.
- Nâng cấp: không migration; deploy Worker (đặt `IMPORT_PREFIX`), phát hành desktop, deploy PWA.

## Review Focus

Các ca spec ngụ ý mà không task nào hiển nhiên kiểm; mỗi dòng có test ở task sở hữu code:

1. **App kia ghi đè `d30/x.png` giữa lúc copy và lúc xóa bản gốc** → không được xóa bản mới (Task 2).
2. **Key có ký tự lạ** (dấu cách, tiếng Việt, `&`, `+`, `#`, `%`) → liệt kê, copy và tên hiển thị đều đúng (Task 1, 2).
3. **`IMPORT_PREFIX` không có `/` cuối, hoặc trỏ vào `files/`, `thumbs/`, `vault/`** → `d30` không được khớp `d300/`; tự nhập chính object của Fatup là thảm họa nên bị từ chối (Task 3).
4. **Dòng `pending` kẹt gặp cron 03:00** → cron xóa dòng và `files/<id>`, bản gốc còn nguyên, lần quét sau nhập lại sạch (Task 3).
5. **Hơn 20 ảnh và ảnh không phải ảnh nằm xen** → `more = true`, các lần sau nhập tiếp, file không phải ảnh không bị đụng và không tính vào 20 (Task 2).

---

### Task 1: Lớp `ObjectStore` qua S3 API

**Model:** Sonnet

**Files:**
- Create: `worker/src/object-store.ts`
- Test: `worker/test/object-store.test.ts`
- Modify: `shared/src/index.ts` (hằng số, xem Task 3 phần Interfaces; ở task này chưa cần)

**Interfaces:**
- Produces:
  ```ts
  export type ListedObject = { key: string; size: number; etag: string; uploaded: number };
  export class ObjectMissingError extends Error {}
  export type ObjectStore = {
    list(prefix: string, cursor?: string): Promise<{ objects: ListedObject[]; next: string | null }>;
    head(key: string): Promise<{ size: number; etag: string } | null>;
    copy(from: string, to: string): Promise<void>; // ném ObjectMissingError khi nguồn không còn
    delete(key: string): Promise<void>; // không có thì coi như xong
  };
  export function createObjectStore(env: Env, fetchImpl?: typeof fetch): ObjectStore;
  ```
- Consumes: `Env` (`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ACCOUNT_ID`, `R2_BUCKET_NAME`), `aws4fetch` như `worker/src/presign.ts`.

- [ ] **Step 1: Viết test thất bại** (`object-store.test.ts`, `fetchImpl` giả ghi lại request):
  - `list('d30/')` gọi `GET https://acct.r2.cloudflarestorage.com/<bucket>?list-type=2&prefix=d30%2F&max-keys=1000`, parse XML (`Key`, `Size`, `ETag`, `LastModified`, `NextContinuationToken`); `etag` bỏ dấu `"`/`&quot;`; `uploaded` là ms của `LastModified`; `next` null khi `IsTruncated` là `false`; truyền `cursor` thành `continuation-token`.
  - Key chứa `&amp;`, `&lt;`, tiếng Việt, dấu cách được giải mã đúng (`Ảnh chụp & thử.png`).
  - `copy('d30/a b.png','files/ID')` gửi `PUT .../files/ID` với header `x-amz-copy-source: /<bucket>/d30/a%20b.png`; phản hồi `200` có thân `<Error><Code>NoSuchKey</Code>` hoặc `404` → ném `ObjectMissingError`; `200` thường → xong.
  - `delete` chấp nhận `204` và `404`; `head` trả `null` khi `404`, trả `{size, etag}` từ `Content-Length`/`ETag` khi `200`.
  - Request đều có chữ ký (`Authorization` bắt đầu `AWS4-HMAC-SHA256`).
- [ ] **Step 2: Chạy test, xác nhận thất bại**: `npm test -w @fatup/worker -- object-store`. Kỳ vọng: FAIL (module chưa có).
- [ ] **Step 3: Cài `createObjectStore`** theo chữ ký trên, dùng `AwsClient` (`service: 's3'`, `region: 'auto'`) như `presign.ts`; URL cơ sở `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_BUCKET_NAME}`, mã hóa từng đoạn key bằng `encodeURIComponent`; XML đọc bằng regex theo thẻ (không thêm thư viện), giải mã 5 thực thể `&amp; &lt; &gt; &quot; &apos;`.
- [ ] **Step 4: Chạy test, xác nhận đạt**: cùng lệnh. Kỳ vọng: PASS.

---

### Task 2: Logic nhập ảnh `importImages`

**Model:** Sonnet

**Files:**
- Create: `worker/src/import.ts`
- Modify: `worker/src/ulid.ts` (thêm `ulidFrom`)
- Test: `worker/test/import.test.ts`

**Interfaces:**
- Consumes: `ObjectStore`, `ObjectMissingError` (Task 1); `fileKey` (`worker/src/presign.ts`); `sanitizeName` (`worker/src/app.ts`); `MAX_FILE_SIZE` (`@fatup/shared`).
- Produces:
  ```ts
  // ulid.ts
  export function ulidFrom(time: number, random: Uint8Array /* 16 byte */): string; // cùng bảng chữ cái với ulid()
  // import.ts
  export const IMPORT_BATCH = 20;
  export function isImportableImage(key: string, size: number): boolean;
  export function imageMime(key: string): string; // png→image/png, jpg|jpeg→image/jpeg, gif, webp, bmp, heic, heif, avif
  export function importId(key: string, etag: string, uploadedMs: number): Promise<string>;
  export async function importImages(env: Env, store: ObjectStore, prefix: string, limit = IMPORT_BATCH): Promise<{ imported: number; more: boolean }>;
  ```
  `imported` = số dòng thành `ready` trong lần chạy này. `more` = còn ảnh cần nhập chưa được xét (đã đủ `limit`, hoặc còn trang liệt kê).

- [ ] **Step 1: Viết test thất bại** (`import.test.ts`; `ObjectStore` giả dựng trên `env.BUCKET` ở đầu file: `list` bằng `BUCKET.list`, `copy` bằng get/put, `head`, `delete`; một biến thể có thể ném lỗi ở bước chỉ định). Các test:
  - `isImportableImage`: `a.PNG` đúng; `a.pdf`, `d30/` (kết thúc `/`), `a.png` size 0, `a.png` size `MAX_FILE_SIZE + 1` sai.
  - `importId`: cùng (key, etag, time) → cùng id; khác etag hoặc khác key → khác id; kết quả thỏa `isUlid` và 10 ký tự đầu mã hóa đúng `time`.
  - Ảnh mới: sau `importImages` có đúng 1 dòng `ready` (`kind='image'`, `mime='image/png'`, `device='d30'`, `has_thumb=0`, `name` = đoạn cuối key, `created_at` = `uploaded` của object), `files/<id>` có nội dung, `d30/...` đã bị xóa; trả `{ imported: 1, more: false }`.
  - Chạy hai lần liên tiếp không tạo dòng thứ hai. Hai lần chạy **song song** (`Promise.all`) trên cùng một ảnh để lại đúng 1 dòng và 1 object `files/<id>`.
  - Ngắt sau copy (store ném ở `head`): dòng còn `pending`, bản gốc còn nguyên; chạy lại → `ready`, bản gốc mất, vẫn 1 dòng.
  - Ngắt giữa `ready` và xóa (store ném ở `delete`): dòng `ready`, bản gốc còn; chạy lại chỉ xóa bản gốc, không tạo dòng mới, `imported` là 0.
  - **Review Focus 1:** sau copy nhưng trước xóa, ghi đè `d30/x.png` bằng nội dung khác (etag khác) → bản gốc mới **không bị xóa**; lần chạy sau nhập nó thành ảnh thứ hai (id khác).
  - **Review Focus 2:** key `d30/Ảnh chụp & thử #1.png` nhập đúng, `name` = `Ảnh chụp & thử #1.png`.
  - **Review Focus 5:** 25 ảnh xen 5 file `.txt` → lần 1 `{imported: 20, more: true}`, lần 2 `{imported: 5, more: false}`; các `.txt` còn nguyên.
  - Thư mục con (`d30/a/b.png`) được nhập, `name = 'b.png'`.
- [ ] **Step 2: Chạy test, xác nhận thất bại**: `npm test -w @fatup/worker -- import`. Kỳ vọng: FAIL.
- [ ] **Step 3: Cài `ulidFrom`, `isImportableImage`, `imageMime`, `importId`, `importImages`** theo chữ ký trên và thứ tự bất biến ở Ràng buộc chung. Gợi ý chọn: `INSERT OR IGNORE` rồi `SELECT status` để biết dòng đã có; copy gặp `ObjectMissingError` thì bỏ qua ảnh đó; trước khi xóa bản gốc phải `head(source)` và chỉ xóa khi `etag` còn bằng etag đã liệt kê; `UPDATE ... WHERE id = ? AND status = 'pending'`.
- [ ] **Step 4: Chạy test, xác nhận đạt**: cùng lệnh. Kỳ vọng: PASS.

---

### Task 3: Route `POST /import/sync`, `hasThumb`, ảnh gốc làm `thumbUrl`

**Model:** Sonnet

**Files:**
- Modify: `worker/src/env.ts` (`IMPORT_PREFIX?: string`), `worker/wrangler.toml` (`[vars] IMPORT_PREFIX = "d30/"`), `worker/src/app.ts` (`AppOptions.objectStore`, route, `toItem`), `shared/src/index.ts`
- Test: `worker/test/import-route.test.ts`; sửa assertion cũ chỉ khi chúng mâu thuẫn trực tiếp với `hasThumb`/`thumbUrl` mới

**Interfaces:**
- Consumes: `importImages`, `IMPORT_BATCH` (Task 2); `createObjectStore` (Task 1).
- Produces:
  ```ts
  // shared/src/index.ts
  export const IMPORT_SYNC_MIN_GAP_MS = 30_000;
  export type ImportSyncResponse = { imported: number; more: boolean };
  // FileItem thêm: hasThumb: boolean   (true khi D1 has_thumb = 1; luôn trả, kể cả mục mã hóa)
  // app.ts
  AppOptions.objectStore?: (env: Env) => ObjectStore; // mặc định createObjectStore
  POST /import/sync → 200 ImportSyncResponse
  ```
  `toItem`: `thumbUrl` = thumbnail như cũ khi `has_thumb`; khi `has_thumb = 0` mà `kind = 'image'` và `encrypted = 0` thì là presigned GET của `files/<id>` (`contentType: row.mime`); còn lại `null`.

- [ ] **Step 1: Viết test thất bại** (`import-route.test.ts`, `createApp({ presigner: fakePresigner, objectStore })` với store giả như Task 2):
  - Không token → 401. `IMPORT_PREFIX` rỗng/không đặt → `{imported:0, more:false}` và store không bị gọi.
  - Có `d30/a.png` → `{imported:1, more:false}`, rồi `GET /files` thấy ảnh với `device:'d30'`, `hasThumb:false`, `thumbUrl` chứa `files/<id>`.
  - **Review Focus 3:** prefix `d30` (không `/`) chỉ khớp `d30/…`, không khớp `d300/x.png`; prefix `files/`, `thumbs/`, `vault/`, `/`, rỗng → tắt (store không bị gọi).
  - Hai `POST /import/sync` song song → `GET /files` có đúng một ảnh.
  - **Review Focus 4:** dòng `pending` do nhập (created_at cũ hơn 24 giờ) gặp `cleanup(env, now)` → dòng và `files/<id>` bị xóa, bản gốc còn; `POST /import/sync` tiếp theo nhập lại, còn đúng 1 dòng.
  - Ảnh thường có thumbnail: `hasThumb:true` và `thumbUrl` chứa `thumbs/`; mục mã hóa không có thumbnail: `thumbUrl` vẫn `null`.
- [ ] **Step 2: Chạy test, xác nhận thất bại**: `npm test -w @fatup/worker -- import-route`. Kỳ vọng: FAIL.
- [ ] **Step 3: Cài** hằng số/kiểu ở `shared`, `Env`, biến trong `wrangler.toml`, `AppOptions.objectStore`, chuẩn hóa prefix (thêm `/` cuối nếu thiếu; từ chối các prefix cấm ở Ràng buộc chung), route (đăng ký sau middleware token), `toItem` (cả `hasThumb`). Route không bắt lỗi của store: để Hono trả 500, client bỏ qua.
- [ ] **Step 4: Chạy toàn bộ test worker**: `npm test -w @fatup/worker && npm run typecheck`. Kỳ vọng: PASS; nếu assertion cũ về `thumbUrl`/`toEqual` của `FileItem` vỡ vì hai trường mới thì cập nhật đúng chỗ đó.

---

### Task 4: Endpoint tạo thumbnail bù

**Model:** Sonnet

**Files:**
- Modify: `worker/src/app.ts`, `shared/src/index.ts` (`ThumbUploadResponse = { thumbUploadUrl: string }`)
- Test: `worker/test/thumb.test.ts`

**Interfaces:**
- Produces: `POST /files/:id/thumb` → `200 ThumbUploadResponse` (presigned PUT tới `thumbs/<id>.jpg`); `POST /files/:id/thumb/complete` → `200 FileItem` (đặt `has_thumb = 1`).
- Điều kiện chung: dòng `status='ready'`, `deleted_at IS NULL`, `kind='image'`, `encrypted=0`, `in_vault=0`; sai → `404 not_found` (không có/không đủ điều kiện) hoặc `409 encrypted` (mục mã hóa). `complete` mà `thumbs/<id>.jpg` chưa có → `409 not_uploaded`.

- [ ] **Step 1: Viết test thất bại** (dùng helper `upload` và `postJson` giống `api.test.ts`): ảnh thường xin được URL `https://r2.test/put/thumbs/<id>.jpg`; chưa PUT mà `complete` → 409; sau `BUCKET.put(thumbKey(id))` rồi `complete` → `hasThumb: true`; file không phải ảnh, mục trong thùng rác, mục trong két → 404; mục mã hóa → 409.
- [ ] **Step 2: Chạy test, xác nhận thất bại**: `npm test -w @fatup/worker -- thumb`. Kỳ vọng: FAIL.
- [ ] **Step 3: Cài hai route** theo bảng trên, dùng `c.get('presigner').put(thumbKey(id))` và `c.env.BUCKET.head(thumbKey(id))` (cùng kiểu `/uploads/:id/complete`).
- [ ] **Step 4: Chạy test, xác nhận đạt**: `npm test -w @fatup/worker && npm run typecheck`. Kỳ vọng: PASS.

---

### Task 5: Client gọi đồng bộ khi làm mới (desktop + web)

**Model:** Sonnet (hợp đồng IPC dùng chung nhiều package)

**Files:**
- Modify: `desktop/src/main/api.ts`, `desktop/src/shared-ipc.ts`, `desktop/src/preload/index.ts`, `desktop/src/main/index.ts`, `web/src/browser-api.ts`, `desktop/src/renderer/src/components/Main.tsx`
- Create: `desktop/src/renderer/src/lib/import-sync.ts`
- Test: `desktop/test/import-sync.test.ts`, bổ sung `desktop/test/main.test.ts` hoặc `vault-wiring.test.ts` nếu cần (xem cách các test hiện có kiểm tra `FatupApi` ở preload/web)

**Interfaces:**
- Consumes: `ImportSyncResponse`, `IMPORT_SYNC_MIN_GAP_MS`, `ThumbUploadResponse` (shared, Task 3, 4).
- Produces:
  ```ts
  // ApiClient
  importSync(): Promise<ImportSyncResponse>;           // POST /import/sync
  thumbUpload(id: string): Promise<ThumbUploadResponse>; // POST /files/:id/thumb
  thumbComplete(id: string): Promise<FileItem>;          // POST /files/:id/thumb/complete
  // FatupApi
  importSync(): Promise<Result<ImportSyncResponse>>;
  // lib/import-sync.ts
  export function shouldSyncImport(now: number, last: number, minGap = IMPORT_SYNC_MIN_GAP_MS): boolean; // last = 0 → true
  ```
  Đổi `FatupApi` thì sửa **cả** `preload/index.ts`, `main/index.ts` (IPC `importSync`, bọc `guarded`) và `web/src/browser-api.ts`.

- [ ] **Step 1: Viết test thất bại**: `shouldSyncImport(1000, 0)` đúng; `(30_000, 1_000)` sai; `(31_000, 1_000)` đúng; test `ApiClient.importSync` gọi `POST /import/sync` và trả thân JSON (theo mẫu của `vault-api.test.ts`/`share.test.ts`).
- [ ] **Step 2: Chạy test, xác nhận thất bại**: `npm test -w @fatup/desktop -- import-sync`. Kỳ vọng: FAIL.
- [ ] **Step 3: Cài** `shouldSyncImport`, ba phương thức `ApiClient`, `FatupApi.importSync` ở cả ba nơi. Trong `Main.tsx`: sau khi `refresh` hoàn tất, nếu `shouldSyncImport(Date.now(), lastImportSync.current)` thì đặt `lastImportSync.current = Date.now()` và gọi `window.fatup.importSync()` không chặn; nếu trả `ok` và `imported > 0` thì gọi `refresh()` lại (lần này `shouldSyncImport` sai nên không lặp). Lỗi bỏ qua, không hiện.
- [ ] **Step 4: Chạy test và typecheck**: `npm test -w @fatup/desktop -w @fatup/web && npm run typecheck`. Kỳ vọng: PASS.

---

### Task 6: Desktop tạo thumbnail bù

**Model:** Sonnet

**Files:**
- Create: `desktop/src/main/thumb-backfill.ts`
- Modify: `desktop/src/main/index.ts` (gọi trong handler `list`; tách phần thu nhỏ ảnh của `makeThumbnail` để dùng cho `Buffer`)
- Test: `desktop/test/thumb-backfill.test.ts`

**Interfaces:**
- Consumes: `ApiClient.thumbUpload`, `thumbComplete`, `downloadUrl` (Task 5); `Item` có `hasThumb` (Task 3, qua `FileItem`).
- Produces:
  ```ts
  export type ThumbBackfillDeps = {
    client(): Pick<ApiClient, 'downloadUrl' | 'thumbUpload' | 'thumbComplete'>;
    fetchBytes(url: string): Promise<Uint8Array>;
    thumbnail(bytes: Uint8Array): Buffer | null; // 400 px JPEG q80; null khi không giải mã được
    putThumb(url: string, bytes: Buffer): Promise<void>;
  };
  export function createThumbBackfill(deps: ThumbBackfillDeps): { run(items: Item[]): void };
  ```
  `run` chọn mục `kind==='image' && !hasThumb && !encrypted && !inVault && !deletedAt`, xử lý **từng mục một** ở nền, và nhớ id đã thử trong phiên (thành công hay thất bại) để không thử lại.

- [ ] **Step 1: Viết test thất bại** với deps giả: mục đủ điều kiện → gọi theo thứ tự `downloadUrl` → `fetchBytes` → `thumbnail` → `thumbUpload` → `putThumb` → `thumbComplete`; mục đã có thumbnail, mục không phải ảnh, mã hóa, trong két, trong thùng rác bị bỏ qua; `thumbnail` trả `null` (ví dụ HEIC) → không gọi `thumbUpload`; `run` gọi lần hai với cùng id không làm lại; một mục lỗi (ném ở `fetchBytes`) không chặn mục sau; hai `run` chồng nhau không xử lý một mục hai lần.
- [ ] **Step 2: Chạy test, xác nhận thất bại**: `npm test -w @fatup/desktop -- thumb-backfill`. Kỳ vọng: FAIL.
- [ ] **Step 3: Cài `createThumbBackfill`** theo chữ ký; trong `index.ts` nối deps thật (`fetchBytes` đã có, `thumbnail` dùng `nativeImage.createFromBuffer` với cùng logic `THUMB_EDGE`/`toJPEG(80)` của `makeThumbnail`, `putThumb` giống `putThumb` của `uploader.ts`) và gọi `thumbBackfill.run(items)` ở cuối handler `list` mà không `await`. Không thêm IPC: danh sách đã tự làm mới theo `POLL_MS`.
- [ ] **Step 4: Chạy test và typecheck**: `npm test -w @fatup/desktop && npm run typecheck`. Kỳ vọng: PASS.

---

### Task 7: E2E mock và kiểm tra giao diện

**Model:** Haiku

**Files:**
- Modify: `desktop/e2e/mock-server.mjs`, `desktop/e2e/areas/files.mjs`, `desktop/test/e2e-mock.test.ts` (nếu mock có kiểm dữ liệu giả)

- [ ] **Step 1:** Thêm vào mock `POST /import/sync`: có danh sách ảnh "chờ nhập" (một ảnh `Screenshot d30.png`, `device: 'd30'`, `hasThumb: false`, `thumbUrl` trỏ tới ảnh gốc giả); mỗi lần gọi chuyển ảnh chờ vào danh sách file và trả `{ imported: <n>, more: false }`; thêm `POST /files/:id/thumb` và `/thumb/complete` trả dữ liệu hợp lệ (xem cách các route khác của mock trả `FileItem`).
- [ ] **Step 2:** Thêm bước vào vùng `files`: mở app (`h.launchReady()`), làm mới, kiểm `Screenshot d30.png` hiện trong danh sách chính và cột "Từ" ghi `d30`.
- [ ] **Step 3:** Chạy `npm run e2e -- files` (cần màn hình; không chạy được thì nói rõ là chưa chạy, đừng báo đạt) và `npm test -w @fatup/desktop`. Kỳ vọng: PASS.

---

### Task 8: Tài liệu

**Model:** Haiku (agent `doc-keeper`)

**Files:** `docs/spec/api.md` (`POST /import/sync`, `POST /files/:id/thumb[/complete]`, trường `hasThumb`, `thumbUrl` của ảnh chưa có thumbnail), `docs/spec/lifecycle.md` (mục nhập ảnh, tương tác với cron `pending`), `docs/spec/desktop-ui.md` (làm mới gọi đồng bộ, thumbnail bù), `docs/spec/security.md` (dùng lại khóa R2 cho list/copy/delete), `docs/spec/data.md` (nêu rõ không có cột mới), `docs/spec/roadmap.md` (bỏ "chưa cài đặt" ở mục nợ kỹ thuật), `CHANGELOG.md` (mục "Nâng cấp": không migration, đặt `IMPORT_PREFIX`, deploy Worker, phát hành desktop, deploy PWA), `worker/CLAUDE.md` và `desktop/CLAUDE.md` (bản đồ: `object-store.ts`, `import.ts`, `thumb-backfill.ts`, `lib/import-sync.ts`), `docs/decisions/0017-*.md` + `docs/decisions/README.md` (ADR: nhập ảnh bằng id xác định từ nguồn, di chuyển thay vì giữ tại chỗ, mọi thao tác R2 qua S3 API), spec thiết kế: đổi trạng thái thành "đã triển khai".

- [ ] **Step 1:** Cập nhật các file trên theo diff đã xong; tài liệu bằng tiếng Việt.
- [ ] **Step 2:** `npm run docs:check`. Kỳ vọng: không còn cảnh báo cho các thư mục đã đổi.

---

## Tự kiểm

- **Phủ spec:** 4.1 → Task 3, 5; 4.2 → Task 2; 4.3 → Task 2; 4.4 → Task 2, 3; 4.5 → Task 4, 6; 4.6 → Task 3 (không migration, cron không đổi); mục 2 "tránh thất bại" → Review Focus 1-5 và test song song/ngắt giữa chừng ở Task 2.
- **Bổ sung so với spec (đã ghi vào spec mục 5):** `hasThumb` trong `FileItem`; `thumbUrl` của ảnh chưa có thumbnail là ảnh gốc; `ObjectStore.head`; kiểm etag trước khi xóa bản gốc; chặn prefix nguy hiểm.
- **Nhất quán kiểu:** `ObjectStore`, `importImages`, `ImportSyncResponse`, `ThumbUploadResponse`, `IMPORT_SYNC_MIN_GAP_MS`, `shouldSyncImport` dùng cùng tên ở mọi task.
