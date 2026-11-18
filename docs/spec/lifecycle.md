# Thùng rác, Két sắt và vòng đời file

> Một phần của [SPEC](../../SPEC.md). Đây là trạng thái **hiện tại**; đổi quyết định thì sửa file này trước, code sau.

## 5. Hai tính năng riêng tư: Thùng rác và Két sắt

### 5.1 Thùng rác (Trash)

- **Xóa = chuyển vào thùng rác**, không xóa thật. Không hỏi xác nhận; thông báo "Đã chuyển N file vào thùng rác" có nút **Hoàn tác** (8 giây).
- File trong thùng rác **không mở/tải được**; phải khôi phục trước. R2 object vẫn còn nguyên cho đến khi bị xóa vĩnh viễn.
- **Khôi phục** đưa file về danh sách chính. File ngoài thùng rác không có hạn nên không cần tính lại mốc nào (`retain_from` không còn được ghi).
- **Xóa vĩnh viễn** và **Dọn sạch thùng rác** đều có hộp xác nhận (không hoàn tác được).
- **Thùng rác thường không hiện mục của két sắt.** Mục đã vào két rồi bị xóa nằm trong [thùng rác của két](#52-két-sắt-secret-vault). **Dọn sạch** ở đây cũng chỉ xóa mục ngoài két, không đụng thùng rác của két.
- Cron xóa vĩnh viễn file có `deleted_at < now − 30 ngày`. Đây là cách duy nhất một file đã tải xong bị cron xóa.
- File đang được chia sẻ mà bị chuyển vào thùng rác thì **link chết ngay** và không sống lại khi khôi phục ([5.3](#53-chia-sẻ-link-và-két-sắtthùng-rác)).
- Màn hình thùng rác: biểu tượng thùng rác trên thanh trên cùng, header "← Thùng rác", cột "Thời gian xóa", chọn nhiều file để khôi phục hoặc xóa vĩnh viễn.

### 5.2 Két sắt (Secret Vault)

Một khu vực để **cất file ra khỏi danh sách chính**. Mọi file trong két được **mã hóa trên máy** trước khi rời máy: server và R2 chỉ giữ bản mã, nên người có API token không đọc được nội dung, tên, loại hay URL của file trong két. Cơ chế và các khóa: [mục 7.1](security.md#71-két-sắt-mã-hóa-phía-client-e2ee); lý do: [ADR 0013](../decisions/0013-ket-sat-ma-hoa-phia-client.md).

- **PIN két 6 số, khác PIN app 4 số.** PIN két không được quá dễ (sáu chữ số giống nhau, dãy tăng hoặc giảm liên tiếp) và không được trùng 4 số đầu hoặc 4 số cuối của PIN app. PIN app không mở được két.
- **Thiết lập (lần đầu):** bấm két khi chưa có → trình thiết lập: nhập PIN két 2 lần → hiện **recovery key** (có nút sao chép, chỉ hiện một lần) → gõ lại 2 nhóm ngẫu nhiên của recovery key để xác nhận đã cất → két được tạo, mở, và các file đã có trong két bắt đầu được mã hóa. Thoát trước khi xác nhận thì **không có gì được gửi lên server**.
- **Xem két:** mỗi lần vào màn Két sắt đều hỏi PIN két, **kể cả khi đang giữ khóa và app đang mở khóa**. PIN sai thì màn hình hiện số lần còn lại; sai nhiều thì phải đợi (chi tiết ở [7.3](security.md#73-bộ-đếm-sai-phía-server)). Lần sai thứ 10 làm server xóa bí mật của két: từ đó chỉ **recovery key** mở được. Nhập đúng thì bộ đếm về 0, két mở để xem, và khóa được giữ 6 giờ kể từ lần nhập đúng này.
- **Giữ khóa 6 giờ:** sau khi nhập đúng PIN két (kể cả ở popup cất file), khóa được giữ **tối đa 6 giờ** kể từ lần nhập đúng gần nhất, không gia hạn khi dùng. Trong thời gian đó cất file vào két không hỏi PIN. Hết 6 giờ thì két tự đóng như khi khóa app. Chi tiết: [ADR 0016](../decisions/0016-phien-ket-sat-6-gio.md).
- **Thoát màn Két sắt:** nút ← hoặc bấm logo bỏ quyền xem, xóa danh sách đã giải mã và thu hồi mọi ảnh/file đã mở, nhưng **giữ khóa** đến hết 6 giờ, để cất file tiếp không cần PIN. Khóa app, đăng xuất, đặt lại, hoặc hết 6 giờ mới đóng hẳn két và xóa khóa khỏi bộ nhớ. **Mở thùng rác của két không đóng két.** Ngoại lệ duy nhất: bản giả của một mục đang được lấy ra (xem mục "Lấy ra" dưới đây) giữ tên đã giải mã trong danh sách chính cho tới khi lượt lấy ra kết thúc.
- **Quên PIN két:** màn khôi phục nhận recovery key rồi PIN mới. Không file nào được mã hóa lại. **Đổi PIN** khi app đang mở khóa: Cài đặt → Đổi PIN két, cần PIN cũ hoặc recovery key; không cần mở két.
- **Cất vào két:** menu `⋮`/chuột phải, hoặc chọn nhiều file rồi "Chuyển vào Két sắt", ở danh sách chính. Đang giữ khóa thì cất ngay. Chưa giữ khóa (hoặc đã hết 6 giờ) thì hiện popup nhỏ hỏi PIN ngay trên danh sách, không chuyển sang màn Két sắt; nhập đúng thì cất và giữ khóa 6 giờ. Két chưa thiết lập thì mở trình thiết lập trước và file được cất khi thiết lập xong; két đã bị xóa bí mật thì mở màn khôi phục. **Cất xong két không đóng và không hỏi lại PIN** trong thời gian giữ khóa. Không có "Hoàn tác" vì muốn lấy ra phải mở két bằng PIN.
  - **Vào két ngay:** file biến mất khỏi danh sách chính ngay khi bắt đầu cất (kể cả trên máy khác, khi làm mới), và link chia sẻ của nó chết ngay. Trong két, mục hiện **biểu tượng đám mây mờ** (chưa mã hóa xong), và đổi thành **dấu tick xanh** khi đã mã hóa xong.
  - Khi cất, file được tải về, mã hóa, tải lên object riêng của lần thử (`vault/<id>.<attempt>`). Server chỉ đổi mục sang mã hóa khi object đó đã đủ, và bản rõ bị xóa lúc đó. Lần thử bị ngắt (mất mạng, tắt app) để mục ở trạng thái đám mây; lần mở két sau mã hóa tiếp bằng lần thử mới. Object của lần thử bỏ dở hoặc thua được cron dọn ([mục 6](#6-vòng-đời-file-thùng-rác-và-dọn-dẹp)).
  - Mục trong két chỉ hiện trên thiết bị đang mở két. Khi đang mở, thiết bị khác thấy đổi trạng thái khi làm mới (mỗi 60 giây, hoặc khi cửa sổ lấy lại focus).
- **Lấy ra khỏi két:** "Đưa ra khỏi Két sắt" khi đang xem két (sau PIN ở màn Két sắt). **Giao diện đổi ngay**, không chờ server: file rời danh sách két và hiện ở danh sách chính như một bản giả (tên đã giải mã, icon loại file vì ảnh thu nhỏ của két không còn dùng được). Khi lượt lấy ra xong thành công, bản thật thay bản giả khi làm mới. Khi lấy ra thất bại, file bỏ khỏi danh sách chính và quay lại danh sách két (nếu đang xem két và két còn mở), kèm thông báo lỗi. Trong lúc đang lấy ra, các lần làm mới đến sớm không làm file nhảy ngược. File quay về danh sách chính với tên, loại và URL thật (server ghi lại từ bản đã giải mã). Mục không đọc được, hoặc đang ở trạng thái đám mây (chưa mã hóa xong), thì không đưa ra được. Chi tiết giao diện: [9.11](desktop-ui.md#911-két-sắt-mã-hóa).
- **Trong két:** xem, tải, copy ảnh, tìm kiếm, tab Tất cả/Ảnh/File, chọn nhiều file như bình thường. Tên, loại và URL được giải mã trên máy; tìm kiếm và sắp xếp theo tên chạy trên máy.
- **Tải file lên khi đang giữ khóa:** file được mã hóa trên máy và vào thẳng két. Két không giữ khóa (chưa mở, hoặc đã hết 6 giờ) thì upload báo lỗi `vault_locked` và không tạo gì.
- **Xóa file trong két** đưa nó vào **thùng rác của két**: file vẫn ở trong két, vẫn mã hóa, không hiện ở danh sách chính. Trong thùng rác của két: **khôi phục** (về lại két), **xóa vĩnh viễn**, **dọn sạch** (chỉ mục của két). **Hoàn tác** 8 giây sau khi xóa là khôi phục về két, không có chuyện ra khỏi két. Thùng rác của két có hạn riêng 30 ngày như thùng rác thường; cron xóa hẳn sau đó.
  - Vì vậy trong két không có "chuyển vào thùng rác thường": xóa trong két thì chỉ đi tới thùng rác của két.
- **Thùng rác của két cũng được mã hóa.** Mục trong thùng rác của két mà chưa mã hóa (bị xóa sau khi có bản mới nhưng trước khi thiết lập) vẫn được mã hóa khi chuyển đổi file cũ.
- File trong két (kể cả trong thùng rác của két) tính vào dung lượng theo kích thước bản mã; như mọi file ngoài thùng rác thường, chúng không hết hạn.
- **Chuyển đổi file cũ:** file đã có trong két trước khi thiết lập (còn là bản rõ) được mã hóa **từng file** sau khi thiết lập, mỗi lần mở két bằng PIN, và mỗi lần danh sách két được tải khi đang xem (để thử lại mục đám mây mờ). Có tiến trình; mục chưa mã hóa hiện biểu tượng đám mây mờ. Bị ngắt thì lần mở sau làm tiếp. Máy tính và bản web đều mở trình thiết lập trước khi cất vào két chưa thiết lập, nên không còn đường đưa file rõ vào két.
- **Hai máy cùng cất một mục:** không chặn nhau và không giữ chỗ. Mỗi lần cất ghi một object riêng; máy hoàn tất trước thì thắng, máy kia nhận kết quả thành công nhưng object của nó bị xóa, và file vẫn mã hóa bằng khóa của máy thắng. Chi tiết: [ADR 0015](../decisions/0015-mot-object-rieng-moi-lan-ma-hoa.md).
- Android không hiện và không mở được két ([Nợ kỹ thuật](roadmap.md#nợ-kỹ-thuật)). File trong két không xuất hiện trên Android.
- Giới hạn và quy tắc an toàn (đặc biệt: **không mở két trên máy công ty hoặc qua mạng bị soi HTTPS**): [mục 7.7](security.md#77-giới-hạn-bảo-mật-còn-lại).

### 5.3 Chia sẻ link và Két sắt/thùng rác

Một file chỉ chia sẻ được khi đang **ở ngoài**. Vào Két sắt, vào thùng rác của két hoặc thùng rác là mất link ngay, **chết hẳn**: khôi phục, đưa ra khỏi két, hay bấm **Hoàn tác** đều không làm link cũ sống lại; chia sẻ lại phải tạo link mới. Lý do: file từng bị cất đi là file người dùng muốn giấu, và người nhận cũ vẫn giữ địa chỉ cũ. Thông báo khi chuyển một file đang chia sẻ nói rõ "Link chia sẻ đã hết hiệu lực".

---

## 6. Vòng đời file, thùng rác và dọn dẹp

```text
 upload ──▶ pending ──complete──▶ ready ──DELETE──▶ ready + deleted_at ──cron (30 ngày)──▶ xóa hẳn
                │                  │  ▲                    │   ▲
                │ 24h              │  └──── restore ───────┘   │
                ▼                  │                           └── DELETE /files/:id/permanent, DELETE /trash
          cron xóa                 └─ ngoài thùng rác: giữ mãi, không hết hạn
```

**Cron** (`0 3 * * *`, 03:00 UTC), xóa ở cả R2 lẫn D1, gồm bốn việc:

1. `ready`, ở thùng rác (kể cả thùng rác của két), và `deleted_at < now − 30 ngày`.
2. `pending` cũ hơn 24 giờ.
3. **Bản rõ sót lại khi lấy ra khỏi két bị ngắt:** mục `encrypted = 1` có `out_started_at` cũ hơn 1 giờ. Cron xóa `files/<id>` và `thumbs/<id>.jpg` (bản rõ), **nhả** `out_started_at` trước rồi mới xóa object. Mục vẫn mã hóa, không mất gì.
4. **Object mã hóa thừa dưới `vault/`:** cron liệt kê `vault/` và xóa object có tuổi trên 1 giờ mà (a) mục không còn, hoặc (b) tên có `attempt` khác `enc_object` của mục (một khóa không có `attempt` là của mục chỉ khi `enc_object` NULL). Object của lần cất đang chạy còn mới nên được giữ. Khóa không đúng dạng thì không đụng tới.

File `ready` ngoài thùng rác (kể cả trong két, có nhãn quan trọng, hoặc là link) **không bao giờ bị cron xóa**, dù cũ đến đâu.

Cron cũng xóa các dòng `shares` đã hết hạn; `purge` xóa tường minh `shares` của file bị xóa. `purge` (dùng cho cron, xóa vĩnh viễn và dọn sạch) xóa mọi khóa của mục: `files/<id>`, `thumbs/<id>.jpg`, cặp `vault/<id>` cố định, và cặp `vault/<id>.<enc_object>` nếu mục có `enc_object`. Không phụ thuộc cột `encrypted`, vì một lần chuyển có thể để lại cặp khóa nào cũng được. Các object rác khác của `vault/` (lần cất bỏ dở hoặc thua) là việc của cron ở mục 4. Việc xóa được làm theo lô (tối đa 100 mục mỗi lượt).

### 6.1 Ảnh nhập từ thư mục của bucket

Ảnh app khác bỏ vào `IMPORT_PREFIX` ([api.md 4.4](api.md#44-nhập-ảnh-từ-thư-mục-của-bucket)) đi vào vòng đời bình thường: dòng `pending` (giờ nhập) → `ready`. Lần nhập bị ngắt để lại dòng `pending` và bản gốc còn nguyên; lần quét sau làm tiếp. Dòng `pending` kẹt quá 24 giờ bị cron xóa như mọi upload dở (cùng `files/<id>` thừa). Cron xóa **dòng trước, có điều kiện `status = 'pending'`**, rồi mới xóa object của những dòng thật sự đã xóa (`purgePending`): một lần nhập hoàn tất dòng đó đúng lúc ấy thì dòng và object được giữ, và lần nhập nào thấy dòng đã bị cron xóa thì tự xóa bản copy của mình và để bản gốc; bản gốc vẫn còn nên lần quét sau nhập lại sạch, không mất ảnh. Sau khi nhập, ảnh là file thường: xóa vào thùng rác, xóa vĩnh viễn hoặc cron 30 ngày xóa `files/<id>` và `thumbs/<id>.jpg` như mọi file.
