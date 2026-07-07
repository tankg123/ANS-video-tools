# CONTRACT — Hướng dẫn implement module (Video Toolkit AIO Pro)

Tài liệu này là **hợp đồng bắt buộc** cho agent implement từng module. Đọc kỹ trước khi viết code.

## 0. Nguyên tắc tối thượng

1. **CHỈ sửa/tạo các file được giao** (xem prompt). KHÔNG sửa file core, KHÔNG thêm dependency npm mới.
2. Mọi UI text: tiếng Việt mặc định + tiếng Anh, qua `useT()`: `t('Tiếng Việt', 'English')`.
3. Mọi việc nặng chạy trong main process qua TaskQueue — UI không bao giờ đơ.
4. Chạy `npx tsc --noEmit` trước khi kết thúc — **0 lỗi** trong file của bạn.
5. Tham chiếu pattern chuẩn: module **trim** (đã hoàn chỉnh):
   - `src/main/modules/trim.ts` — backend
   - `src/renderer/src/modules/trim/Trim.tsx` — frontend
   - `src/shared/modules/trim.ts` — kiểu payload IPC dùng chung

## 1. Cấu trúc file mỗi module

| File | Vai trò |
|---|---|
| `src/shared/modules/<key>.ts` | Kiểu payload/response IPC (KHÔNG import electron/node/react) |
| `src/main/modules/<key>.ts` | Backend: `export default function register(ctx: ModuleContext): void` — thay stub sẵn có |
| `src/renderer/src/modules/<dir>/<Name>.tsx` | Frontend: `export default function <Name>(): React.JSX.Element` — thay stub sẵn có |

Được phép tạo thêm file phụ **bên trong thư mục module của bạn** (component con, css riêng import từ tsx).

## 2. Backend — ModuleContext (`src/main/module-context.ts`)

```ts
ctx.handle('mod:<key>:<action>', async (payload) => result)  // đăng ký IPC, throw Error để báo lỗi về UI
ctx.send('mod:<key>:<event>', data)                          // push event về renderer
ctx.enqueueFfmpeg({ type: '<key>', title, args, durationSec?, pool?, outputPath?, meta? }) // → taskId
   // tự thêm '-hide_banner -nostdin -y'; durationSec để tính %; bỏ trống = indeterminate (-1)
   // pool: 'ffmpeg' (mặc định, render/cắt), 'live' (stream dài hạn)
ctx.enqueueYtdlp({ title, args, meta?, onLine?(line, api) }) // → taskId, pool 'download'
ctx.probe(path)            // Promise<MediaInfo> — duration/codec/resolution (xem @shared/types)
ctx.pickEncoder('h264'|'hevc') // Promise<string> — encoder tốt nhất theo settings + phần cứng đã dò
ctx.detectHardware()       // Promise<HwInfo>
ctx.resolveBin('ffmpeg'|'ffprobe'|'yt-dlp') // string | null
ctx.settings.all()         // AppSettings (outputDir, downloadDir, maxLive, ...)
ctx.kv('<key>')            // { get(k, def), set(k, v) } — persist bền vững (debounce 1s), dùng cho danh sách cần lưu
ctx.deriveOutput(input, suffix, outDir?, ext?) // sinh path output không ghi đè
ctx.scanVideoDir(dir)      // string[] file video đệ quy
ctx.writeTempFile(nearFile, name, content)    // ghi file tạm cùng ổ đĩa (concat list...)
ctx.concatEscape(path)     // escape path cho concat demuxer
ctx.queue                  // TaskQueue: .cancel(id), .get(id), .cancelPools([...])
ctx.pm                     // ProcessManager: .spawnManaged(bin, args, {onLine}), .killTree(pid)
```

**Quy ước ffmpeg args:** mảng string, KHÔNG tự quote path (spawn không qua shell). KHÔNG thêm `-y`/`-hide_banner` (enqueueFfmpeg tự thêm).

**Tối ưu bắt buộc (spec mục 5):**
- Ưu tiên `-c copy` khi không cần re-encode (cắt/ghép cùng codec/lặp/stream chuẩn H264+AAC). Dùng `ctx.probe()` để quyết định, ghi rõ chế độ vào `meta.mode` ('copy' | 're-encode') và hiện trên UI.
- Re-encode: dùng `ctx.pickEncoder()`. Với `libx264`: `-preset veryfast -crf <n>`; encoder phần cứng: `-cq <n>` hoặc `-b:v`.

**Task chạy dài không rõ tổng (livestream):** bỏ `durationSec` → progress -1 (indeterminate). UI hiển thị đồng hồ elapsed tự động trong TaskTable.

**Tự quản process ngoài queue (nếu thật sự cần, vd live stream có restart):** vẫn PHẢI dùng `ctx.pm.spawnManaged` (để KILL ALL và orphan-cleanup hoạt động) và nên bọc trong task pool 'live'.

## 3. Frontend — API renderer (`src/renderer/src/api.ts`)

```ts
import { invoke, probe, pickFiles, pickFolder, saveFile, statPath, scanDir,
         showInFolder, openPath, openExternal, kvGet, kvSet, readLog, pathForFile } from '../../api'
await invoke('mod:<key>:<action>', payload) // lỗi tự hiện toast đỏ rồi re-throw
```

Store & hooks:
```ts
import { useT } from '../../i18n'                 // t('VN','EN')
import { useUi } from '../../store/ui'            // pushToast('success'|'error'|'info', msg)
import { useSettings } from '../../store/settings'// s.settings (AppSettings), s.update(patch)
import { useTask, useTaskIdsByTypes } from '../../store/tasks' // subscribe task theo id
```

Component sẵn có (`src/renderer/src/components/`):
- `<TaskTable types={['<key>']} />` — bảng tác vụ đầy đủ (progress, log, dừng, mở thư mục, virtual scroll >50 dòng). **Mọi module xử lý đều nên đặt cuối trang.**
- `<FileDrop onFiles={paths => ...} multi allowFolder accept={filters} />` — kéo-thả file/thư mục
- `<Field label>`, `<Select value onChange options>`, `<NumInput>`, `<Check>`, `<FolderInput>`
- `<Modal title onClose actions wide>`, `<ProgressBar value>` (-1 = indeterminate), `<StatusChip status>`, `<LogModal taskId onClose>`
- Time helpers: `import { hmsToSec, secToHms, fmtBytes, fmtElapsed } from '@shared/time'`

## 4. CSS — dùng class sẵn có trong `src/renderer/src/styles/app.css`

`page-title, page-desc, card, card-title (+ .right), grid-2, grid-3, field, input, input-row,
btn (+ btn-primary/btn-danger/btn-success/btn-ghost/btn-sm/btn-icon), check, hint, dropzone,
table-wrap, table, ellipsis, progress, chip, badge, empty-state, row (+ .grow/.wrap), mt, mb,
text-dim, text-faint, text-success, text-danger, mono, thumb, spin`

Cần style riêng → tạo `<thư mục module>/styles.css` và `import './styles.css'` trong tsx. KHÔNG sửa app.css.

## 5. Layout trang chuẩn

```tsx
export default function <Name>(): React.JSX.Element {
  const t = useT()
  return (
    <div>
      <div className="page-title">{t('Tên module', 'Module name')}</div>
      <div className="page-desc">{t('Mô tả ngắn...', 'Short description...')}</div>
      <div className="card">...form/input...</div>
      <TaskTable types={['<key>']} />
    </div>
  )
}
```

## 6. Persist dữ liệu module

- Cần lưu qua phiên (danh sách download, cấu hình luồng live...): backend dùng `ctx.kv('<key>')`, hoặc renderer dùng `kvGet/kvSet(ns, key, value)`.
- State tạm trong phiên: `useState` hoặc store zustand riêng trong thư mục module.

## 7. Điều cấm kỵ

- ❌ Import trực tiếp `electron`, `child_process`, `fs`... trong renderer (chỉ main process được phép).
- ❌ Đăng ký channel không có prefix `mod:<key>:`.
- ❌ setState theo từng dòng log (spam render). Progress đã được throttle 4Hz ở main.
- ❌ Animation nặng, blur/shadow động.
- ❌ Sửa file ngoài danh sách được giao.

## 8. Danh sách file bị CẤM sửa (core, đã hoàn chỉnh)

`package.json, electron.vite.config.ts, tsconfig.json, src/shared/types.ts, src/shared/time.ts,
src/main/* (trừ src/main/modules/<key>.ts của bạn), src/preload/*,
src/renderer/index.html, src/renderer/src/{App.tsx, main.tsx, api.ts, env.d.ts},
src/renderer/src/{components,store,i18n,styles}/*, src/renderer/src/modules/registry.tsx`
