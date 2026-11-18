# Phiên két sắt 6 tiếng và popup PIN — plan

Người dùng chốt (2026-11-18): cất file vào két không được bắt nhập PIN mỗi lần và không được chuyển sang màn hình Két sắt. Chọn phương án "giữ két mở": sau khi nhập PIN, khóa chính được giữ **6 tiếng**; khi cần PIN thì hiện **popup nhỏ** ngay trên danh sách file.

Phạm vi: desktop và web (Android chưa hỗ trợ két mã hóa). Không đổi mật mã, schema D1 hay API server.

## Quyết định

1. **Thời hạn phiên cố định 6 giờ kể từ lần mở két thành công** (unlock, recover, `commitSetup`), không gia hạn khi dùng. Hết hạn thì két tự đóng như `vaultClose()`. Hằng số `VAULT_SESSION_MS = 6 * 60 * 60 * 1000` trong `shared/src/vault.ts`.
2. Phiên hết hạn được kiểm **cả bằng bộ hẹn giờ lẫn mỗi lần dùng khóa** (tab nền bị trình duyệt làm chậm timer): `VaultSession.isOpen()` và `#requireKey()` tự đóng nếu quá hạn.
3. **Hai quyền tách riêng trong cùng một phiên.** Khóa chính `MK` được giữ tối đa 6 giờ chỉ để **cất file vào két** (mã hóa, và chuyển file cũ chạy nền). **Xem két** (danh sách đã giải mã, thumbnail, mở/tải file, đổi tên, thùng rác của két) vẫn **luôn đòi PIN** mỗi lần vào màn hình Két sắt. Core có cờ `viewOpen` riêng: chỉ bật khi `vaultUnlock(pin)` được gọi với mục đích `view` (cổng PIN của màn Két sắt), tắt khi rời màn hình Két sắt (`vaultLeave()`), khi khóa app, `reset`, hoặc hết hạn. `listVault`, `serve`, `fileBytes`, `download`, `previewUrl`, đổi tên, `addLink`, `vaultMoveOut` đều đòi `viewOpen`; `vaultMoveIn` và `migrateLegacy` chỉ đòi `MK`.
4. API: `vaultUnlock(pin, purpose: 'view' | 'move')` (`move` giữ `viewOpen = false`, dùng cho popup); IPC/bridge `vaultClose` của renderer đổi tên thành `vaultLeave` (chỉ tắt `viewOpen`, xóa danh sách đã giải mã và thu hồi mọi URL, **giữ `MK`**). `vaultClose()` của core là đóng hẳn (khóa app, `reset`, hết hạn). `vaultStatus` của core trả thêm `open: boolean` (= đang giữ `MK`, tức cất file không cần PIN) và kiểu `VaultClientStatus = VaultStatus & { open: boolean }`.
5. **Cất vào két từ danh sách chính:** `open` thì chuyển luôn; chưa `open` thì hiện popup nhỏ `VaultPinDialog` (6 ô PIN, không hoạt ảnh phù thủy) gọi `vaultUnlock(pin, 'move')`; nhập đúng thì chuyển tiếp, **không** vào màn Két sắt và **không** đóng `MK` sau đó. Bỏ `moveInAndClose`. Popup có đếm lùi khi bị khóa, thông báo sai PIN như `gateMessage`, liên kết "Quên PIN" sang khôi phục, nút Hủy. Đúng PIN ở bất kỳ nơi nào cũng làm mới hạn 6 giờ.
6. **Thông báo "N failed" khi cất thất bại** đổi thành câu có lý do và cách xử lý: mục đã nằm trong Két sắt với biểu tượng đám mây mờ và sẽ được mã hóa lại; không còn chỉ báo số.
7. Mục chưa mã hóa (đám mây mờ) trong một phiên đang mở phải được thử lại: `listVault` của core gọi `startMigration` khi thấy mục `inVault && !encrypted` mà chưa có lượt chuyển nào chạy (kiểm tra tính idempotent của `startMigration` trước).

## Ruling (đã chốt khi nhận báo cáo T1)

- `vaultUnlock(pin)` không truyền `purpose` = `view`. `session.unlock(pin)` giữ nguyên chữ ký.
- `vaultSetup`/`vaultSetupCommit`/`vaultRecover` của core bật `viewOpen` (người dùng vừa nhập PIN hoặc recovery key trên màn Két sắt). Nếu thiết lập hoặc khôi phục được mở để cất file từ danh sách chính (`pendingMove`), renderer gọi `vaultLeave()` **trước** khi cất (cất chỉ cần `MK`; gọi sau thì đẩy người dùng ra nếu họ đã vào két trong lúc đó): `MK` giữ, nhưng không mở phần xem.
- `viewOpen` nằm trong core (`createVaultCore`), không nằm trong `VaultSession`: mover và test của session không bị ảnh hưởng.
- `vaultLeave()` còn **bỏ cả bản thiết lập đang chuẩn bị** (`prepareSetup` chưa `commitSetup`), vì `VaultSetup.tsx` dùng nó để hủy khi người dùng thoát giữa chừng. Bản thiết lập đó là nơi duy nhất `vaultLeave` được phép quên thứ gì khác ngoài phần xem.
- `vaultChangePin(oldPin, newPin)` **không** đòi quyền xem: PIN cũ là bằng chứng, không trả gì đã giải mã, và form đổi PIN nằm trong Cài đặt; hoạt động khi app đã mở khóa dù khóa/quyền xem ở trạng thái nào (đóng, chỉ cất file, đang xem).

## Task

| # | Việc | Model |
|---|---|---|
| T1 | `test-writer`: test thất bại cho phiên 6 giờ (timer giả + kiểm tra khi dùng), `vaultStatus.open`, rời Két sắt không đóng, `listVault` kích hoạt chuyển file cũ, test parity web; logic thuần mới trong `lib/vault.ts` | Sonnet |
| T2 | Cài đặt lõi: `VAULT_SESSION_MS`, hết hạn trong `VaultSession`, `viewOpen`/`vaultLeave`/`purpose` trong core, `open` trong `vaultStatus`, `listVault` kích hoạt migration, bridge web/desktop/preload nếu đổi kiểu | Sonnet |
| T3 | Cài đặt giao diện: `VaultPinDialog`, `Main.tsx` (bỏ `moveInAndClose`, `leaveVault` gọi `vaultLeave`, vào Két luôn qua cổng PIN), chuỗi i18n `en`+`vi`, CSS | Haiku |
| T4 | Mock e2e + vùng `vault` của e2e (popup, cất lần hai không hỏi, vào Két vẫn hỏi PIN) và `e2e-verifier` | Haiku |
| T5 | `reviewer` độc lập | Opus |
| T6 | `doc-keeper`: spec (security, desktop-ui, web, lifecycle), ADR 0016, CHANGELOG, `CLAUDE.md` | Haiku |

Kiểm tra mỗi task: `npm run typecheck && npm test`; sau T3/T4: `npm run e2e`.
