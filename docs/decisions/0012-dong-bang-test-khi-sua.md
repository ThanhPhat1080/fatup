# 0012. Đóng băng file test khi làm cho test thất bại chạy qua

- Trạng thái: Đã chốt
- Ngày: 2026-11-15
- Nguồn: commit `ea8adf0`; `.claude/hooks/block-test-edits.sh`
- Phạm vi: quy trình

## Bối cảnh

Khi agent vừa viết test vừa sửa code, nó có thể "làm test pass" bằng cách sửa test.

## Quyết định

Quy trình: viết test thất bại (agent `test-writer`), commit, rồi `touch .claude/tests-frozen`. Khi file này tồn tại, hook PreToolUse chặn mọi Edit/Write vào file test (`worker/test/`, `desktop/e2e/`, `*.test.ts(x)`, `*.spec.ts(x)`, `*Test.kt`, thư mục test Android). Làm xong thì `rm .claude/tests-frozen`.

## Hệ quả

- Nếu test sai thật, agent phải dừng và hỏi người dùng gỡ đóng băng, không tự xóa file cờ.
- File cờ bị gitignore; nhớ xóa sau khi xong, nếu không mọi việc sửa test sau đó đều bị chặn.
