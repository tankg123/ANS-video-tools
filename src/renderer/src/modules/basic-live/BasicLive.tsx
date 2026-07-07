import { useEffect, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { MediaInfo } from '@shared/types'
import type { BasicLiveEncoder, BasicLiveStartPayload } from '@shared/modules/basic-live'
import { fmtBytes, secToHms } from '@shared/time'
import { invoke, kvGet, kvSet, probe } from '../../api'
import { Check, Field, Select } from '../../components/Field'
import { FileDrop } from '../../components/FileDrop'
import { StatusChip } from '../../components/StatusChip'
import { TaskTable } from '../../components/TaskTable'
import { useT } from '../../i18n'
import { useTask, useTasks } from '../../store/tasks'
import { useUi } from '../../store/ui'

interface SavedForm {
  rtmpUrl?: string
  streamKey?: string
  loop?: boolean
  encoder?: BasicLiveEncoder
  bitrate?: string
}

const BITRATES = ['2500k', '4000k', '6000k', '8000k'] as const

/** ids các task basic-live đang chạy/chờ (mới nhất cuối) */
function useActiveLiveIds(): string[] {
  return useTasks(
    useShallow((s) =>
      s.order.filter((id) => {
        const tk = s.byId[id]
        return !!tk && tk.type === 'basic-live' && (tk.status === 'running' || tk.status === 'queued')
      })
    )
  )
}

/**
 * Module Basic Live Stream (spec 4.2):
 * 1 nguồn video → 1 RTMP đích. Copy H264+AAC (~0% CPU) hoặc re-encode.
 */
export default function BasicLive(): React.JSX.Element {
  const t = useT()
  const pushToast = useUi((s) => s.pushToast)

  const [input, setInput] = useState('')
  const [info, setInfo] = useState<MediaInfo | null>(null)
  const [rtmpUrl, setRtmpUrl] = useState('')
  const [streamKey, setStreamKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [loop, setLoop] = useState(false)
  const [encoder, setEncoder] = useState<BasicLiveEncoder>('copy')
  const [bitrate, setBitrate] = useState<string>('4000k')
  const [busy, setBusy] = useState(false)

  const activeIds = useActiveLiveIds()
  const activeTask = useTask(activeIds[activeIds.length - 1] ?? '')

  // Nạp lại cấu hình đã lưu từ phiên trước
  useEffect(() => {
    void (async () => {
      try {
        const saved = await kvGet<SavedForm | null>('basic-live', 'form', null)
        if (!saved) return
        if (saved.rtmpUrl) setRtmpUrl(saved.rtmpUrl)
        if (saved.streamKey) setStreamKey(saved.streamKey)
        if (typeof saved.loop === 'boolean') setLoop(saved.loop)
        if (saved.encoder === 'copy' || saved.encoder === 'auto-hw' || saved.encoder === 'x264') {
          setEncoder(saved.encoder)
        }
        if (saved.bitrate && (BITRATES as readonly string[]).includes(saved.bitrate)) {
          setBitrate(saved.bitrate)
        }
      } catch {
        /* bỏ qua — dùng mặc định */
      }
    })()
  }, [])

  const pick = async (paths: string[]): Promise<void> => {
    const p = paths[0]
    if (!p) return
    setInput(p)
    try {
      setInfo(await probe(p))
    } catch {
      setInfo(null)
    }
  }

  const compatible = !!info && info.video?.codec === 'h264' && info.audio?.codec === 'aac'
  const mode: 'copy' | 're-encode' = encoder === 'copy' && compatible ? 'copy' : 're-encode'
  const copyWarning = !!input && encoder === 'copy' && !compatible
  const valid = !!input && /^rtmps?:\/\//i.test(rtmpUrl.trim()) && streamKey.trim() !== ''

  const run = async (): Promise<void> => {
    if (!valid) return
    setBusy(true)
    try {
      const payload: BasicLiveStartPayload = {
        input,
        rtmpUrl: rtmpUrl.trim(),
        streamKey: streamKey.trim(),
        loop,
        encoder,
        bitrate
      }
      await invoke<string>('mod:basic-live:start', payload)
      pushToast(
        'success',
        t('Đã bắt đầu phát — theo dõi trạng thái ở bảng bên dưới', 'Stream started — track status in the table below')
      )
      void kvSet('basic-live', 'form', {
        rtmpUrl: rtmpUrl.trim(),
        streamKey: streamKey.trim(),
        loop,
        encoder,
        bitrate
      } satisfies SavedForm)
    } catch {
      /* lỗi đã hiện toast từ invoke() */
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="page-title">{t('Live Stream cơ bản', 'Basic Live Stream')}</div>
      <div className="page-desc">
        {t(
          'Phát 1 file video lên 1 điểm RTMP (YouTube, Facebook...). Nguồn H264+AAC được copy trực tiếp — gần như không tốn CPU.',
          'Stream one video file to one RTMP endpoint (YouTube, Facebook...). H264+AAC sources are copied directly — near-zero CPU.'
        )}
      </div>

      <div className="card">
        <div className="card-title">{t('Nguồn video', 'Source video')}</div>
        {input ? (
          <>
            <div className="row wrap">
              <span className="ellipsis grow" title={input}>
                🎬 {input}
              </span>
              {info && (
                <span className="text-dim" style={{ fontSize: 12 }}>
                  {secToHms(info.durationSec)} · {info.video ? `${info.video.width}×${info.video.height}` : ''} ·{' '}
                  {(info.video?.codec ?? '?').toUpperCase()}+{(info.audio?.codec ?? '—').toUpperCase()} ·{' '}
                  {fmtBytes(info.sizeBytes)}
                </span>
              )}
              <button className="btn btn-sm" onClick={() => (setInput(''), setInfo(null))}>
                {t('Chọn lại', 'Change')}
              </button>
            </div>
            {copyWarning && (
              <div className="hint text-danger mt">
                ⚠️{' '}
                {info
                  ? t(
                      'File không phải H264+AAC — chế độ Copy không dùng được, sẽ tự re-encode khi phát.',
                      'File is not H264+AAC — Copy mode is unavailable, it will be re-encoded when streaming.'
                    )
                  : t(
                      'Không đọc được thông tin file — sẽ re-encode khi phát để đảm bảo tương thích.',
                      'Could not probe the file — it will be re-encoded when streaming to ensure compatibility.'
                    )}
              </div>
            )}
          </>
        ) : (
          <FileDrop multi={false} allowFolder={false} onFiles={(p) => void pick(p)} />
        )}
      </div>

      <div className="card">
        <div className="card-title">{t('Cấu hình phát', 'Stream settings')}</div>
        <div className="grid-2">
          <Field label="RTMP URL">
            <input
              className="input mono"
              value={rtmpUrl}
              placeholder="rtmp://a.rtmp.youtube.com/live2"
              onChange={(e) => setRtmpUrl(e.target.value)}
            />
          </Field>
          <Field label={t('Stream Key (khoá luồng)', 'Stream Key')}>
            <div className="input-row">
              <input
                className="input mono"
                type={showKey ? 'text' : 'password'}
                value={streamKey}
                placeholder="xxxx-xxxx-xxxx-xxxx"
                onChange={(e) => setStreamKey(e.target.value)}
              />
              <button
                className="btn"
                title={showKey ? t('Ẩn khoá', 'Hide key') : t('Hiện khoá', 'Show key')}
                onClick={() => setShowKey((v) => !v)}
              >
                {showKey ? '🙈' : '👁'}
              </button>
            </div>
          </Field>
        </div>
        <div className="grid-2">
          <Field label={t('Bộ mã hoá', 'Encoder')}>
            <Select<BasicLiveEncoder>
              value={encoder}
              onChange={setEncoder}
              options={[
                { value: 'copy', label: t('Copy — giữ nguyên codec (~0% CPU)', 'Copy — no re-encode (~0% CPU)') },
                { value: 'auto-hw', label: t('Tự động — GPU nếu có', 'Auto — GPU if available') },
                { value: 'x264', label: 'x264 (CPU)' }
              ]}
            />
          </Field>
          <Field
            label={t('Bitrate video (khi re-encode)', 'Video bitrate (when re-encoding)')}
            hint={mode === 'copy' ? t('Không dùng ở chế độ copy', 'Not used in copy mode') : undefined}
          >
            <Select<string>
              value={bitrate}
              onChange={setBitrate}
              disabled={mode === 'copy'}
              options={BITRATES.map((b) => ({ value: b, label: b.replace('k', ' kbps') }))}
            />
          </Field>
        </div>
        <Check
          checked={loop}
          onChange={setLoop}
          label={t('Phát lặp vô hạn (loop) — dừng bằng nút Dừng', 'Loop forever — stop via the Stop button')}
        />
        <div className="row mt wrap">
          <button className="btn btn-primary" disabled={!valid || busy} onClick={() => void run()}>
            🔴 {t('Bắt đầu phát', 'Start streaming')}
          </button>
          {valid && (
            <span className="hint">
              {mode === 'copy'
                ? t('Chế độ: copy (không re-encode)', 'Mode: copy (no re-encode)')
                : t('Chế độ: re-encode', 'Mode: re-encode')}
            </span>
          )}
          {activeTask && (
            <span className="row" style={{ gap: 8 }}>
              <StatusChip status={activeTask.status} />
              <span className="hint">
                {activeIds.length > 1
                  ? t(`Đang phát ${activeIds.length} luồng`, `${activeIds.length} streams live`)
                  : t('Đang phát trực tiếp', 'Streaming live')}{' '}
                — {t('dừng/xem log 📄 ở bảng bên dưới', 'stop / view log 📄 in the table below')}
              </span>
            </span>
          )}
        </div>
      </div>

      <TaskTable types={['basic-live']} />
    </div>
  )
}
