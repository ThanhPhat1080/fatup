# Cài app máy tính (macOS, Windows, Linux)

App máy tính (Electron) có cùng giao diện với bản web, thêm hai thứ: **kiểm tra cập nhật** và **mã QR để ghép app Android**. Cần có server trước: xem [README](../../README.md#cài-đặt).

## Tải và cài

Tải bản mới nhất trong [Releases](https://github.com/ThanhPhat1080/fatup/releases). App **không được ký số**, nên hệ điều hành sẽ cảnh báo lần đầu.

| Hệ điều hành | File | Lần đầu mở |
|---|---|---|
| **macOS** (Apple Silicon) | `.dmg` | Kéo FatUp vào Applications, rồi chuột phải → **Open**. Nếu báo "app bị hỏng": `xattr -cr /Applications/FatUp.app` |
| **Windows** | `.exe` | SmartScreen cảnh báo: chọn **More info → Run anyway** |
| **Linux** (Ubuntu…) | `.AppImage` | `chmod +x FatUp-*.AppImage` rồi chạy |

Muốn tự build: xem [Phát triển và phát hành](../development.md#build-app-máy-tính).

## Lần đầu mở app

1. Dán **địa chỉ server** (`https://fatup.<tên-bạn>.workers.dev`) và **token** → **Tiếp**.
2. Đặt **PIN 4 số**. Mỗi máy có PIN riêng.

Quên PIN: bấm **Quên PIN? Đặt lại** ở màn hình khóa rồi nhập lại token.

## Cập nhật

**⚙ Cài đặt → Kiểm tra cập nhật.**

- **Windows** và **Linux AppImage**: app tự tải bản mới, cài và khởi động lại.
- **macOS**: app mở trang tải về; tải `.dmg` mới và cài đè. App chưa ký số nên macOS không cho tự thay app.

App chỉ thấy một bản mới khi bản đó đã được **Publish** trên GitHub (bản draft thì không).

## Ghép app Android

**⚙ Cài đặt → Kết nối Android**, nhập PIN để hiện mã QR, rồi quét bằng app Android. Xem [Cài app Android](android.md).
