import { useEffect, useRef, useState } from 'react'
import type { MediaInfo } from '@shared/types'
import type {
  RenderAudioOpt,
  RenderCodec,
  RenderEncoderResult,
  RenderFpsOpt,
  RenderQualityMode,
  RenderResolution,
  RenderStartPayload,
  RenderStartResult
} from '@shared/modules/render'
import { fmtBytes, secToHms } from '@shared/time'
import { invoke, invokeSilent } from '../../api'
import { Field, NumInput, Select } from '../../components/Field'
import { FileDrop } from '../../components/FileDrop'
import { TaskTable } from '../../components/TaskTable'
import { useT } from '../../i18n'
import { useSettings } from '../../store/settings'
import { useUi } from '../../store/ui'

interface Item {
  path: string
  info?: MediaInfo
  error?: boolean
}

const baseName = (p: string): string => p.split(/[\\/]/).pop() ?? p

function encoderBadge(enc: string): string {
  if (!enc) return '…'
  if (enc.includes('nvenc')) return 'NVENC ✅'
  if (enc.includes('qsv')) return 'Intel QSV ✅'
  if (enc.includes('amf')) return 'AMD AMF ✅'
  return 'CPU 🖥️'
}

/** Module Render H264/H265 (spec 4.3) — render hàng loạt qua TaskQueue. */
export default function Render(): React.JSX.Element {
  const t = useT()
  const pushToast = useUi((s) => s.pushToast)
  const outputDir = useSettings((s) => s.settings?.outputDir ?? '')

  const [items, setItems] = useState<Item[]>([])
  const known = useRef<Set<string>>(new Set())

  const [codec, setCodec] = useState<RenderCodec>('h264')
  const [encoder, setEncoder] = useState('')
  const [qualityMode, setQualityMode] = useState<RenderQualityMode>('crf')
  const [crf, setCrf] = useState(23)
  const [bitrateMbps, setBitrateMbps] = useState(8)
  const [preset, setPreset] = useState('veryfast')
  const [resolution, setResolution] = useState<RenderResolution>('keep')
  const [fps, setFps] = useState<RenderFpsOpt>('keep')
  const [audio, setAudio] = useState<RenderAudioOpt>('copy')
  const [busy, setBusy] = useState(false)

  // Dò encoder sẽ dùng mỗi khi đổi codec (hiển thị 'NVENC ✅'...)
  useEffect(() => {
    let alive = true
    setEncoder('')
    invokeSilent<RenderEncoderResult>('mod:render:encoder', { codec })
      .then((r) => {
        if (alive) setEncoder(r.encoder)
      })
      .catch(() => {
        if (alive) setEncoder(codec === 'hevc' ? 'libx265' : 'libx264')
      })
    return () => {
      alive = false
    }
  }, [codec])

  const isNvenc = encoder.includes('nvenc')
  const isSw = encoder === 'libx264' || encoder === 'libx265' || encoder === ''
  const encFamily = isNvenc ? 'nvenc' : isSw ? 'sw' : 'other'

  // Reset preset mặc định theo họ encoder (nvenc: p4, libx264/x265: veryfast)
  useEffect(() => {
    if (encFamily === 'nvenc') setPreset('p4')
    else if (encFamily === 'sw') setPreset('veryfast')
    else setPreset('')
  }, [encFamily])

  const addFiles = async (paths: string[]): Promise<void> => {
    const fresh = paths.filter((p) => p && !known.current.has(p))
    if (!fresh.length) return
    for (const p of fresh) known.current.add(p)
    setItems((prev) => [...prev, ...fresh.map((p) => ({ path: p }))])
    for (const p of fresh) {
      try {
        const info = await invokeSilent<MediaInfo>('core:probe', { path: p })
        setItems((prev) => prev.map((it) => (it.path === p ? { ...it, info } : it)))
      } catch {
        setItems((prev) => prev.map((it) => (it.path === p ? { ...it, error: true } : it)))
      }
    }
  }

  const removeItem = (p: string): void => {
    known.current.delete(p)
    setItems((prev) => prev.filter((it) => it.path !== p))
  }

  const clearAll = (): void => {
    known.current.clear()
    setItems([])
  }

  const totalSec = items.reduce((s, it) => s + (it.info?.durationSec ?? 0), 0)

  const run = async (): Promise<void> => {
    if (!items.length || busy) return
    setBusy(true)
    try {
      const payload: RenderStartPayload = {
        inputs: items.map((it) => it.path),
        options: { codec, qualityMode, crf, bitrateMbps, preset, resolution, fps, audio, outputDir }
      }
      const res = await invoke<RenderStartResult>('mod:render:start', payload)
      pushToast(
        'success',
        t(`Đã thêm ${res.taskIds.length} tác vụ render vào hàng đợi`, `Queued ${res.taskIds.length} render task(s)`)
      )
      if (res.skipped.length) {
        pushToast(
          'error',
          t(`${res.skipped.length} file không đọc được, đã bỏ qua`, `${res.skipped.length} unreadable file(s) skipped`)
        )
      }
    } finally {
      setBusy(false)
    }
  }

  const presetOptions: { value: string; label: string }[] =
    encFamily === 'nvenc'
      ? ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'].map((p) => ({
          value: p,
          label: p === 'p1' ? `p1 (${t('nhanh nhất', 'fastest')})` : p === 'p7' ? `p7 (${t('chất lượng cao nhất', 'best quality')})` : p === 'p4' ? `p4 (${t('mặc định', 'default')})` : p
        }))
      : ['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow'].map((p) => ({
          value: p,
          label: p === 'veryfast' ? `veryfast (${t('khuyên dùng', 'recommended')})` : p
        }))

  const resOptions: { value: RenderResolution; label: string }[] = [
    { value: 'keep', label: t('Giữ nguyên', 'Keep original') },
    { value: 2160, label: '2160p (4K)' },
    { value: 1440, label: '1440p (2K)' },
    { value: 1080, label: '1080p (Full HD)' },
    { value: 720, label: '720p (HD)' },
    { value: 480, label: '480p (SD)' }
  ]

  const fpsOptions: { value: RenderFpsOpt; label: string }[] = [
    { value: 'keep', label: t('Giữ nguyên', 'Keep original') },
    { value: 24, label: '24 fps' },
    { value: 30, label: '30 fps' },
    { value: 60, label: '60 fps' }
  ]

  return (
    <div>
      <div className="page-title">{t('Render H264/H265', 'Render H264/H265')}</div>
      <div className="page-desc">
        {t(
          'Render hàng loạt video sang H.264/H.265 (MP4). Tự dò encoder phần cứng (NVENC/QSV/AMF) để tăng tốc, mỗi file là một tác vụ trong hàng đợi.',
          'Batch render videos to H.264/H.265 (MP4). Hardware encoder (NVENC/QSV/AMF) is auto-detected for speed; each file becomes one queued task.'
        )}
      </div>

      <div className="card">
        <div className="card-title">
          {t('Danh sách file', 'File list')} <span className="badge">{items.length}</span>
          {items.length > 0 && (
            <span className="right">
              <span className="text-dim" style={{ fontSize: 12, marginRight: 8 }}>
                {t('Tổng thời lượng', 'Total duration')}: {secToHms(Math.round(totalSec))}
              </span>
              <button className="btn btn-sm btn-danger" onClick={clearAll}>
                {t('Xoá hết', 'Clear all')}
              </button>
            </span>
          )}
        </div>

        {items.length > 0 && (
          <div className="table-wrap mb" style={{ maxHeight: 260 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>{t('Tên file', 'File name')}</th>
                  <th>{t('Thời lượng', 'Duration')}</th>
                  <th>{t('Codec hiện tại', 'Current codec')}</th>
                  <th>{t('Độ phân giải', 'Resolution')}</th>
                  <th>{t('Dung lượng', 'Size')}</th>
                  <th style={{ textAlign: 'right' }}></th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.path}>
                    <td className="ellipsis" style={{ maxWidth: 300 }} title={it.path}>
                      🎬 {baseName(it.path)}
                    </td>
                    <td className="mono">
                      {it.info ? secToHms(it.info.durationSec) : it.error ? '—' : <span className="text-faint">…</span>}
                    </td>
                    <td>
                      {it.info?.video ? (
                        it.info.video.codec.toUpperCase()
                      ) : it.error ? (
                        <span className="text-danger">{t('Lỗi đọc file', 'Unreadable')}</span>
                      ) : (
                        ''
                      )}
                    </td>
                    <td className="text-dim">{it.info?.video ? `${it.info.video.width}×${it.info.video.height}` : ''}</td>
                    <td className="text-dim">{it.info ? fmtBytes(it.info.sizeBytes) : ''}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        className="btn btn-sm btn-ghost"
                        title={t('Xoá khỏi danh sách', 'Remove from list')}
                        onClick={() => removeItem(it.path)}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <FileDrop multi allowFolder onFiles={(p) => void addFiles(p)} />
      </div>

      <div className="card">
        <div className="card-title">
          {t('Tuỳ chọn render', 'Render options')}
          <span className="right text-dim" style={{ fontSize: 12 }}>
            Encoder: <b>{encoderBadge(encoder)}</b>{' '}
            {encoder && <span className="mono">({encoder})</span>}
          </span>
        </div>

        <div className="grid-3">
          <Field label={t('Codec', 'Codec')}>
            <Select<RenderCodec>
              value={codec}
              onChange={setCodec}
              options={[
                { value: 'h264', label: 'H.264 (AVC)' },
                { value: 'hevc', label: 'H.265 (HEVC)' }
              ]}
            />
          </Field>

          <Field label={t('Chế độ chất lượng', 'Quality mode')}>
            <Select<RenderQualityMode>
              value={qualityMode}
              onChange={setQualityMode}
              options={[
                { value: 'crf', label: t('CRF (chất lượng cố định)', 'CRF (constant quality)') },
                { value: 'bitrate', label: t('Bitrate (Mbps)', 'Bitrate (Mbps)') }
              ]}
            />
          </Field>

          {qualityMode === 'crf' ? (
            <Field
              label={t('CRF (0-51, thấp = đẹp hơn)', 'CRF (0-51, lower = better)')}
              hint={t('Mặc định 23', 'Default 23')}
            >
              <NumInput value={crf} onChange={setCrf} min={0} max={51} step={1} />
            </Field>
          ) : (
            <Field label={t('Bitrate video (Mbps)', 'Video bitrate (Mbps)')}>
              <NumInput value={bitrateMbps} onChange={setBitrateMbps} min={0.5} max={200} step={0.5} />
            </Field>
          )}

          <Field label={t('Preset', 'Preset')}>
            {encFamily === 'other' ? (
              <input className="input" value={t('Mặc định của encoder', 'Encoder default')} disabled readOnly />
            ) : (
              <Select<string> value={preset} onChange={setPreset} options={presetOptions} />
            )}
          </Field>

          <Field label={t('Độ phân giải', 'Resolution')}>
            <Select<RenderResolution> value={resolution} onChange={setResolution} options={resOptions} />
          </Field>

          <Field label="FPS">
            <Select<RenderFpsOpt> value={fps} onChange={setFps} options={fpsOptions} />
          </Field>

          <Field label={t('Âm thanh', 'Audio')}>
            <Select<RenderAudioOpt>
              value={audio}
              onChange={setAudio}
              options={[
                { value: 'copy', label: t('Copy (giữ nguyên)', 'Copy (keep original)') },
                { value: 'aac192', label: 'AAC 192 kbps' }
              ]}
            />
          </Field>
        </div>

        <div className="row mt">
          <button className="btn btn-primary" disabled={!items.length || busy} onClick={() => void run()}>
            🎞️ {t('Bắt đầu render', 'Start render')}
          </button>
          <span className="hint">
            {t('Chế độ', 'Mode')}: re-encode ·{' '}
            {items.length > 0
              ? t(`${items.length} file → hàng đợi`, `${items.length} file(s) → queue`)
              : t('Thêm file để bắt đầu', 'Add files to start')}{' '}
            · {t('Xuất MP4', 'Output MP4')}
            {outputDir
              ? ` → ${outputDir}`
              : ` (${t('cùng thư mục file gốc', 'same folder as source')})`}
          </span>
        </div>
      </div>

      <TaskTable types={['render']} />
    </div>
  )
}
