# Nhập ảnh từ thư mục của app khác trong bucket: thiết kế

Trạng thái: **đã duyệt và đã triển khai** (nhánh `worktree-d30-import`, tách từ `main`; chưa phát hành; xem [ADR 0018](../../decisions/0018-nhap-anh-tu-thu-muc-bucket.md)). Nhánh này tách từ `main` nên **chưa có điều kiện `encrypted`** của Két sắt mã hóa; xem mục "Nợ kỹ thuật" ở `docs/spec/roadmap.md`. Viết ngày 2026-11-18 sau một buổi hỏi đáp; người dùng đã chốt các câu ở mục 3. Các quyết định kỹ thuật ở mục 5 do Claude tự đưa ra và cần xem lại. Khi làm xong phải cập nhật `docs/spec/api.md`, `lifecycle.md`, `desktop-ui.md`, `security.md`, `roadmap.md`, `CHANGELOG.md` và viết ADR mới.

## 1. Mục đích

Người dùng có một **app chụp ảnh màn hình khác** (không sửa được) ghi ảnh thẳng vào bucket R2 `fatup-files`, thư mục `d30/`. Fatup chỉ hiện những gì có dòng trong D1, nên các ảnh đó không bao giờ xuất hiện. Người dùng muốn **thấy ảnh đó ở Fatup ngay**.

## 2. Mục tiêu, không phải mục tiêu, điều phải tránh

**Mục tiêu**

- Ảnh trong `d30/` hiện trong danh sách chính của Fatup (desktop và web) khi mở hoặc làm mới app.
- Mỗi ảnh nhập vào là một file Fatup bình thường: xem, tải, chia sẻ, thẻ màu, cất vào két, xóa. **Xóa vĩnh viễn trong Fatup là xóa hẳn khỏi bucket** (ảnh đã được chuyển sang `files/<id>`, không còn bản ở `d30/`).
- Ảnh cũ đã có sẵn trong `d30/` được nhập dần.
- Ảnh nhập vào có thumbnail: desktop tạo bù khi thấy ảnh chưa có; client khác hiện ảnh gốc.

**Không làm**

- Không nhập file không phải ảnh (PDF, video…): bỏ qua, để nguyên trong `d30/`.
- Không đồng bộ hai chiều: xóa ở Fatup không làm gì ở `d30/` (bản gốc đã chuyển đi), và Fatup không ghi ngược vào `d30/`.
- Không theo dõi nền (không cron mỗi phút, không R2 Event Notifications): chỉ quét khi client yêu cầu.
- Không đụng Android (Android không có danh sách).
- Không nhập vào Két sắt: ảnh nhập vào luôn là file thường, bản rõ.

**Điều phải tránh (thất bại dù code chạy)**

- **Một ảnh ở bucket mà thành hai dòng ở Fatup** (người dùng nêu rõ).
- **Mất ảnh**: bản gốc ở `d30/` chỉ bị xóa sau khi bản ở `files/<id>` đã đủ và dòng D1 đã `ready`.
- Quét làm chậm hoặc làm hỏng việc mở danh sách (lỗi quét không được chặn danh sách).
- Tính năng tự bật trên bản cài của người khác và quét bucket của họ.

## 3. Các quyết định đã chốt với người dùng

| # | Câu hỏi | Chốt |
|---|---|---|
| Q1 | Xóa vĩnh viễn còn sót file trên bucket? | Bản đã deploy đang chạy đúng; **không sửa `purge`**. Nếu sai thì xem lại sau. (Bản `wrangler dev` có R2 giả lập riêng nên xóa không tới bucket thật; không phải lỗi, đừng dùng nó để kiểm xóa.) |
| Q2 | Sửa được app chụp ảnh không? | **Không.** Nên Fatup phải quét `d30/`. |
| Q3 | Ảnh hiện sau bao lâu? | **Quét lười**: mỗi lần mở/làm mới danh sách. Không thêm hạ tầng. |
| Q4 | Trùng lặp | Yêu cầu cứng: một ảnh trong bucket không bao giờ thành hai dòng ở Fatup. Người dùng cho phép **ghi hai máy làm mới cùng lúc vào nợ kỹ thuật** (đã ghi, xem mục 7). |
| Q5 | Số phận bản gốc | **Di chuyển**: copy sang `files/<id>` rồi xóa bản ở `d30/`. |
| Q6 | Thumbnail | **Desktop tạo bù** khi thấy ảnh chưa có; client khác **hiện ảnh gốc**. |
| Q7 | Hiển thị | Lẫn trong danh sách chính, nhãn thiết bị `d30`, không thêm tab. |
| Q8 | Tên thư mục | **Biến `IMPORT_PREFIX`** trong `wrangler.toml` (mặc định `d30/`); để trống thì tính năng tắt. |
| Q9 | Phạm vi | **Chỉ hình ảnh.** |

## 4. Thiết kế

### 4.1 Cấu hình và đường vào

- `wrangler.toml` `[vars]`: `IMPORT_PREFIX = "d30/"`. `env.ts` thêm `IMPORT_PREFIX?: string`. Rỗng hoặc không có: `POST /import/sync` trả `{ imported: 0, more: false }` ngay, không gọi R2.
- `POST /import/sync` (sau middleware token như mọi route trừ `/health`, `/s/*`). Mỗi lần chạy nhập tối đa **10 ảnh**; trả `{ imported: <số ảnh mới sẵn sàng>, more: <còn ảnh chờ> }`.
- Client (desktop và web, cùng bộ React) gọi nó khi mở danh sách chính và khi làm mới, **không quá một lần mỗi 30 giây** (giới hạn ở client). Nếu `imported > 0` thì tải lại danh sách; nếu `more` thì gọi tiếp ở lần làm mới sau. Lỗi quét **không hiện cho người dùng** và không chặn danh sách; lần làm mới sau thử lại.

### 4.2 Chọn ảnh để nhập

Liệt kê object dưới `IMPORT_PREFIX` (kể cả thư mục con). Nhập object nếu: key không kết thúc bằng `/`, kích thước > 0 và ≤ `MAX_FILE_SIZE`, và đuôi tên thuộc `png jpg jpeg gif webp bmp heic heif avif` (không phân biệt hoa thường). Còn lại **bỏ qua và để nguyên**, không bao giờ xóa. Tên hiển thị là đoạn cuối của key. `mime` suy ra từ đuôi; `kind = 'image'`.

### 4.3 Id xác định, nên không tạo dòng trùng

Id của dòng là một ULID **tính ra từ chính object nguồn**: phần thời gian là `uploaded` (ms) của object, phần ngẫu nhiên là 80 bit đầu của `SHA-256(key + "\0" + etag)`. Cùng một object nguồn luôn cho cùng một id, nên `INSERT OR IGNORE` trên khóa chính `id` là cái chặn trùng; không cần cột hay migration mới. Ghi đè cùng tên bằng ảnh khác thì etag khác, id khác: đó là ảnh mới, không phải trùng.

### 4.4 Thứ tự bất biến cho mỗi ảnh

1. Tính id. Nếu đã có dòng `ready`: bản gốc là phần sót của lần nhập trước, chỉ **xóa bản gốc** rồi xong.
2. `INSERT OR IGNORE` dòng `pending` (`device = 'd30'`, `created_at = now`, `has_thumb = 0`). Nếu đã có dòng `pending` thì làm tiếp từ bước 3 (lần trước bị ngắt).
3. **Copy trong R2** `d30/...` sang `files/<id>` (S3 `CopyObject`, dữ liệu không đi qua Worker, đúng ADR 0002). Nguồn đã biến mất (máy khác nhập xong trước) thì bỏ qua.
4. Kiểm `files/<id>` có kích thước đúng.
5. `UPDATE ... SET status = 'ready', created_at = <uploaded của object>` `WHERE id = ? AND status = 'pending'`. Dùng giờ upload của object để ảnh nằm đúng chỗ theo thời gian.
6. **Xóa bản gốc** (chỉ sau bước 5).

Bị ngắt ở bất kỳ bước nào: bản gốc còn nguyên, lần quét sau làm tiếp, không tạo dòng mới, không mất ảnh. Dòng `pending` kẹt quá 24 giờ bị cron hiện có xóa (cùng `files/<id>` thừa); bản gốc vẫn còn nên lần quét sau nhập lại sạch sẽ.

### 4.5 Thumbnail (desktop)

- Server: `POST /files/:id/thumb` trả `thumbUploadUrl` (presigned PUT tới `thumbs/<id>.jpg`) cho dòng `ready`, ảnh, chưa mã hóa, không ở két; `POST /files/:id/thumb/complete` kiểm object có thật rồi đặt `has_thumb = 1`. Mã hóa hay trong két thì trả lỗi.
- Desktop (main process): khi danh sách có ảnh `hasThumb = false`, tải ảnh gốc qua presigned GET, tạo JPEG 400 px q80 bằng `nativeImage` (như `uploader.ts`), PUT, gọi `thumb/complete`, rồi làm mới mục đó. Chạy nền, một ảnh một lúc. Ảnh không giải mã được (ví dụ HEIC) bị bỏ qua và **không thử lại trong cùng phiên**.
- Web/PWA và các client khác không tạo thumbnail, hiện ảnh gốc cho tới khi desktop làm xong.

### 4.6 Bản sao và dọn dẹp

Không có migration. Cron hiện có không đổi. Chỉ có một cách xóa: người dùng xóa trong Fatup (thùng rác, rồi xóa vĩnh viễn hoặc 30 ngày); `purge` xóa `files/<id>` và `thumbs/<id>.jpg` như mọi file.

## 5. Quyết định do Claude tự đưa ra (cần xem lại)

1. **Id xác định thay cho cột `import_key` + `UNIQUE`.** Không cần migration, và chặn luôn việc hai máy cùng nhập một ảnh. Đổi lại id mang thông tin của nguồn; không tiết lộ gì vì id vốn đã là ULID.
2. **Mọi thao tác R2 của việc nhập (liệt kê, copy, xóa bản gốc) đi qua S3 API** bằng khóa đang ký presigned URL, **không dùng binding `BUCKET`**. Lý do: tránh đúng chuyện đã gặp ở Q1: `wrangler dev` có R2 giả lập riêng nên binding trỏ sang bucket khác với bucket mà upload ghi vào. Hệ quả: phải đọc XML của `ListObjectsV2`; test dùng bộ copy/list giả được tiêm vào `createApp`, không gọi S3 thật. Phương án khác (binding cho list/delete, S3 chỉ để copy) rẻ hơn ở production nhưng không chạy được ở local.
3. **Quét ở client, giới hạn 30 giây, 10 ảnh mỗi lần** (đã đổi từ 20 sau review: 1 liệt kê + 10 × 4 lời gọi S3 = 41, dưới giới hạn 50 subrequest của Worker gói miễn phí). Con số do Claude chọn, đổi được. Giới hạn ở client để khỏi cần bảng trạng thái ở server.
4. **Bao gồm thư mục con** của `d30/` và nhập cả ảnh có sẵn (Q9 chỉ nói "hình ảnh thôi").
5. **`created_at` đổi từ giờ nhập sang giờ upload của object** khi `ready`, để danh sách xếp đúng và cron "dòng `pending` quá 24 giờ" không xóa nhầm dòng đang nhập.
6. **Danh sách đuôi ảnh** ở 4.2 (bỏ qua file không rõ đuôi).
7. **"Hiện ảnh gốc" làm ở server:** với ảnh thường (không mã hóa) chưa có thumbnail, `thumbUrl` của `FileItem` là presigned GET của `files/<id>`; `FileItem` thêm `hasThumb: boolean` để desktop biết mục nào cần thumbnail bù. Hệ quả: mọi ảnh thường chưa có thumbnail (không riêng ảnh nhập) đều được hiện bằng ảnh gốc và được desktop làm thumbnail bù. Ảnh gốc không giải mã được trong `<img>` (HEIC) vẫn rơi về biểu tượng file.
8. **Trước khi xóa bản gốc, đọc lại etag** (`HEAD`) và chỉ xóa nếu còn trùng: app kia ghi đè cùng tên giữa lúc copy và lúc xóa thì bản mới được giữ lại và nhập ở lần sau.
9. **Prefix bị từ chối:** rỗng, `/`, `files/`, `thumbs/`, `vault/` (tránh nhập chính object của Fatup); thiếu `/` cuối thì thêm vào để `d30` không khớp `d300/`.

## 6. Việc để người xây dựng quyết định / kiểm tra

- Ảnh `hasThumb = false` hiện thế nào ở `Files.tsx` hiện nay (có thể đang là biểu tượng): nếu vậy thì "hiện ảnh gốc" cần code thêm ở danh sách.
- Chỗ gắn lời gọi `POST /import/sync` ở `Main.tsx` và bản web (`browser-api.ts`); thêm vào `FatupApi` thì sửa cả `preload`, `main/index.ts` và `browser-api.ts`.
- Cách kiểm thử: hai request nhập song song cùng một object; ngắt sau bước 3 và sau bước 5 rồi chạy lại; ghi đè cùng tên; `pending` kẹt gặp cron; `IMPORT_PREFIX` trống; file không phải ảnh, 0 byte, quá lớn.
- Mô hình cho từng task (theo `CLAUDE.md`): API/Worker dùng chung nhiều package là **Sonnet**; giao diện và chuỗi i18n là **Haiku**; không chắc thì chọn cao hơn.

## 7. Nợ kỹ thuật phát sinh

Đã ghi vào `docs/spec/roadmap.md` ("Nhập ảnh từ `d30/`"): hai máy làm mới cùng lúc, và ca nhập lại ảnh đã xóa vĩnh viễn.
