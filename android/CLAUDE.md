# android/ — app Kotlin nhận chia sẻ (project Gradle riêng)

Spec: `docs/spec/android.md` (§8). Package `dev.fatup.app`, mọi mã nguồn ở `app/src/main/java/dev/fatup/app/`.

| File | Chứa |
|---|---|
| `ShareActivity.kt` | nhận từ menu Chia sẻ của Android (file và link) |
| `SetupActivity.kt`, `Config.kt` | thiết lập địa chỉ server + token (quét QR từ desktop hoặc nhập tay), `SharedPreferences` riêng tư, loại khỏi backup |
| `Api.kt` | HTTP client tới Worker (upload, `createLink`) |
| `UploadWorker.kt`, `Batch.kt` | upload một lô bằng WorkManager (thông báo foreground) |
| `LinkWorker.kt`, `Links.kt` | gửi một link đã chia sẻ; `extractUrl` giống bản trong `@fatup/shared` |
| `Thumbnails.kt`, `Notifications.kt` | thumbnail JPEG 400 px, thông báo tiến độ |

## Test

`./gradlew testDebugUnitTest` (trong `android/`): unit test JVM ở `app/src/test/…/LogicTest.kt`, dùng MockWebServer cho HTTP. Chỉ test logic thuần.

**Máy này có thể không có Android SDK.** Nếu `./gradlew` không chạy được, vẫn viết test, nói rõ "chưa biên dịch ở máy, CI sẽ chạy", và không báo là đã pass. CI chạy `testDebugUnitTest lintDebug assembleDebug`.

## Quy tắc

- Logic chép từ `@fatup/shared` (tách URL, giới hạn) phải giữ khớp với bản gốc — đổi cả hai.
- Hợp đồng API do Worker quyết định; không bao giờ đọc một trường mà Worker không gửi.
