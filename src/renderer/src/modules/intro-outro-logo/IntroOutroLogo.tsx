import { useState } from 'react'
import type { IntroOutroLogoStartPayload, LogoPosition } from '@shared/modules/intro-outro-logo'
import { invoke, pickFiles } from '../../api'
import { Field, NumInput, Select } from '../../components/Field'
import { FileDrop } from '../../components/FileDrop'
import { TaskTable } from '../../components/TaskTable'
import { useT } from '../../i18n'
import { useSettings } from '../../store/settings'
import { useUi } from '../../store/ui'

const VIDEO_FILTER = [
  { name: 'Video', extensions: ['mp4', 'mkv', 'mov', 'avi', 'webm', 'm4v', 'ts', 'flv', 'wmv'] }
]
const PNG_FILTER = [{ name: 'PNG', extensions: ['png'] }]

/** Ô chọn 1 file lẻ (intro/outro/logo) với nút Browse + Xoá */
function FilePick({
  value,
  onChange,
  filters,
  placeholder
}: {
  value: string
  onChange: (v: string) => void
  filters: { name: string; extensions: string[] }[]
  placeholder: string
}): React.JSX.Element {
  const t = useT()
  return (
    <div className="input-row">
      <input
        className="input"
        value={value}
        placeholder={placeholder}
        title={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        className="btn"
        onClick={async () => {
          const paths = await pickFiles({ multi: false, filters })
          if (paths[0]) onChange(paths[0])
        }}
      >
        {t('Chọn...', 'Browse...')}
      </button>
      {value && (
        <button className="btn btn-ghost" title={t('Bỏ chọn', 'Clear')} onClick={() => onChange('')}>
          ✕
        </button>
      )}
    </div>
  )
}

/** Module Chèn Intro / Outro / Logo (spec 4.4) — xử lý hàng loạt video chính. */
export default function IntroOutroLogo(): React.JSX.Element {
  const t = useT()
  const pushToast = useUi((s) => s.pushToast)
  const outputDir = useSettings((s) => s.settings?.outputDir ?? '')

  const [files, setFiles] = useState<string[]>([])
  const [intro, setIntro] = useState('')
  const [outro, setOutro] = useState('')
  const [logo, setLogo] = useState('')

  const [position, setPosition] = useState<LogoPosition>('br')
  const [widthPct, setWidthPct] = useState(15)
  const [opacityPct, setOpacityPct] = useState(100)
  const [timing, setTiming] = useState<'full' | 'range'>('full')
  const [fromSec, setFromSec] = useState(0)
  const [toSec, setToSec] = useState(10)
  const [busy, setBusy] = useState(false)

  const addFiles = (paths: string[]): void =>
    setFiles((prev) => Array.from(new Set([...prev, ...paths])))

  const hasAny = !!intro || !!outro || !!logo
  const timingValid = !logo || timing === 'full' || toSec > fromSec
  const valid = files.length > 0 && hasAny && timingValid

  const run = async (): Promise<void> => {
    if (!valid) return
    setBusy(true)
    try {
      const payload: IntroOutroLogoStartPayload = {
        inputs: files,
        intro: intro || undefined,
        outro: outro || undefined,
        logo: logo
          ? {
              path: logo,
              position,
              widthPct,
              opacityPct,
              fullDuration: timing === 'full',
              startSec: fromSec,
              endSec: toSec
            }
          : undefined,
        outputDir
      }
      const ids = await invoke<string[]>('mod:intro-outro-logo:start', payload)
      pushToast(
        'success',
        t(`Đã thêm ${ids.length} tác vụ vào hàng đợi`, `Added ${ids.length} task(s) to queue`)
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="page-title">{t('Chèn Intro / Outro / Logo', 'Intro / Outro / Logo')}</div>
      <div className="page-desc">
        {t(
          'Ghép intro/outro và đóng logo PNG lên hàng loạt video. Intro/outro tự động scale về đúng độ phân giải video chính.',
          'Batch-concat intro/outro and stamp a PNG logo onto videos. Intro/outro are auto-scaled to the main video resolution.'
        )}
      </div>

      <div className="card">
        <div className="card-title">{t('Video chính (hàng loạt)', 'Main videos (batch)')}</div>
        <FileDrop multi onFiles={addFiles} accept={VIDEO_FILTER} />
        {files.length > 0 && (
          <div className="mt">
            <div className="row">
              <span className="text-dim">
                {t(`${files.length} video đã chọn`, `${files.length} video(s) selected`)}
              </span>
              <span className="grow" />
              <button className="btn btn-sm btn-ghost" onClick={() => setFiles([])}>
                {t('Xoá hết', 'Clear all')}
              </button>
            </div>
            <div className="mt" style={{ maxHeight: 180, overflowY: 'auto' }}>
              {files.map((f) => (
                <div className="row" key={f}>
                  <span className="ellipsis grow" title={f}>
                    🎬 {f}
                  </span>
                  <button
                    className="btn btn-sm btn-icon"
                    title={t('Bỏ file này', 'Remove this file')}
                    onClick={() => setFiles((prev) => prev.filter((x) => x !== f))}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-title">{t('Intro / Outro / Logo (tuỳ chọn)', 'Intro / Outro / Logo (optional)')}</div>
        <div className="grid-3">
          <Field label={t('File intro (ghép vào đầu)', 'Intro file (prepended)')}>
            <FilePick
              value={intro}
              onChange={setIntro}
              filters={VIDEO_FILTER}
              placeholder={t('Không dùng intro', 'No intro')}
            />
          </Field>
          <Field label={t('File outro (ghép vào cuối)', 'Outro file (appended)')}>
            <FilePick
              value={outro}
              onChange={setOutro}
              filters={VIDEO_FILTER}
              placeholder={t('Không dùng outro', 'No outro')}
            />
          </Field>
          <Field label={t('Logo PNG trong suốt', 'Transparent PNG logo')}>
            <FilePick
              value={logo}
              onChange={setLogo}
              filters={PNG_FILTER}
              placeholder={t('Không dùng logo', 'No logo')}
            />
          </Field>
        </div>
        <span className="hint">
          {t(
            'Intro/outro cần có cả hình và tiếng (audio) để ghép được với video chính.',
            'Intro/outro must contain both video and audio to be concatenated.'
          )}
        </span>
      </div>

      {logo && (
        <div className="card">
          <div className="card-title">{t('Thiết lập logo', 'Logo settings')}</div>
          <div className="grid-3">
            <Field label={t('Vị trí', 'Position')}>
              <Select<LogoPosition>
                value={position}
                onChange={setPosition}
                options={[
                  { value: 'tl', label: t('Góc trên trái', 'Top-left') },
                  { value: 'tr', label: t('Góc trên phải', 'Top-right') },
                  { value: 'bl', label: t('Góc dưới trái', 'Bottom-left') },
                  { value: 'br', label: t('Góc dưới phải', 'Bottom-right') },
                  { value: 'center', label: t('Chính giữa', 'Center') }
                ]}
              />
            </Field>
            <Field label={t('Kích thước (% bề rộng video)', 'Size (% of video width)')}>
              <NumInput value={widthPct} onChange={setWidthPct} min={1} max={100} step={1} />
            </Field>
            <Field label={t('Độ mờ (%)', 'Opacity (%)')}>
              <NumInput value={opacityPct} onChange={setOpacityPct} min={0} max={100} step={5} />
            </Field>
          </div>
          <div className="row wrap mt">
            <label className="check">
              <input
                type="radio"
                name="iol-timing"
                checked={timing === 'full'}
                onChange={() => setTiming('full')}
              />
              {t('Hiển thị toàn bộ video', 'Show for entire video')}
            </label>
            <label className="check">
              <input
                type="radio"
                name="iol-timing"
                checked={timing === 'range'}
                onChange={() => setTiming('range')}
              />
              {t('Chỉ hiển thị trong khoảng', 'Show only within range')}
            </label>
            {timing === 'range' && (
              <>
                <span className="text-dim">{t('Từ giây', 'From second')}</span>
                <div style={{ width: 110 }}>
                  <NumInput value={fromSec} onChange={setFromSec} min={0} step={1} />
                </div>
                <span className="text-dim">{t('đến giây', 'to second')}</span>
                <div style={{ width: 110 }}>
                  <NumInput value={toSec} onChange={setToSec} min={0} step={1} />
                </div>
              </>
            )}
          </div>
          {!timingValid && (
            <span className="hint text-danger">
              {t('Giây kết thúc phải lớn hơn giây bắt đầu', 'End second must be greater than start second')}
            </span>
          )}
        </div>
      )}

      <div className="card">
        <div className="row wrap">
          <button className="btn btn-primary" disabled={!valid || busy} onClick={() => void run()}>
            🏷️ {t('Bắt đầu hàng loạt', 'Start batch')}
          </button>
          <span className="hint">
            {files.length > 0
              ? t(`${files.length} video sẽ được xử lý · `, `${files.length} video(s) will be processed · `)
              : ''}
            {t('chế độ re-encode (overlay/concat bắt buộc render lại)', 're-encode mode (overlay/concat requires re-rendering)')}
          </span>
        </div>
      </div>

      <TaskTable types={['intro-outro-logo']} />
    </div>
  )
}
