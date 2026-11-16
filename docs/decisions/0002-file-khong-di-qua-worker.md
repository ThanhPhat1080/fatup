# 0002. File không đi qua Worker (presigned R2), trừ link chia sẻ

- Trạng thái: Đã chốt
- Ngày: 2026-11-16 (ghi lại; quyết định có từ v1, ngoại lệ thêm ở v0.4.2)
- Nguồn: `SPEC.md` §1, `docs/spec/api.md` §4.2; `docs/superpowers/specs/2026-11-16-share-links-design.md` §4.1
- Phạm vi: worker

## Bối cảnh

Worker có giới hạn kích thước body request và tính tiền theo CPU. File tới 100 MB.

## Quyết định

Worker chỉ cấp **presigned URL** (S3 SigV4, `aws4fetch`); client PUT/GET thẳng tới R2. Upload: 15 phút; thumbnail/download: 1 giờ.

**Ngoại lệ duy nhất:** link chia sẻ công khai `/s/<token>`. Ở đó Worker truyền file từ binding R2, vì presigned URL đã phát ra thì không thu hồi được, mà link chia sẻ phải chết ngay khi file vào Két sắt/thùng rác (xem 0003).

## Hệ quả

- R2 bucket cần CORS (`worker/r2-cors.json`) để trình duyệt upload.
- Đừng thêm route proxy file khác qua Worker. Đừng đổi `/s/` sang chuyển hướng tới presigned URL.
- Không hỗ trợ `Range` trên `/s/` (chưa cần).
