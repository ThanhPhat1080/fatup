# 0005. PWA dùng lại UI desktop, chỉ thay `window.fatup`

- Trạng thái: Đã chốt
- Ngày: 2026-11-16 (ghi lại; quyết định có từ Phase 2)
- Nguồn: `docs/spec/desktop-ui.md` §9.9, `docs/spec/web.md` §10; `web/src/entry.ts`
- Phạm vi: desktop, web

## Bối cảnh

Hai app (Electron và PWA) có cùng chức năng. Hai bộ UI sẽ lệch nhau.

## Quyết định

Một bộ React duy nhất ở `desktop/src/renderer/`. Mọi khác biệt nền tảng nằm sau interface `FatupApi` (`desktop/src/shared-ipc.ts`): Electron cài qua `preload` + IPC tới main process; web cài bằng `web/src/browser-api.ts` (`fetch` + `localStorage`). `ApiClient` (`desktop/src/main/api.ts`) dùng chung.

## Hệ quả

- Mọi sửa UI ảnh hưởng cả hai; phải nghĩ tới bố cục điện thoại (không hover, chạm giữ).
- Đổi `FatupApi` = sửa ba chỗ: preload, IPC handler ở main, browser-api.
- Đừng import module Node/Electron trong renderer; đừng rẽ nhánh UI theo nền tảng khi có thể đưa vào bridge.
