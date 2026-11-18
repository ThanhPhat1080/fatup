# Cài server FatUp (Cloudflare Worker)

Trang này hướng dẫn bạn tự tạo **server FatUp trên tài khoản Cloudflare của chính bạn**, từng bước một. Làm xong, bạn có một địa chỉ dạng `https://fatup.<tên-bạn>.workers.dev` để dán vào bản web, app máy tính và app Android.

Bạn không cần biết lập trình. Chỉ cần gõ (hoặc dán) từng lệnh bên dưới vào cửa sổ dòng lệnh, rồi nhấn Enter.

> **Mỗi người một server riêng.** FatUp chỉ dành cho một người dùng: ai có token thì đọc và xóa được mọi file. Nếu người khác muốn dùng, họ làm lại đúng các bước ở trang này trên tài khoản Cloudflare của họ. Đừng đưa token của bạn cho họ.

## Một vài từ cần biết

| Từ | Nghĩa đơn giản |
|---|---|
| **Cloudflare** | Công ty cung cấp chỗ lưu file và chạy server miễn phí (trong hạn mức). |
| **Worker** | Chương trình server của FatUp, chạy trên Cloudflare. |
| **R2** | Ổ đĩa của Cloudflare, nơi chứa file của bạn (10 GB miễn phí). |
| **D1** | Cơ sở dữ liệu nhỏ của Cloudflare, nơi ghi danh sách file, tên file, thẻ màu… |
| **wrangler** | Công cụ dòng lệnh của Cloudflare. Các lệnh `npx wrangler …` dưới đây dùng nó để tạo và đẩy mọi thứ lên Cloudflare. Bạn không cần cài riêng: `npm install` ở Bước 1 đã cài sẵn. |
| **Secret** | Mật khẩu hoặc khóa được cất kín trên Cloudflare, không nằm trong code. |
| **Token** | Một chuỗi ký tự dài, đóng vai mật khẩu để app đăng nhập vào server của bạn. |

## Chuẩn bị (làm một lần)

1. **Tài khoản Cloudflare**: đăng ký miễn phí ở [dash.cloudflare.com](https://dash.cloudflare.com). Gói miễn phí là đủ.
2. **Bật R2**: vào Dashboard → **R2** → bật dịch vụ. Cloudflare có thể đòi thêm thẻ thanh toán, nhưng nếu bạn dùng trong hạn mức miễn phí thì không mất phí.
3. **Node.js bản 22 trở lên** (đi kèm `npm`): tải ở [nodejs.org](https://nodejs.org). Kiểm tra bằng lệnh `node -v`; kết quả phải bắt đầu bằng `v22` hoặc cao hơn.
4. **git**: tải ở [git-scm.com](https://git-scm.com). Kiểm tra bằng lệnh `git --version`.
5. **Mở cửa sổ dòng lệnh**: **Terminal** trên macOS và Linux, **PowerShell** trên Windows.

## Bước 1. Tải code về máy

```bash
git clone https://github.com/ThanhPhat1080/fatup
cd fatup
npm install
```

- Lệnh đầu tải code về một thư mục tên `fatup`.
- Lệnh thứ hai đi vào thư mục đó.
- Lệnh thứ ba cài các thư viện cần thiết (mất vài phút, cứ để chạy).

Từ giờ đến hết trang, **mọi lệnh chạy trong thư mục `worker`**, nên gõ:

```bash
cd worker
```

## Bước 2. Đăng nhập Cloudflare

```bash
npx wrangler login
```

Trình duyệt tự mở ra. Đăng nhập Cloudflare (nếu chưa), rồi bấm **Allow**. Quay lại cửa sổ dòng lệnh, thấy chữ "Successfully logged in" là xong.

## Bước 3. Tạo nơi chứa file (R2)

```bash
npx wrangler r2 bucket create fatup-files
```

**Bucket** là tên gọi của một "thùng" chứa file trong R2. Bạn đang tạo thùng tên `fatup-files`.

> Giữ nguyên tên `fatup-files`. Đổi tên thì bạn phải sửa thêm ở nhiều chỗ trong code, rất dễ sai.

## Bước 4. Tạo cơ sở dữ liệu (D1)

```bash
npx wrangler d1 create fatup
```

Lệnh này in ra một đoạn như sau (giá trị của bạn sẽ khác):

```
database_name = "fatup"
database_id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
```

**Chép dòng `database_id` đó vào file cấu hình:**

1. Mở file `worker/wrangler.toml` bằng bất kỳ trình soạn thảo nào (Notepad, VS Code…).
2. Tìm dòng `database_id = "…"` (nằm dưới `[[d1_databases]]`).
3. Thay đoạn trong dấu ngoặc kép bằng `database_id` mới của bạn. Lưu file.

> **Đừng bỏ qua bước này.** Giá trị có sẵn trong file là của người viết ra FatUp. Nếu để nguyên, lệnh ở Bước 5 sẽ báo lỗi vì bạn không có quyền với cơ sở dữ liệu đó.

## Bước 5. Tạo các bảng trong cơ sở dữ liệu

```bash
npm run db:migrate:remote
```

Khi nó hỏi có chạy không, gõ `y` rồi Enter. Lệnh này tạo sẵn các bảng mà FatUp cần.

## Bước 6. Tạo khóa để server truy cập R2

Server cần một "chìa khóa" để cấp link tải file lên và xuống R2. Bạn tạo chìa khóa này trên trang Cloudflare:

1. Vào Dashboard → **R2**.
2. Bấm **Manage API tokens** (hoặc **API** → **Manage API tokens**), rồi **Create API token**.
3. Ở **Permissions**, chọn **Object Read & Write**.
4. Ở **Specify bucket(s)**, chọn **Apply to specific buckets only** và chọn `fatup-files`.
5. Bấm **Create API Token**.

Màn hình kế tiếp hiện ba thứ. **Chép cả ba vào một nơi tạm** (ghi chú, trình quản lý mật khẩu…):

- **Access Key ID**
- **Secret Access Key**: **chỉ hiện một lần**. Đóng trang là không xem lại được; mất thì phải tạo token mới.
- **Account ID**: chuỗi dài 32 ký tự, cũng hiện ở trang tổng quan của R2.

## Bước 7. Cất ba khóa đó lên Cloudflare

Chạy lần lượt từng lệnh. Mỗi lệnh hiện dòng `Enter a secret value:`; bạn **dán giá trị tương ứng rồi Enter**. Lúc dán, màn hình không hiện ký tự nào, đó là bình thường.

```bash
npx wrangler secret put R2_ACCESS_KEY_ID
```
→ dán **Access Key ID**.

```bash
npx wrangler secret put R2_SECRET_ACCESS_KEY
```
→ dán **Secret Access Key**.

```bash
npx wrangler secret put R2_ACCOUNT_ID
```
→ dán **Account ID**.

Nếu wrangler hỏi "There doesn't seem to be a Worker called fatup. Do you want to create a new Worker?", chọn **Yes**.

## Bước 8. Tạo token đăng nhập của bạn

```bash
npm run token:new
```

Lệnh in ra một chuỗi ký tự dài. Đây là **token đăng nhập** của bạn.

1. **Chép và cất kỹ** (tốt nhất trong trình quản lý mật khẩu). Bạn sẽ cần dán nó vào mỗi thiết bị.
2. Rồi cất nó lên Cloudflare:

```bash
npx wrangler secret put API_TOKEN
```

→ dán đúng chuỗi token vừa chép, rồi Enter.

> Ai có token này thì đọc và xóa được file của bạn. Đừng gửi lên chat, đừng đưa người khác.

## Bước 9. Cho phép trình duyệt tải file lên R2

```bash
npm run r2:cors
```

Bước này cho phép trình duyệt gửi file thẳng lên R2. Thiếu nó thì bản web không tải file lên được.

## Bước 10. Đưa server lên mạng

```bash
npm run deploy
```

Lệnh này build bản web rồi đẩy mọi thứ lên Cloudflare. Mất khoảng một đến hai phút.

- Nếu Cloudflare hỏi bạn đặt tên miền con `workers.dev` (lần đầu), nhập một tên bất kỳ bằng chữ thường, không dấu.
- Cuối cùng nó in ra địa chỉ dạng `https://fatup.<tên-bạn>.workers.dev`. **Chép địa chỉ này.**

## Bước 11. Kiểm tra server chạy chưa

Thay `<tên-bạn>` bằng phần có trong địa chỉ của bạn:

```bash
curl https://fatup.<tên-bạn>.workers.dev/health
```

Thấy `{"ok":true}` là server đã chạy. Bạn cũng có thể mở địa chỉ đó trong trình duyệt để vào bản web.

## Xong rồi, làm gì tiếp?

- Mở địa chỉ server trên điện thoại hoặc máy tính, dán **token** (Bước 8), đặt PIN 4 số: xem [Mở bản web và cài như app](../../README.md#2-mở-bản-web-và-cài-như-app).
- Muốn dùng app riêng: [app máy tính](desktop.md) hoặc [app Android](android.md).

## Gặp lỗi?

| Thấy gì | Thường là do | Cách xử lý |
|---|---|---|
| `command not found: npx` hoặc `node` | Chưa cài Node.js | Cài Node.js 22 trở lên, mở lại cửa sổ dòng lệnh. |
| Lệnh `wrangler` báo "not authenticated" hoặc lỗi quyền | Chưa đăng nhập, hoặc đăng nhập tài khoản khác | Chạy lại `npx wrangler login`. |
| Bước 3 báo cần bật R2 | Chưa bật R2 | Làm mục "Chuẩn bị" số 2, rồi chạy lại. |
| Bước 5 báo lỗi quyền hoặc "database not found" | Chưa thay `database_id` trong `worker/wrangler.toml` | Làm lại Bước 4, phần chép `database_id`. |
| Lần `secret put` trước gõ nhầm | Dán sai giá trị | Chạy lại đúng lệnh `secret put` đó, dán giá trị mới: nó ghi đè giá trị cũ. |
| Bước 11 không thấy `{"ok":true}` | Deploy chưa xong hoặc lỗi | Chạy lại `npm run deploy` và đọc dòng lỗi cuối cùng. |
| Bản web báo sai token | Dán token thiếu hoặc thừa ký tự | Chép lại token ở Bước 8; nếu mất, tạo token mới (xem dưới). |

## Mất token hoặc muốn đổi token

Chạy lại Bước 8 (`npm run token:new` rồi `npx wrangler secret put API_TOKEN`). Token cũ lập tức mất hiệu lực, nên bạn phải dán token mới vào mọi thiết bị.

## Nâng cấp lên bản mới

Xem mục [Nâng cấp server](../../README.md#nâng-cấp-server) trong README. Luôn **migrate trước, deploy sau**.
