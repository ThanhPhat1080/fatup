# 0001. Ghi quyết định bằng ADR trong git

- Trạng thái: Đã chốt
- Ngày: 2026-11-16
- Nguồn: chuyển sang cách làm "tài liệu cho AI trước" (`CLAUDE.md` ở gốc)
- Phạm vi: quy trình

## Bối cảnh

Quyết định đang nằm rải rác: `SPEC.md` (cái gì), design spec (vì sao, nhưng theo từng tính năng), và sổ SDD `.superpowers/sdd/*/progress.md` (các "Ruling" lúc triển khai). Sổ SDD bị gitignore, nên ruling như "bỏ phím tắt Ctrl+L" mất đi sau khi xong việc; session sau của agent không biết và có thể làm lại đúng thứ đã bị loại.

## Quyết định

Mỗi quyết định có lựa chọn thay thế đáng kể được ghi thành một file trong `docs/decisions/`, theo mẫu ở `README.md`. Ruling trong sổ SDD làm đổi hành vi phải được chép sang đây trước khi merge (việc của agent `doc-keeper`).

## Hệ quả

- Agent hỏi "vì sao" thì đọc `docs/decisions/README.md` trước khi đoán.
- Thứ tự tin cậy: spec (`SPEC.md` + `docs/spec/`) > design spec > ADR > plan > code. ADR giải thích, spec mô tả trạng thái hiện tại.
- Thêm một bước tài liệu cho mỗi tính năng.
