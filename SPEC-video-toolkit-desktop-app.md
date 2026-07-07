# 📋 ĐẶC TẢ KỸ THUẬT — Desktop App "Video Toolkit AIO Pro"

> Tài liệu này dùng làm **prompt/spec đầu vào** cho AI hoặc đội dev để xây dựng một ứng dụng desktop xử lý video đa năng (All-In-One), mô phỏng đầy đủ chức năng của Super Zenni Tool AIO Pro, với trọng tâm **tối ưu hiệu năng**.

---

## 1. TỔNG QUAN

| Mục | Nội dung |
|---|---|
| Tên app | Video Toolkit AIO Pro |
| Nền tảng | Windows 10/11 (ưu tiên), có thể mở rộng macOS/Linux |
| Loại app | Desktop app, giao diện dark theme hiện đại |
| Engine xử lý | **FFmpeg** (render, cắt, ghép, stream) + **yt-dlp** (tải video) |
| Ngôn ngữ UI | Tiếng Việt (mặc định) + Tiếng Anh, có nút chuyển ngôn ngữ ở thanh trạng thái |
| Phiên bản khởi đầu | v1.0.0 |

### 1.1. Tech stack đề xuất (ưu tiên hiệu năng)

**Phương án A — Tauri (khuyến nghị):**
- Backend: **Rust** (Tauri v2) — quản lý tiến trình FFmpeg/yt-dlp, hàng đợi tác vụ, file system.
- Frontend: React + TypeScript + TailwindCSS + Zustand (state).
- Ưu điểm: RAM ~50–80MB, file cài đặt ~10MB, khởi động < 1 giây, không nhúng Chromium.

**Phương án B — Electron (nếu team quen JS):**
- Electron + React + TypeScript, main process Node.js quản lý child process.
- Bắt buộc áp dụng các kỹ thuật tối ưu ở Mục 5 để giảm RAM/CPU.

**Bundle kèm app:** `ffmpeg.exe`, `ffprobe.exe`, `yt-dlp.exe` đặt trong thư mục `bin/`, có cơ chế tự cập nhật yt-dlp.

---

## 2. KIẾN TRÚC TỔNG THỂ

```
┌─────────────────────────────────────────────────────┐
│                      UI Layer                        │
│  Sidebar (11 module) │ Header │ StatusBar │ Toast    │
├─────────────────────────────────────────────────────┤
│                  App Core (Backend)                  │
│  • TaskQueue (hàng đợi tác vụ, giới hạn song song)   │
│  • ProcessManager (spawn/kill FFmpeg, yt-dlp)        │
│  • ProgressParser (đọc stderr FFmpeg → % tiến trình) │
│  • HardwareDetector (dò NVENC/QSV/AMF)               │
│  • SettingsStore (JSON/SQLite)                       │
│  • Logger (ghi log theo tác vụ)                      │
├─────────────────────────────────────────────────────┤
│              External Binaries (bin/)                │
│         ffmpeg │ ffprobe │ yt-dlp                    │
└─────────────────────────────────────────────────────┘
```

**Nguyên tắc cốt lõi:**
1. Mọi tác vụ nặng chạy ở **process riêng** (FFmpeg/yt-dlp), UI không bao giờ bị đơ.
2. Tất cả tác vụ đi qua **TaskQueue** trung tâm: mỗi task có `id, type, status, progress, pid, logFile`.
3. Nút **"KILL ALL FFMPEG"** trên header: gửi SIGKILL/taskkill toàn bộ PID đang quản lý + quét process ffmpeg mồ côi do app sinh ra.

---

## 3. GIAO DIỆN (UI/UX)

### 3.1. Layout chính
- **Header (trên cùng):** Logo + tên app │ nút đỏ `KILL ALL FFMPEG` │ bên phải: `Xin chào, {tên user}` │ `HSD: {hạn dùng / Không giới hạn}`.
- **Sidebar (trái):** 11 mục điều hướng, mục đang chọn được highlight:
  1. Super Live Stream
  2. Basic Live Stream
  3. Render H264/H265
  4. Chèn Intro / Outro / Logo
  5. Cắt chia nhỏ Video
  6. Cắt ngắn Video
  7. Chèn Phông Xanh
  8. Lặp lại Video
  9. Ghép nối Video
  10. Tải Video
  11. Kiểm tra cập nhật (dưới cùng)
- **Status bar (dưới cùng):** bản quyền + version │ liên kết mạng xã hội │ hotline │ nút chuyển ngôn ngữ VI/EN │ **đồng hồ RAM còn trống (%) và CPU (%)** cập nhật mỗi 2 giây.

### 3.2. Theme
- Dark theme: nền `#0d1220`–`#141a2e`, card `#1a2138`, accent xanh dương `#2f6bff`, nút nguy hiểm đỏ `#e03131`, tiến trình xanh lá `#2fbf71`.
- Bo góc 10–12px, hiệu ứng hover nhẹ, KHÔNG dùng animation nặng (blur/shadow động) để tiết kiệm GPU.

---

## 4. ĐẶC TẢ CHỨC NĂNG CHI TIẾT

### 4.1. Super Live Stream (phát trực tiếp nhiều luồng song song)
- Bảng danh sách luồng, mỗi dòng: nguồn video (file/thư mục/playlist) │ RTMP URL + Stream Key │ trạng thái │ thời gian đã phát │ nút Start/Stop riêng.
- Cho phép chạy **nhiều luồng đồng thời** (giới hạn theo cấu hình máy, mặc định 5).
- Tùy chọn mỗi luồng: loop vô hạn, phát ngẫu nhiên, lịch hẹn giờ bắt đầu/kết thúc, bitrate, độ phân giải, encoder (copy / x264 / NVENC).
- **Chế độ `-c copy`** khi video đã đúng chuẩn (H264 + AAC): CPU gần như 0%.
- Tự động reconnect khi rớt mạng (`-reconnect 1 -reconnect_streamed 1 -reconnect_delay_max 5`).

### 4.2. Basic Live Stream
- Bản rút gọn: 1 nguồn video → 1 RTMP đích. Form đơn giản: chọn file, nhập RTMP/key, chọn loop, nút Start/Stop, log realtime.

### 4.3. Render H264/H265
- Kéo-thả nhiều file/thư mục vào danh sách.
- Tùy chọn: codec (H264/H265), encoder (**tự dò**: NVENC → QSV → AMF → libx264/x265), CRF/bitrate, preset, độ phân giải, FPS, audio (copy/AAC).
- Render hàng loạt qua TaskQueue, hiển thị % từng file + tốc độ (fps, speed=x).

### 4.4. Chèn Intro / Outro / Logo
- Chọn video chính (hàng loạt) + file intro + file outro + file logo (PNG trong suốt).
- Logo: chọn vị trí (4 góc/giữa), kích thước %, độ mờ, thời gian hiển thị (toàn bộ / từ giây X đến Y).
- Intro/outro tự động scale về cùng độ phân giải video chính rồi concat.

### 4.5. Cắt chia nhỏ Video
- Input: 1 hoặc nhiều video. Chế độ chia: theo **thời lượng mỗi phần** (vd 10 phút/phần) hoặc theo **số phần**.
- Mặc định dùng `-c copy -f segment` (không re-encode → gần như tức thì); có checkbox "Cắt chính xác từng frame (re-encode, chậm hơn)".

### 4.6. Cắt ngắn Video
- Chọn video → nhập điểm bắt đầu / kết thúc (hh:mm:ss) hoặc kéo trên timeline có preview thumbnail.
- Ưu tiên `-ss ... -to ... -c copy`; tùy chọn re-encode chính xác.

### 4.7. Chèn Phông Xanh (Green Screen)
- Video nền + video/ảnh có phông xanh → filter `chromakey`/`colorkey`.
- Tham số: màu key (mặc định 0x00FF00, có color picker), similarity, blend; vị trí & kích thước lớp phủ; preview 1 frame trước khi render.

### 4.8. Lặp lại Video
- Chọn video → lặp đến **tổng thời lượng mục tiêu** (vd 1 giờ) hoặc **số lần lặp**.
- Dùng `-stream_loop N -c copy` (không re-encode).

### 4.9. Ghép nối Video
- Danh sách file có thể kéo-thả sắp xếp thứ tự.
- Nếu cùng codec/độ phân giải → concat demuxer `-c copy` (tức thì). Nếu khác → tự động chuẩn hóa (scale + fps + re-encode) rồi ghép, có cảnh báo trước.

### 4.10. Tải Video (module như trong ảnh — mô tả kỹ nhất)

**Khối "Nguồn Video" (trái):**
- Ô nhập `Link Video / Playlist / Kênh` (placeholder: "Dán link YouTube / TikTok / Facebook…").
- Nút **"Tải thông tin"**: chạy `yt-dlp -J --flat-playlist` để lấy metadata (không tải file), phân giải playlist/kênh thành từng video, thêm vào danh sách bên dưới.
- Ghi chú: hỗ trợ video lẻ, playlist và kênh từ YouTube, TikTok, Facebook và nhiều nền tảng khác; hỗ trợ import cookies (file cookies.txt hoặc từ trình duyệt) cho video cần đăng nhập.

**Khối "Đầu ra & Xử lý" (phải):**
- `Thư mục lưu`: chọn folder, lưu lại lần sau.
- `Chất lượng`: dropdown — Tốt nhất hiện có / 2160p / 1440p / 1080p / 720p / 480p / Chỉ âm thanh (MP3/M4A).
- `Số video tải cùng lúc`: số nguyên 1–10 (mặc định 2) — giới hạn concurrency của TaskQueue.
- Nút **"Tải tất cả"** (xanh) và **"Dừng tất cả"** (đỏ).

**Khối "Danh sách Video":**
- Badge tổng số video. Nút "Xoá tất cả".
- Bảng cột: `# │ Ảnh (thumbnail) │ Tên │ Thời lượng │ Kích thước │ Chất lượng (dropdown riêng từng video) │ Tiến trình │ Hành động (tải lại ⬇ / xoá 🗑)`.
- Tiến trình: progress bar realtime (% + tốc độ + ETA, parse từ stdout yt-dlp), trạng thái: Chờ / Đang tải / Completed ✅ / Lỗi ❌ (kèm nút xem log).
- **Ảo hóa danh sách (virtual list)** khi > 50 dòng.
- Danh sách được lưu (persist) — mở lại app vẫn còn.

### 4.11. Kiểm tra cập nhật
- Gọi API endpoint (hoặc GitHub Releases) so sánh version → hiện dialog changelog + nút tải bản mới.
- Kèm nút "Cập nhật yt-dlp" (`yt-dlp -U`) vì các site đổi API liên tục.

### 4.12. Hệ thống chung
- **Đăng nhập / license:** username + key, hiển thị `HSD` trên header (ngày hết hạn hoặc "Không giới hạn"). Có chế độ offline grace 3 ngày.
- **Cài đặt:** thư mục mặc định, giới hạn task song song toàn cục, chọn GPU encoder, ngôn ngữ, tự chạy cùng Windows.
- **Log:** mỗi task 1 file log trong `logs/`, tự xoá log > 7 ngày.

---

## 5. TỐI ƯU HIỆU NĂNG (BẮT BUỘC)

### 5.1. Tận dụng phần cứng
- Khởi động app → chạy `ffmpeg -encoders` + dò GPU để phát hiện **NVENC (NVIDIA) / QSV (Intel) / AMF (AMD)**; mặc định chọn hardware encoder, fallback libx264.
- Với NVENC: dùng `-hwaccel cuda -hwaccel_output_format cuda` để decode + encode đều trên GPU, tránh copy dữ liệu qua RAM.

### 5.2. Tránh re-encode khi không cần
- Cắt / chia / lặp / ghép (cùng codec) / livestream chuẩn: luôn ưu tiên `-c copy` → nhanh gấp 50–100 lần, CPU ~0%.
- Trước mỗi tác vụ, chạy `ffprobe` để quyết định copy hay re-encode, hiển thị cho user biết chế độ nào đang dùng.

### 5.3. Quản lý tiến trình & hàng đợi
- TaskQueue giới hạn số FFmpeg chạy đồng thời = `min(cấu hình user, số nhân CPU / 2)`; download queue riêng theo "Số video tải cùng lúc".
- Spawn process với priority `BelowNormal` để UI luôn mượt.
- Kill task = kill **cả process tree** (`taskkill /T /F` trên Windows) tránh ffmpeg mồ côi.
- Đọc stderr FFmpeg theo stream, parse `time=`/`speed=`, **throttle cập nhật UI tối đa 4 lần/giây** (tránh render spam).

### 5.4. Tối ưu UI
- Virtual scrolling cho mọi bảng dài; thumbnail lazy-load + cache đĩa (resize về 160px, WebP).
- Không setState theo từng dòng log; gom batch bằng `requestAnimationFrame`.
- Tránh re-render toàn bảng: state theo từng task id (Zustand selector / memo).
- Đồng hồ CPU/RAM ở status bar poll 2s, chạy ở backend, không dùng thư viện nặng.

### 5.5. Tối ưu I/O & bộ nhớ
- Ghi file tạm vào cùng ổ đĩa với thư mục đích (tránh copy chéo ổ).
- yt-dlp: bật `--concurrent-fragments 4` cho video HLS/DASH để tăng tốc tải.
- Metadata danh sách lưu SQLite (hoặc JSON ghi nợ/debounce 1s), không ghi đĩa mỗi lần progress thay đổi.
- Giới hạn buffer log trong RAM 500 dòng/task, phần cũ đẩy xuống file.

### 5.6. Khởi động & đóng gói
- Lazy-load từng module: chỉ mount UI của tab đang mở.
- Tauri: build release + strip symbols; Electron: bật `v8 snapshot`, tắt DevTools ở production, dùng `asar`.
- Mục tiêu: khởi động < 1.5s, RAM idle < 120MB (Electron) / < 80MB (Tauri).

---

## 6. CẤU TRÚC THƯ MỤC DỰ ÁN (gợi ý — Tauri)

```
video-toolkit/
├── src/                      # Frontend React
│   ├── modules/
│   │   ├── super-live/
│   │   ├── basic-live/
│   │   ├── render/
│   │   ├── intro-outro-logo/
│   │   ├── split/
│   │   ├── trim/
│   │   ├── green-screen/
│   │   ├── loop/
│   │   ├── concat/
│   │   └── downloader/
│   ├── components/           # Sidebar, Header, StatusBar, TaskTable...
│   ├── store/                # Zustand stores
│   └── i18n/                 # vi.json, en.json
├── src-tauri/
│   ├── src/
│   │   ├── task_queue.rs
│   │   ├── process_manager.rs
│   │   ├── progress_parser.rs
│   │   ├── hardware.rs
│   │   └── commands/         # Tauri commands theo module
│   └── bin/                  # ffmpeg, ffprobe, yt-dlp
└── SPEC.md                   # (chính là file này)
```

---

## 7. LỘ TRÌNH PHÁT TRIỂN

| Giai đoạn | Nội dung | Ưu tiên |
|---|---|---|
| Phase 1 | Khung app: layout, sidebar, TaskQueue, ProcessManager, KILL ALL, dò GPU | ⭐⭐⭐ |
| Phase 2 | **Tải Video** (module đầy đủ như ảnh) + Cắt ngắn + Cắt chia nhỏ | ⭐⭐⭐ |
| Phase 3 | Render H264/H265 + Ghép nối + Lặp lại | ⭐⭐ |
| Phase 4 | Basic Live Stream → Super Live Stream (multi-stream, hẹn giờ) | ⭐⭐ |
| Phase 5 | Chèn Intro/Outro/Logo + Phông Xanh (có preview) | ⭐ |
| Phase 6 | License/HSD, kiểm tra cập nhật, i18n, đóng gói installer | ⭐ |

---

## 8. TIÊU CHÍ NGHIỆM THU

- [ ] UI không đơ khi chạy đồng thời 5 render + 2 download.
- [ ] Cắt video 1GB bằng chế độ copy hoàn tất < 5 giây.
- [ ] KILL ALL FFMPEG dừng 100% tiến trình trong < 2 giây, không còn process mồ côi.
- [ ] Tải playlist 50 video: danh sách hiển thị mượt, progress realtime, resume được khi mở lại app.
- [ ] Máy có GPU NVIDIA tự động dùng NVENC (kiểm chứng qua log lệnh FFmpeg).
- [ ] RAM idle đạt mục tiêu ở Mục 5.6.

---

*Lưu ý pháp lý: chức năng tải video chỉ nên dùng cho nội dung bạn có quyền tải (video của chính bạn, nội dung được cấp phép). Cần hiển thị cảnh báo điều khoản sử dụng trong app.*
