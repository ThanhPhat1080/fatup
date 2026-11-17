# Cài app Android

App Android là một **đích chia sẻ**: không có danh sách file, chỉ để gửi nhanh ảnh, file và link lên FatUp. Muốn xem và quản lý file trên điện thoại, dùng [bản web (PWA)](../../README.md#2-mở-bản-web-và-cài-như-app).

## Cài

Tải `FatUp-*-android.apk` trong [Releases](https://github.com/ThanhPhat1080/fatup/releases) rồi mở file để cài (cần Android 9 trở lên, và cho phép **cài từ nguồn không xác định**).

## Kết nối với server

1. Trên app máy tính: **⚙ Cài đặt → Kết nối Android**, nhập PIN để hiện mã QR ([cài app máy tính](desktop.md)).
2. Trên điện thoại: mở FatUp → **Quét mã QR**. Hoặc quét bằng camera của máy: link `fatup://` sẽ tự mở app.

Không có app máy tính thì nhập tay địa chỉ server và token trong app Android, rồi bấm **Gửi thử** để kiểm tra.

## Gửi lên FatUp

Ở bất kỳ app nào (Ảnh, Files, trình duyệt, YouTube…), chọn ảnh, file hoặc link → **Chia sẻ → FatUp**.

- Gửi được nhiều file một lúc, tối đa 100 MB mỗi file. Ảnh có thumbnail tạo sẵn trên máy.
- Thanh thông báo hiện tiến độ. Mất mạng thì app xếp hàng và tự gửi lại khi có mạng.
- Chia sẻ đoạn văn bản có link thì FatUp lưu link đó vào tab **Liên kết**.
