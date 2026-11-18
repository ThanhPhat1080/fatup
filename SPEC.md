# FatUp — Spec

Chuyển ảnh và file giữa **điện thoại Android** và **máy tính** (macOS / Ubuntu / Windows) qua một server cá nhân trên Cloudflare. Dùng cá nhân, một người dùng.

> Spec ghi lại trạng thái **hiện tại** và các quyết định đã chốt. Thay đổi quyết định thì sửa spec trước, code sau. Spec được chia theo vùng code trong `docs/spec/`; file này giữ phần tổng quan, phạm vi và mục lục. Số mục (§3, §4.2…) giữ nguyên như bản một file, nên tham chiếu cũ kiểu "SPEC.md §4.2" vẫn tra được qua bảng dưới. Lý do của các quyết định: [`docs/decisions/`](docs/decisions/README.md).

## Mục lục

| Mục | File | Nội dung | Code liên quan |
|---|---|---|---|
| §1, §2 | file này | Tổng quan, kiến trúc, monorepo, phạm vi | — |
| §3 | [data.md](docs/spec/data.md) | Schema D1 qua các migration, R2 key | `worker/migrations/` |
| §4, §4.1, §4.2, §4.3 | [api.md](docs/spec/api.md) | Route của Worker, `FileItem`, liên kết, chia sẻ link công khai, két sắt mã hóa (`/vault`) | `worker/src/`, `shared/src/` |
| §5, §6 | [lifecycle.md](docs/spec/lifecycle.md) | Thùng rác, Két sắt, chia sẻ khi vào két/thùng rác, vòng đời file, cron | `worker/src/cleanup.ts`, `worker/src/app.ts` |
| §7 (7.1–7.7) | [security.md](docs/spec/security.md) | Token, PIN, mã hóa token, két sắt mã hóa (khóa, FUV1, bộ đếm, recovery key, giới hạn), presigned URL, bề mặt công khai, CORS | mọi package |
| §8 | [android.md](docs/spec/android.md) | App Android nhận chia sẻ | `android/` |
| §9 (9.1–9.10) | [desktop-ui.md](docs/spec/desktop-ui.md) | Màn hình, danh sách, đổi tên/thẻ, liên kết, chia sẻ, viewer, upload, dung lượng, theme, cập nhật, i18n, kiến trúc Electron, màn hình khóa | `desktop/src/` (cũng là UI của PWA) |
| §10 | [web.md](docs/spec/web.md) | PWA, upload từ web, giao diện điện thoại | `web/` |
| §11 | [build-release.md](docs/spec/build-release.md) | Build, phát hành, triển khai Cloudflare, kiểm thử | `.github/workflows/`, `package.json` |
| §12 + ghi chú v2–v5 | [history.md](docs/spec/history.md) | Spec đã đổi qua các phiên bản, khác với v1 | — |
| §13 | [roadmap.md](docs/spec/roadmap.md) | Lộ trình, việc chưa làm | — |

## 1. Tổng quan

```text
 Android (Kotlin)     Desktop (Electron)      Web (PWA)
 ┌──────────────┐     ┌────────────────┐     ┌────────────────┐
 │ Share target │     │ main process   │     │ trình duyệt    │
 │ + WorkManager│     │ (giữ token)    │     │ (token mã hóa) │
 └──────┬───────┘     └───────┬────────┘     └───────┬────────┘
        │ 1. xin URL / list / xóa / vault / usage    │
        ▼                     ▼                      ▼
              ┌────────────────────────────────────────┐
              │ Worker (Hono) + D1 (metadata)          │  ← phục vụ luôn file tĩnh của PWA
              └───────────────────┬────────────────────┘
                                  │ presigned URL (S3 SigV4)
        2. PUT / GET file + thumbnail, đi thẳng tới R2
                                  ▼
              ┌────────────────────────────────────────┐
              │ R2 bucket `fatup-files`                │
              └────────────────────────────────────────┘
```

- File **không đi qua Worker**: Worker chỉ cấp presigned URL (ký bằng `aws4fetch`) nên không dính giới hạn request body của Worker. **Ngoại lệ duy nhất: link chia sẻ công khai** (`/s/<token>`), nơi Worker truyền file từ R2 để kiểm tra D1 ở từng lượt và thu hồi được ngay ([mục 4.2](docs/spec/api.md#42-chia-sẻ-link-công-khai)).
- Cron mỗi ngày (03:00 UTC) dọn file ở thùng rác quá 30 ngày (kể cả thùng rác của két), upload dở dang, bản rõ sót lại khi lấy ra khỏi két bị ngắt, và object mã hóa thừa dưới `vault/` (file ngoài thùng rác không bao giờ hết hạn) (xem [mục 6](docs/spec/lifecycle.md#6-vòng-đời-file-thùng-rác-và-dọn-dẹp)).
- Két sắt mã hóa phía client: file trong két được mã hóa trên máy, server chỉ thấy bản mã ([mục 7.1](docs/spec/security.md#71-két-sắt-mã-hóa-phía-client-e2ee)).

### Monorepo

```text
fatup/
├── shared/      # TS types + hằng số dùng chung (Worker, desktop, web)
├── worker/      # Cloudflare Worker: Hono + D1 + R2; public/ là bản build của web
├── desktop/     # electron-vite + React + TS
├── web/         # PWA: dùng lại UI của desktop, chỉ thay lớp `window.fatup`
├── android/     # Kotlin, Gradle (project độc lập)
└── .github/workflows/
```

npm workspaces cho `shared`, `worker`, `desktop`, `web`. `android/` là project Gradle độc lập.

---

## 2. Phạm vi

| Có | Không (để sau) |
|---|---|
| Android → cloud → desktop/web, mọi loại file, ≤ 100 MB/file | Android xem/tải lại file đã gửi |
| Desktop và **bản web** tải file lên (chọn file, kéo-thả, chụp ảnh trên điện thoại) | Upload cả thư mục |
| Share nhiều file một lúc (Android) | Share text thuần (không có link) |
| **Liên kết**: share từ Android/PWA hoặc "Thêm liên kết", không hết hạn, phân loại theo tên miền, sửa tiêu đề/URL | Lưu bản sao nội dung trang, nhập bookmark từ trình duyệt |
| Thumbnail ảnh (Android và desktop tạo) | Video thumbnail |
| File ngoài thùng rác được giữ mãi, không tự hết hạn | Tự xóa file cũ theo hạn |
| **Thùng rác** 30 ngày, khôi phục, xóa vĩnh viễn | Thư mục, album |
| **Chia sẻ link công khai** từng ảnh/file (chỉ đọc, hạn 1/7/30 ngày hoặc không hạn, chết ngay khi vào Két sắt/thùng rác) | Link chung cho nhiều file, mật khẩu cho link, nút chia sẻ trên Android |
| **Két sắt mã hóa** (desktop, PWA): file trong két được mã hóa trên máy; mở bằng **PIN két 6 số** (server đếm số lần sai); **recovery key**; thùng rác riêng của két | Android mở két; "Tắt két trên thiết bị này"; che kích thước, thời gian, thiết bị, thẻ màu (xem [mục 7](docs/spec/security.md#7-bảo-mật)) |
| Chọn nhiều file, sắp xếp, xóa hàng loạt, **Tải tất cả** | Thư mục, album |
| **Đổi tên** file (giữ phần mở rộng), **thẻ màu** tối đa 3 màu/file, lọc theo màu | Thẻ tự đặt tên, thư mục |
| PIN 4 số khóa app, PIN 6 số riêng cho két; UI En/Vi; sáng/tối (theo OS hoặc tự chọn) | Nhiều người dùng |
| Bản web cài được như app (PWA) | Offline đầy đủ, đồng bộ nền |
| Thanh dung lượng R2, kiểm tra cập nhật app | Tray, notification desktop |
| Polling 60s + refresh khi focus + nút Refresh | Realtime (WebSocket) |
| Build không ký qua GitHub Actions | Code signing, store |
