# FatUp — hướng dẫn cho agent

Chuyển file, ảnh và liên kết giữa Android, máy tính (Electron) và bản web PWA, qua một Cloudflare Worker (Hono + D1 + R2). Một người dùng. Tài liệu viết bằng tiếng Việt; code, comment và commit message viết bằng tiếng Anh.

File này là **bộ chỉ đường**: nó cho biết cần đọc gì, không mô tả code làm gì. Chỉ đọc những dòng khớp với việc đang làm.

## Đọc gì trước, theo việc

| Bạn sắp… | Đọc |
|---|---|
| Đổi hành vi / thêm tính năng | mục lục trong `SPEC.md` → file spec của vùng đó trong `docs/spec/` → design spec trong `docs/superpowers/specs/` nếu tính năng có → `docs/decisions/` (ADR liên quan) |
| Sửa API, D1, R2, cron, link chia sẻ | `worker/CLAUDE.md`, `docs/spec/data.md`, `api.md`, `lifecycle.md`, `security.md` |
| Sửa giao diện (desktop **hoặc** web — cùng một bộ React) | `desktop/CLAUDE.md`, `docs/spec/desktop-ui.md`; phần chỉ có ở web: `web/CLAUDE.md`, `docs/spec/web.md` |
| Sửa type/hằng số dùng chung nhiều package | `shared/CLAUDE.md` |
| Sửa Android | `android/CLAUDE.md`, `docs/spec/android.md` |
| Thực hiện một plan | plan trong `docs/superpowers/plans/`, và sổ ghi `.superpowers/sdd/<plan>/progress.md` nếu có |
| Phát hành / deploy | `docs/development.md` (chạy local, phát hành), `docs/spec/build-release.md`, `README.md` (cài server, nâng cấp) và `CHANGELOG.md` (định dạng + mục "Nâng cấp") |
| Hỏi "vì sao lại làm thế này?" | `docs/decisions/README.md` (danh sách ADR) trước khi đoán |

Câu hỏi về cấu trúc ("cái gì gọi X", "cái gì phụ thuộc Y"): nếu có `graphify-out/graph.json` thì chạy `graphify query "<câu hỏi>"` trước; graph có thể đã cũ, nên xác nhận lại bằng `grep` trước khi sửa.

## Thứ tự tin cậy

Khi tài liệu mâu thuẫn: **spec (`SPEC.md` + `docs/spec/`) > design spec > ADR > plan > comment trong code > code**. Mâu thuẫn là một lỗi: báo lại, đừng lặng lẽ chọn một bên. Đổi quyết định thì sửa spec (hoặc ADR) **trước**, code sau. Spec chỉ mô tả trạng thái hiện tại; lịch sử ở `docs/spec/history.md`, kế hoạch ở `docs/spec/roadmap.md`.

## Lệnh (ở thư mục gốc)

```bash
npm test                    # mọi workspace (worker, desktop, web)
npm run typecheck           # mọi workspace
npm test -w @fatup/worker   # một workspace (hoặc @fatup/desktop, @fatup/web)
npm run e2e                 # smoke test Playwright của desktop (build trước; cần màn hình)
npm run dev:worker          # migration local + wrangler dev
npm run dev:web             # Vite; FATUP_SERVER=<worker đã deploy> để chuyển API sang đó
npm run docs:check          # cảnh báo khi code đổi mà tài liệu không đổi (so với main)
```

Android là project Gradle riêng: `cd android && ./gradlew testDebugUnitTest`. Máy này có thể không có Android SDK; khi đó chỉ CI chạy được — nói rõ như vậy, đừng báo là đã pass.

## Quy trình (tính năng → merge)

1. **Yêu cầu**: hỏi kỹ người dùng (`grilling` / `superpowers:brainstorming`). Kết quả: design spec ở `docs/superpowers/specs/YYYY-MM-DD-<chủ-đề>-design.md`. Quyết định của người dùng ghi vào mục quyết định đã chốt; quyết định Claude tự đưa ra ghi vào "Quyết định do Claude tự đưa ra (cần xem lại)".
2. **Plan**: `superpowers:writing-plans` → `docs/superpowers/plans/YYYY-MM-DD-<chủ-đề>.md`. Plan **chính là** danh sách task; không tạo thêm file `task.md`.
3. **Test trước**: agent `test-writer` viết test thất bại cho từng task; sau đó `touch .claude/tests-frozen` (hook chặn sửa test cho tới khi `rm .claude/tests-frozen`).
4. **Cài đặt**: `superpowers:subagent-driven-development`. Mọi "Ruling" trong sổ ghi làm đổi hành vi phải được ghi thành ADR — sổ ghi (`.superpowers/`) bị gitignore nên sẽ mất.
5. **Kiểm tra**: `npm run typecheck && npm test`; đổi giao diện → agent `e2e-verifier`.
6. **Review**: agent `reviewer` (độc lập; không phải agent đã viết code).
7. **Tài liệu**: agent `doc-keeper` cập nhật spec (`docs/spec/`), `CHANGELOG.md`, ADR và các file `CLAUDE.md` trên cùng nhánh.

## Agent (`.claude/agents/`)

| Agent | Dùng để | Được sửa |
|---|---|---|
| `test-writer` | viết test unit/integration thất bại từ spec/task của plan | chỉ file test |
| `e2e-verifier` | chạy app thật (Playwright) và báo đạt/không đạt kèm bằng chứng | không sửa gì trong `src/` |
| `reviewer` | review độc lập một diff so với spec + ADR | không sửa gì (chỉ báo cáo) |
| `doc-keeper` | đồng bộ tài liệu với diff đã xong, ghi quyết định thành ADR | chỉ tài liệu |

Phân tích yêu cầu **không** là agent: nó cần hỏi qua lại với người dùng, điều subagent không làm được.

**Model cho agent (bắt buộc, người dùng chốt):**

| Việc | Model |
|---|---|
| Phân tích yêu cầu, design spec, plan, quyết định "Ruling", agent `reviewer` | **Opus** |
| Task nặng hoặc đụng logic dùng chung: `shared/`, lõi mã hóa/bảo mật, schema D1, hợp đồng API/IPC mà nhiều package phụ thuộc | **Sonnet** |
| Task nhẹ hơn: giao diện, CSS, chuỗi i18n, mock/e2e, tài liệu (`doc-keeper`), `e2e-verifier` | **Haiku** |

`test-writer` và agent cài đặt dùng model của task (plan ghi `Model:` ở mỗi task; khi gọi Agent thì truyền `model` tương ứng). Không chắc task thuộc loại nào thì chọn model cao hơn.

## Quy tắc dễ vi phạm

- File không đi qua Worker (presigned URL của R2), **trừ** link chia sẻ công khai `/s/<token>`. Xem ADR 0002.
- Đổi schema D1 = thêm một file đánh số mới trong `worker/migrations/`, không bao giờ sửa file cũ. Thứ tự nâng cấp luôn là **migrate rồi mới deploy**; ghi rõ trong `CHANGELOG.md` → "Nâng cấp".
- PIN app 4 số chỉ khóa giao diện, không bao giờ gửi lên server. Renderer của desktop không bao giờ thấy token API.
- Két sắt mã hóa (ADR 0013, 0015): PIN két 6 số chỉ đi lên dưới dạng `authKey` dẫn xuất; `MK`, `DEK`, `S`, PIN và bản rõ tên/URL của mục két không bao giờ lên server, không ra renderer, không ghi xuống đĩa hay bộ nhớ đệm. Đổi bộ đếm sai, hoặc cách đặt tên object của két (`attempt`, `enc_object`), thì đọc ADR trước.
- Chuỗi hiển thị cho người dùng phải có cả `en` và `vi` trong `desktop/src/renderer/src/lib/i18n.ts`.
- Chỉ commit hoặc push khi người dùng yêu cầu. Tạo nhánh từ `main` trước.

## Giữ file này đúng

Thấy một dòng ở đây trỏ tới thứ đã đổi chỗ hoặc sai, sửa file này trong cùng thay đổi. Giữ dưới ~100 dòng: chi tiết để ở `CLAUDE.md` của từng package hoặc trong `docs/`, và dẫn link tới đó.
