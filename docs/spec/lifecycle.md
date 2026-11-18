# Thùng rác, Két sắt và vòng đời file

> Một phần của [SPEC](../../SPEC.md). Đây là trạng thái **hiện tại**; đổi quyết định thì sửa file này trước, code sau.

## 5. Hai tính năng riêng tư: Thùng rác và Két sắt

### 5.1 Thùng rác (Trash)

- **Xóa = chuyển vào thùng rác**, không xóa thật. Không hỏi xác nhận; thông báo "Đã chuyển N file vào thùng rác" có nút **Hoàn tác** (8 giây).
- File trong thùng rác **không mở/tải được**; phải khôi phục trước. R2 object vẫn còn nguyên cho đến khi bị xóa vĩnh viễn.
- **Khôi phục** đưa file về danh sách chính. File ngoài thùng rác không có hạn nên không cần tính lại mốc nào (`retain_from` không còn được ghi).
- **Xóa vĩnh viễn** và **Dọn sạch thùng rác** đều có hộp xác nhận (không hoàn tác được).
- Cron xóa vĩnh viễn file có `deleted_at < now − 30 ngày`. Đây là cách duy nhất một file đã tải xong bị cron xóa.
- File đang được chia sẻ mà bị chuyển vào thùng rác thì **link chết ngay** và không sống lại khi khôi phục ([5.3](#53-chia-sẻ-link-và-két-sắtthùng-rác)).
- Màn hình thùng rác: biểu tượng thùng rác trên thanh trên cùng, header "← Thùng rác", cột "Thời gian xóa", chọn nhiều file để khôi phục hoặc xóa vĩnh viễn.

### 5.2 Két sắt (Secret Vault)

Một khu vực để **cất file ra khỏi danh sách chính**, chỉ xem được sau khi nhập lại PIN.

- **Cất vào:** menu `⋮`/chuột phải hoặc thanh chọn nhiều file có "Chuyển vào Két sắt". File biến mất khỏi danh sách chính. Không có "Hoàn tác" vì muốn lấy ra phải nhập PIN.
- **Mở két:** biểu tượng két sắt cạnh thùng rác. Mỗi lần mở đều hiện màn hình nhập PIN, **kể cả khi app đang mở khóa**. Thoát ra (nút ←, mở thùng rác, bấm logo, khóa app, đăng xuất) là đóng két; lần sau phải nhập PIN lại.
- **Cơ chế (desktop):** main process giữ cờ `vaultOpen` (chỉ trong bộ nhớ, không lưu đĩa). `vaultOpen(pin)` kiểm tra PIN bằng chính hàm `tryUnlock` của màn hình khóa, nên **dùng chung giới hạn sai 5 lần / khóa 30 giây**. `listVault` chỉ chạy khi cờ bật, nếu không trả `vault_locked`. Danh sách két không được tải vào renderer khi két đang đóng. Đưa file *ra* khỏi két cũng đòi két đang mở.
- **Trong két:** xem, tải, copy ảnh, tìm kiếm, tab Tất cả/Ảnh/File, chọn nhiều file như bình thường. Có "Đưa ra khỏi Két sắt". Tải file lên khi đang mở két thì file vào thẳng két (upload xong gọi `PUT /files/:id/vault`).
- **Xóa file trong két** chuyển file vào thùng rác thường và đưa nó ra khỏi két. "Hoàn tác" khôi phục rồi đưa nó về két.
- File trong két vẫn tính vào dung lượng; như mọi file ngoài thùng rác, chúng không hết hạn.
- File đang được chia sẻ mà được cất vào két thì **link chết ngay** và không sống lại khi lấy ra ([5.3](#53-chia-sẻ-link-và-két-sắtthùng-rác)). File trong két không chia sẻ được.
- **Giới hạn quan trọng:** két sắt **không mã hóa nội dung**. Đây là lớp che ở giao diện: file vẫn nằm bình thường trên R2, và bất kỳ ai có API token (ví dụ app Android, hoặc client khác) vẫn đọc được qua API. Chỉ người dùng app desktop/web mới bị chặn bằng PIN. Mã hóa phía client (E2EE) là hướng mở rộng, chưa làm.

### 5.3 Chia sẻ link và Két sắt/thùng rác

Một file chỉ chia sẻ được khi đang **ở ngoài**. Vào Két sắt hoặc thùng rác là mất link ngay, **chết hẳn**: khôi phục, đưa ra khỏi két, hay bấm **Hoàn tác** đều không làm link cũ sống lại; chia sẻ lại phải tạo link mới. Lý do: file từng bị cất đi là file người dùng muốn giấu, và người nhận cũ vẫn giữ địa chỉ cũ. Thông báo khi chuyển một file đang chia sẻ nói rõ "Link chia sẻ đã hết hiệu lực".

---

## 6. Vòng đời file, thùng rác và dọn dẹp

```text
 upload ──▶ pending ──complete──▶ ready ──DELETE──▶ ready + deleted_at ──cron (30 ngày)──▶ xóa hẳn
                │                  │  ▲                    │   ▲
                │ 24h              │  └──── restore ───────┘   │
                ▼                  │                           └── DELETE /permanent, DELETE /trash
          cron xóa                 └─ ngoài thùng rác: giữ mãi, không hết hạn
```

**Cron** (`0 3 * * *`), xóa ở cả R2 lẫn D1, gồm hai nhóm:

1. `ready`, ở thùng rác, và `deleted_at < now − 30 ngày`.
2. `pending` cũ hơn 24 giờ.

File `ready` ngoài thùng rác (kể cả trong két, có nhãn quan trọng, hoặc là link) **không bao giờ bị cron xóa**, dù cũ đến đâu.

Cron cũng xóa các dòng `shares` đã hết hạn; `purge` xóa tường minh `shares` của file bị xóa.

### 6.1 Ảnh nhập từ thư mục của bucket

Ảnh app khác bỏ vào `IMPORT_PREFIX` ([api.md 4.3](api.md#43-nhập-ảnh-từ-thư-mục-của-bucket)) đi vào vòng đời bình thường: dòng `pending` (giờ nhập) → `ready`. Lần nhập bị ngắt để lại dòng `pending` và bản gốc còn nguyên; lần quét sau làm tiếp. Dòng `pending` kẹt quá 24 giờ bị cron xóa như mọi upload dở (cùng `files/<id>` thừa). Cron xóa **dòng trước, có điều kiện `status = 'pending'`**, rồi mới xóa object của những dòng thật sự đã xóa (`purgePending`): một lần nhập hoàn tất dòng đó đúng lúc ấy thì dòng và object được giữ, và lần nhập nào thấy dòng đã bị cron xóa thì tự xóa bản copy của mình và để bản gốc; bản gốc vẫn còn nên lần quét sau nhập lại sạch, không mất ảnh. Sau khi nhập, ảnh là file thường: xóa vào thùng rác, xóa vĩnh viễn hoặc cron 30 ngày xóa `files/<id>` và `thumbs/<id>.jpg` như mọi file.
