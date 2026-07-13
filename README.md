# ANS Video Tools

Desktop app xử lý video đa năng (All-In-One) cho Windows — Electron + React + TypeScript, engine **FFmpeg** + **yt-dlp**.
Xây theo đặc tả `SPEC-video-toolkit-desktop-app.md`.

## Tính năng (15 module)

1. **Render H264/H265** — hàng loạt, tự dò NVENC/QSV/AMF
2. **Chuyển đổi định dạng Video** — hàng loạt sang MP4/FLV, chạy đa luồng, chọn thư mục xuất
3. **Xóa Audio khỏi Video** — xử lý hàng loạt, chọn thư mục xuất, stream-copy không giảm chất lượng
4. **Nâng cấp 4K (AI)** — upscale video với encoder phần cứng khi khả dụng
5. **Chèn Intro / Outro / Logo** — batch, logo 4 góc/giữa, độ mờ, khoảng thời gian
6. **Cắt chia nhỏ Video** — theo thời lượng/số phần, `-c copy -f segment` tức thì
7. **Cắt ngắn Video** — theo hh:mm:ss, copy hoặc re-encode chính xác
8. **Chèn Phông Xanh** — chromakey, preview 1 frame
9. **Xóa Nền Ảnh (Photokey)** — xóa phông xanh lá/xanh dương khỏi ảnh tĩnh, xuất PNG trong suốt
10. **Lặp lại Video** — tới tổng thời lượng hoặc số lần, `-stream_loop -c copy`
11. **Ghép nối Video** — cùng codec = concat copy tức thì, khác codec = tự chuẩn hóa
12. **Ghép Video Ngẫu Nhiên** — tạo nhiều tổ hợp video tự động
13. **Ghép Âm Thanh Ngẫu Nhiên** — xuất MP3 mặc định hoặc WAV, chọn thư mục xuất riêng
14. **Tải Video** — yt-dlp: video/playlist/kênh, chất lượng từng video, cookies, persist danh sách
15. **Kiểm tra cập nhật** — tự kiểm tra/tải/cài bản app mới + cập nhật `yt-dlp`

## Chạy dev

```bash
npm install
npm run fetch-bins   # tải ffmpeg/ffprobe/yt-dlp vào bin/ (một lần)
npm run dev
```

## Xác thực ANS-Video

Trước khi bắt đầu xác thực (bao gồm tự đăng nhập bằng thông tin đã nhớ), app luôn chạy cổng cập nhật lúc khởi động. Nếu có bản mới, app tải, cài và khởi động lại trước; chỉ phiên bản mới nhất mới đi tiếp tới màn hình/phiên đăng nhập. Lỗi metadata/cấu hình cập nhật sẽ giữ cổng và cho thử lại; chỉ lỗi kết nối tạm thời mới không khóa người dùng khỏi bước đăng nhập.

Main process gửi `username`, `password` và HWID Windows ổn định tới `POST /api/ans-video/login`. Sau lần nhập mật khẩu thành công, thông tin đăng nhập được Electron `safeStorage` mã hóa theo tài khoản Windows và ghi nhớ tối đa 48 giờ trong `userData`; không lưu trong renderer, `localStorage`, `settings.json` hoặc `kv.json`. Mỗi lần mở lại trong thời hạn này, ứng dụng vẫn gọi `/login` để máy chủ kiểm tra lại mật khẩu, trạng thái, thời hạn và HWID; việc tự đăng nhập không gia hạn mốc 48 giờ. Đăng xuất, dữ liệu hỏng/quá hạn hoặc máy chủ từ chối tài khoản sẽ xóa thông tin đã nhớ.

Chỉ response thành công cho tài khoản đang hoạt động, còn hạn và đúng HWID mới mở giao diện lẫn IPC xử lý. Khi tới giờ hết hạn của tài khoản, phiên bị khóa và các tác vụ đang chạy/chờ được dừng. Nếu kho mã hóa của hệ điều hành không khả dụng, ứng dụng không hạ cấp sang lưu plaintext và người dùng sẽ cần đăng nhập lại.

Cấu hình mặc định dùng API production `https://tools.amnhacso.com`. Khi phát triển hoặc chạy smoke test, có thể ghi đè bằng biến môi trường main process; bản đóng gói luôn khóa URL/key mặc định:

```powershell
$env:ANS_VIDEO_API_BASE_URL = 'http://localhost:4016'
$env:ANS_VIDEO_CLIENT_API_KEY = '<client-api-key>'
npm run dev
```

Không dùng `API_KEY` quản trị trong ứng dụng desktop.

> Lưu ý bảo mật: bản production dùng HTTPS tại `tools.amnhacso.com`. Override HTTP chỉ được chấp nhận với loopback để phát triển/smoke test; không dùng HTTP cho máy chủ từ xa vì tính năng ghi nhớ 48 giờ có thể tự gửi lại thông tin đăng nhập khi mở app.

## Build

```bash
npm run build        # bundle main/preload/renderer vào out/
npm run dist         # đóng gói NSIS auto-update + MSI cài thủ công (release/)
npm run release:patch # tăng patch version rồi tạo bộ phát hành auto-update
npm run typecheck    # kiểm tra TypeScript
npm run smoke        # build + mở app 4s + chụp screenshot .smoke/
```

Nếu không chạy `fetch-bins`, app vẫn mở được và có nút **"Tải FFmpeg + yt-dlp"** trong module *Kiểm tra cập nhật* (tải về `%APPDATA%/video-toolkit-aio-pro/bin`). App cũng tự tìm ffmpeg/yt-dlp trong PATH.

## Kiến trúc

- `src/main/` — Electron main: TaskQueue (pool ffmpeg/download/misc), ProcessManager (priority BelowNormal, kill tree, orphan cleanup), ProgressParser (throttle UI 4Hz), HardwareDetector (test encode thật), SettingsStore (JSON debounce), Logger (ring buffer 500 dòng + file, tự xoá >7 ngày)
- `src/main/modules/` + `src/renderer/src/modules/` — mỗi chức năng 1 module độc lập, đăng ký IPC `mod:<key>:*`
- `src/preload/` — contextBridge whitelist channel
- `src/renderer/` — React + Zustand, lazy-load từng tab, virtual list >50 dòng, i18n VI/EN

Chi tiết hợp đồng module: `CONTRACT.md`.

Quy trình phát hành và tự cập nhật: [`UPDATES.md`](UPDATES.md).

> ⚠️ Chức năng tải video chỉ dùng cho nội dung bạn có quyền tải (video của chính bạn, nội dung được cấp phép).
