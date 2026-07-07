import path from 'node:path'
import type { ModuleContext } from '../module-context'
import type { BasicLiveStartPayload } from '@shared/modules/basic-live'

/**
 * Module Basic Live Stream (spec 4.2):
 * - 1 nguồn video → 1 đích RTMP, tuỳ chọn loop vô hạn.
 * - Nguồn H264+AAC + encoder 'copy' (mặc định) → '-c copy' (CPU ~0%); ngược lại re-encode.
 * - Task pool 'live', không durationSec → progress indeterminate (TaskTable hiện elapsed).
 * - Stop = nút Dừng trong TaskTable (cancel task → kill process tree).
 */
export default function register(ctx: ModuleContext): void {
  ctx.handle('mod:basic-live:start', async (p: BasicLiveStartPayload) => {
    if (!p?.input) throw new Error('Chưa chọn file video nguồn')
    const rtmpUrl = (p.rtmpUrl ?? '').trim()
    const streamKey = (p.streamKey ?? '').trim()
    if (!/^rtmps?:\/\//i.test(rtmpUrl)) {
      throw new Error('RTMP URL không hợp lệ — phải bắt đầu bằng rtmp:// hoặc rtmps://')
    }
    if (!streamKey) throw new Error('Chưa nhập Stream Key')

    // URL đích = rtmpUrl (bỏ '/' thừa cuối) + '/' + streamKey
    const dest = rtmpUrl.replace(/\/+$/, '') + '/' + streamKey

    // Probe nguồn để quyết định copy hay re-encode
    const info = await ctx.probe(p.input)
    if (!info.video) throw new Error('File nguồn không có luồng video')
    const compatible = info.video.codec === 'h264' && info.audio?.codec === 'aac'

    let codecArgs: string[]
    let mode: 'copy' | 're-encode'
    if (p.encoder === 'copy' && compatible) {
      codecArgs = ['-c', 'copy']
      mode = 'copy'
    } else {
      const enc = p.encoder === 'x264' ? 'libx264' : await ctx.pickEncoder('h264')
      const kbps = parseInt(p.bitrate, 10)
      const k = Number.isFinite(kbps) && kbps > 0 ? kbps : 4000
      const bitrate = `${k}k`
      const bufsize = `${k * 2}k`
      codecArgs = [
        '-c:v', enc,
        // '-preset veryfast' chỉ hợp lệ với libx264 — nvenc/amf sẽ lỗi nếu nhận preset này
        ...(enc === 'libx264' ? ['-preset', 'veryfast'] : []),
        '-b:v', bitrate,
        '-maxrate', bitrate,
        '-bufsize', bufsize,
        // Ép 8-bit 4:2:0 — nguồn 10-bit/4:2:2 sẽ fail trên NVENC hoặc ra High10 bị RTMP từ chối
        '-pix_fmt', 'yuv420p',
        '-g', '60',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-ar', '44100'
      ]
      mode = 're-encode'
    }

    // '-re' BẮT BUỘC trước -i (đọc realtime); '-stream_loop -1' cũng phải trước -i
    const args = [
      '-re',
      ...(p.loop ? ['-stream_loop', '-1'] : []),
      '-i', p.input,
      ...codecArgs,
      '-f', 'flv',
      dest
    ]

    // Tiêu đề không lộ stream key — chỉ hiện host đích
    let host = rtmpUrl
    try {
      host = new URL(rtmpUrl).host || rtmpUrl
    } catch {
      /* giữ nguyên rtmpUrl nếu không parse được */
    }

    return ctx.enqueueFfmpeg({
      type: 'basic-live',
      title: `Live: ${path.basename(p.input)} → ${host}`,
      args,
      pool: 'live',
      // KHÔNG durationSec → progress -1 (indeterminate)
      meta: { mode, host, loop: p.loop, encoder: p.encoder }
    })
  })
}
