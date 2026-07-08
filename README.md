# ANS Video Tools

Desktop app xử lý video đa năng (All-In-One) cho Windows — Electron + React + TypeScript, engine **FFmpeg** + **yt-dlp**.
Xây theo đặc tả `SPEC-video-toolkit-desktop-app.md`.

## Tính năng (11 module)

1. **Super Live Stream** — phát nhiều luồng RTMP song song, hẹn giờ, loop, `-c copy` CPU ~0%
2. **Basic Live Stream** — 1 nguồn → 1 RTMP
3. **Render H264/H265** — hàng loạt, tự dò NVENC/QSV/AMF
4. **Chèn Intro / Outro / Logo** — batch, logo 4 góc/giữa, độ mờ, khoảng thời gian
5. **Cắt chia nhỏ Video** — theo thời lượng/số phần, `-c copy -f segment` tức thì
6. **Cắt ngắn Video** — theo hh:mm:ss, copy hoặc re-encode chính xác
7. **Chèn Phông Xanh** — chromakey, preview 1 frame
8. **Lặp lại Video** — tới tổng thời lượng hoặc số lần, `-stream_loop -c copy`
9. **Ghép nối Video** — cùng codec = concat copy tức thì, khác codec = tự chuẩn hóa
10. **Tải Video** — yt-dlp: video/playlist/kênh, chất lượng từng video, cookies, persist danh sách
11. **Kiểm tra cập nhật** — app + `yt-dlp -U` + tải binaries

## Chạy dev

```bash
npm install
npm run fetch-bins   # tải ffmpeg/ffprobe/yt-dlp vào bin/ (một lần)
npm run dev
```

## Build

```bash
npm run build        # bundle main/preload/renderer vào out/
npm run dist         # đóng gói installer NSIS (release/)
npm run typecheck    # kiểm tra TypeScript
npm run smoke        # build + mở app 4s + chụp screenshot .smoke/
```

Nếu không chạy `fetch-bins`, app vẫn mở được và có nút **"Tải FFmpeg + yt-dlp"** trong module *Kiểm tra cập nhật* (tải về `%APPDATA%/video-toolkit-aio-pro/bin`). App cũng tự tìm ffmpeg/yt-dlp trong PATH.

## Kiến trúc

- `src/main/` — Electron main: TaskQueue (pool ffmpeg/download/live), ProcessManager (priority BelowNormal, kill tree, orphan cleanup), ProgressParser (throttle UI 4Hz), HardwareDetector (test encode thật), SettingsStore (JSON debounce), Logger (ring buffer 500 dòng + file, tự xoá >7 ngày)
- `src/main/modules/` + `src/renderer/src/modules/` — mỗi chức năng 1 module độc lập, đăng ký IPC `mod:<key>:*`
- `src/preload/` — contextBridge whitelist channel
- `src/renderer/` — React + Zustand, lazy-load từng tab, virtual list >50 dòng, i18n VI/EN

Chi tiết hợp đồng module: `CONTRACT.md`.

> ⚠️ Chức năng tải video chỉ dùng cho nội dung bạn có quyền tải (video của chính bạn, nội dung được cấp phép).
