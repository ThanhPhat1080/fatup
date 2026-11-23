# Khóa đơn giản (tùy chọn "Dùng khóa LOTR")

Trạng thái: chờ duyệt. Cỡ: nhỏ.

## Vì sao

Màn khóa app và cổng Két sắt còn giật, lag trên điện thoại, kể cả khi đã dùng bản cửa rút gọn `LockGate`. Người dùng chấp nhận hy sinh hoạt ảnh để đổi lấy hiệu năng: chỉ cần ánh sáng lên nhấp nháy chậm, đơn giản.

## Quyết định đã chốt (của người dùng)

- Thêm checkbox **"Dùng khóa LOTR"** trong Cài đặt.
- **Tick**: như hiện tại (desktop: cảnh Moria đầy đủ; điện thoại: `LockGate`; cổng Két sắt: ông phù thủy).
- **Bỏ tick**: màn khóa app là một cánh cửa đơn giản, ánh sáng nhấp nháy chậm; cổng Két sắt dùng lại đúng cánh cửa đó, thêm chữ **VAULT**.
- **Mặc định: tắt**, cho mọi thiết bị, kể cả người dùng cũ khi cập nhật.
- Làm luôn cho điện thoại (PWA). Người dùng tự test trên điện thoại sau.
- Cách vẽ: dùng lại hình `MoriaDoor` nhưng bỏ phần nặng (cách B bên dưới).

## Mục tiêu / không mục tiêu

- Mục tiêu: màn khóa nhẹ nhất có thể mà vẫn nhận ra là cửa Moria; hết lag trên điện thoại.
- Không mục tiêu: đổi cảnh khi tick (giữ nguyên code hiện có); đổi cách PIN hoạt động (PIN app 4 số, PIN két 6 số, bộ đếm sai, khóa tạm: giữ nguyên).
- Phản mục tiêu: một bản "đơn giản" mà vẫn dùng bộ lọc `feGaussianBlur`, `halo`, đá, vệt sáng hắt ra nền hoặc hoạt họa chạy liên tục trên nhiều lớp. Như vậy là chưa đạt.

## Các cách đã cân nhắc

- A. Vẽ mới bằng CSS thuần: nhẹ nhất nhưng mất hình cửa Moria.
- **B. Dùng lại `MoriaDoor`, bỏ phần nặng (đã chọn).**
- C. Chụp sẵn thành một ảnh rồi phủ lớp sáng: chắc chắn nhẹ nhất nhưng thêm asset và có thể mờ. **Phương án dự phòng** nếu test trên điện thoại vẫn lag.

## Thiết kế

**Tùy chọn.** `Prefs.lotrLock: boolean` (`shared-ipc.ts`), mặc định `false` ở `main/config.ts` và `DEFAULT_PREFS` của `web/src/browser-api.ts`. Thiếu khóa trong config cũ thì coi là `false`. Checkbox ở `Settings.tsx`; chuỗi `en` và `vi` trong `lib/i18n.ts`.

**Màn khóa app (`Lock.tsx`).** `lotrLock` bật: như hiện tại (`phone ? LockGate : LockMoria`). Tắt: component mới `LockSimple` (cửa đơn giản) cho mọi kích thước màn hình.

**Cánh cửa đơn giản.**
- Vẽ `MoriaDoor` một lần, đứng yên, không có `DoorDefs` filter phát sáng, đá, vệt sáng hắt, `halo`.
- Đúng **một** lớp sáng (`opacity` đổi chậm, khoảng 4 giây một nhịp, `will-change: opacity`), không lớp nào khác chạy hoạt họa.
- Sai PIN: ô PIN lắc (`.pin--shake`), không có nháy giật của đèn.
- Đúng PIN: cửa mờ dần ngắn (khoảng 0,3 giây) rồi vào app, không có cánh cửa xoay hay lóe sáng. `prefers-reduced-motion`: vào ngay, và lớp sáng đứng yên.
- Ô PIN nằm trên thân cửa như `LockGate`; dòng báo lỗi và nút "Quên PIN" ở dưới.

**Cổng Két sắt (`VaultGate.tsx`).** `lotrLock` bật: như hiện tại. Tắt: cùng cánh cửa đơn giản, thêm chữ **VAULT** (cố định, không dịch) ở trên đỉnh cửa, ô PIN 6 số, nút ← Quay lại, dòng `hint` nếu có. Không có ông phù thủy, quả bom, `LockBackdrop`. PIN đúng thì vào ngay như `stillGate()`; Quay lại thoát ngay, không chờ 3,4 giây.

**Kiến trúc.** Cánh cửa đơn giản là một component dùng chung cho cả hai nơi (props: nhãn tùy chọn "VAULT", `panicKey`, `children`, `below`); logic quyết định hiển thị (`lotrLock` → cảnh nào) đặt ở hàm thuần trong `lib/` để test được.

## Quyết định do Claude tự đưa ra (cần xem lại)

- Chữ "VAULT" cố định bằng tiếng Anh, không dịch (người dùng viết đúng chữ "Vault").
- Nhịp sáng khoảng 4 giây, thời gian mờ dần khi mở cửa khoảng 0,3 giây.
- Sai PIN chỉ lắc ô PIN (bỏ nháy giật của đèn) để giữ hoạt ảnh ở mức tối thiểu.
- Cánh cửa đơn giản dùng cho mọi kích thước màn hình khi bỏ tick, không chỉ điện thoại.
- Nhãn checkbox: `en` "Use LOTR lock", `vi` "Dùng khóa LOTR"; kèm một dòng mô tả ngắn nói rằng bỏ tick thì nhẹ hơn.
- Cần ADR (quyết định đổi hành vi mặc định: khóa mặc định là bản đơn giản) và cập nhật `docs/spec/desktop-ui.md`, `CHANGELOG.md`, `desktop/CLAUDE.md` (do `doc-keeper`).

## Việc để người cài đặt

- Chi tiết CSS của lớp sáng và cách bỏ filter khỏi `MoriaDoor`/`DoorDefs` mà không đổi cảnh đầy đủ.
- Cách `Lock`/`VaultGate` đọc `prefs` (chúng hiện chưa chắc nhận `prefs` qua props).
- Kiểm tra: unit test hàm thuần; e2e các vùng `setup`, `settings`, `vault`. Hiệu năng thật trên điện thoại do người dùng test.
