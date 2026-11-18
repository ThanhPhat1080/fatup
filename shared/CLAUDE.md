# shared/ — `@fatup/shared`

Type và hằng số dùng chung cho Worker, desktop và web (Android tự viết lại phần cần dùng bằng Kotlin). Không có bước build: các package import thẳng mã nguồn TypeScript.

- `src/index.ts`: giới hạn (`MAX_FILE_SIZE`, `TRASH_RETENTION_DAYS`, `MAX_URL_LENGTH`…), `FileItem` và type request/response của API, helper URL (`normalizeUrl`, `siteOf`, `extractUrl`, `isPublicUrl`), helper chia sẻ (`isShareable`, `SHARE_EXPIRY_DAYS`).
- `src/vault.ts`: hằng số, type request/response và helper của Két sắt mã hóa (`vaultCiphertextSize`, `vaultLockMs`, `isWeakVaultPin`, `VAULT_SESSION_MS` = 6 giờ giữ khóa, `VaultClientStatus` = `VaultStatus` + `open` của app); re-export từ `index.ts`.
- `src/vault-crypto.ts`: lõi mã hóa của Két sắt chỉ dùng WebCrypto (dẫn khóa từ PIN, bọc khóa, recovery key, định dạng `FUV1` mã hóa theo khối, `encryptMeta`); chạy được ở Node, trình duyệt và Worker; re-export từ `index.ts`.
- `src/embed.ts`: chuyển một link đã lưu thành bản nhúng chính thức của nền tảng (trình phát/bài đăng) để xem trước trong app.

Quy tắc:

- Đổi một type ở đây là đổi hợp đồng API: kiểm tra `worker/src/app.ts`, `desktop/src/main/api.ts`, và `Api.kt` của Android nếu trường đó đi qua mạng. Client cũ phải vẫn chạy (thêm trường tùy chọn; không đổi tên).
- Hằng số cũng có trong Kotlin (`android/…/Links.kt`, `Api.kt`) thì phải đổi cả hai nơi.
- Các helper này được test ở nơi dùng chúng (`desktop/test/links.test.ts`, `embed.test.ts`, `share.test.ts`, test của worker).
