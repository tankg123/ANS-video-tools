import { useState } from 'react'
import type { MediaInfo } from '@shared/types'
import type {
  GreenScreenParams,
  GreenScreenPreviewPayload,
  GreenScreenStartPayload,
  GsPosition
} from '@shared/modules/green-screen'
import { fmtBytes, secToHms } from '@shared/time'
import { invoke, probe } from '../../api'
import { Field, NumInput, Select } from '../../components/Field'
import { FileDrop } from '../../components/FileDrop'
import { TaskTable } from '../../components/TaskTable'
import { useT } from '../../i18n'
import { useSettings } from '../../store/settings'
import { useUi } from '../../store/ui'

const VIDEO_FILTER = { name: 'Video', extensions: ['mp4', 'mkv', 'mov', 'avi', 'webm', 'flv', 'ts', 'm4v', 'wmv'] }
const OVERLAY_FILTER = {
  name: 'Video / Ảnh',
  extensions: ['mp4', 'mkv', 'mov', 'avi', 'webm', 'flv', 'ts', 'm4v', 'wmv', 'png', 'jpg', 'jpeg', 'webp', 'bmp']
}

const isImagePath = (p: string): boolean => /\.(png|jpe?g|webp|bmp|tiff?)$/i.test(p)

/** Ô hiển thị file đã chọn + thông tin probe + nút chọn lại */
function PickedFile({
  path,
  info,
  icon,
  onClear
}: {
  path: string
  info: MediaInfo | null
  icon: string
  onClear: () => void
}): React.JSX.Element {
  const t = useT()
  return (
    <div className="row wrap">
      <span className="ellipsis grow" title={path}>
        {icon} {path}
      </span>
      {info && (
        <span className="text-dim" style={{ fontSize: 12 }}>
          {info.durationSec > 0 ? `${secToHms(info.durationSec)} · ` : ''}
          {info.video ? `${info.video.width}×${info.video.height} · ` : ''}
          {fmtBytes(info.sizeBytes)}
        </span>
      )}
      <button className="btn btn-sm" onClick={onClear}>
        {t('Chọn lại', 'Change')}
      </button>
    </div>
  )
}

/**
 * Module Chèn Phông Xanh (spec 4.7):
 * video nền + video/ảnh phông xanh → chromakey → overlay, có preview 1 frame.
 */
export default function GreenScreen(): React.JSX.Element {
  const t = useT()
  const pushToast = useUi((s) => s.pushToast)
  const outputDir = useSettings((s) => s.settings?.outputDir ?? '')

  const [bg, setBg] = useState('')
  const [bgInfo, setBgInfo] = useState<MediaInfo | null>(null)
  const [ov, setOv] = useState('')
  const [ovInfo, setOvInfo] = useState<MediaInfo | null>(null)

  const [keyColor, setKeyColor] = useState('#00ff00')
  const [similarity, setSimilarity] = useState(0.3)
  const [blend, setBlend] = useState(0.1)
  const [position, setPosition] = useState<GsPosition>('center')
  const [sizePct, setSizePct] = useState(100)
  const [customX, setCustomX] = useState(0)
  const [customY, setCustomY] = useState(0)

  const [atSec, setAtSec] = useState(0)
  const [previewUrl, setPreviewUrl] = useState('')
  const [previewBusy, setPreviewBusy] = useState(false)
  const [busy, setBusy] = useState(false)

  const pickBg = async (paths: string[]): Promise<void> => {
    const p = paths[0]
    if (!p) return
    setBg(p)
    setPreviewUrl('')
    try {
      const i = await probe(p)
      setBgInfo(i)
      setAtSec(Math.min(1, Math.floor(i.durationSec)))
    } catch {
      setBgInfo(null)
    }
  }

  const pickOv = async (paths: string[]): Promise<void> => {
    const p = paths[0]
    if (!p) return
    setOv(p)
    setPreviewUrl('')
    try {
      setOvInfo(await probe(p))
    } catch {
      setOvInfo(null)
    }
  }

  const valid = !!bg && !!ov && sizePct > 0
  const ovIsImage = isImagePath(ov)

  const params: GreenScreenParams = {
    background: bg,
    overlay: ov,
    keyColor,
    similarity,
    blend,
    position,
    sizePct,
    customX,
    customY
  }

  const doPreview = async (): Promise<void> => {
    if (!valid || previewBusy) return
    setPreviewBusy(true)
    try {
      const payload: GreenScreenPreviewPayload = { ...params, atSec }
      const url = await invoke<string>('mod:green-screen:preview', payload)
      setPreviewUrl(url)
    } catch {
      /* invoke đã hiện toast lỗi */
    } finally {
      setPreviewBusy(false)
    }
  }

  const run = async (): Promise<void> => {
    if (!valid || busy) return
    setBusy(true)
    try {
      const payload: GreenScreenStartPayload = { ...params, outputDir }
      await invoke<string>('mod:green-screen:start', payload)
      pushToast('success', t('Đã thêm vào hàng đợi', 'Added to queue'))
    } catch {
      /* invoke đã hiện toast lỗi */
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="page-title">{t('Chèn Phông Xanh', 'Green Screen')}</div>
      <div className="page-desc">
        {t(
          'Chèn video/ảnh có phông xanh lên video nền bằng chromakey. Xem thử 1 frame để tinh chỉnh màu key trước khi render.',
          'Composite a green-screen video/image onto a background video via chromakey. Preview one frame to tune the key color before rendering.'
        )}
      </div>

      <div className="card">
        <div className="card-title">{t('Nguồn', 'Sources')}</div>
        <div className="grid-2">
          <Field label={t('Video nền', 'Background video')}>
            {bg ? (
              <PickedFile path={bg} info={bgInfo} icon="🎬" onClear={() => (setBg(''), setBgInfo(null), setPreviewUrl(''))} />
            ) : (
              <FileDrop
                multi={false}
                allowFolder={false}
                accept={[VIDEO_FILTER]}
                hint={t('Kéo-thả video nền, hoặc bấm để chọn', 'Drop the background video, or click to browse')}
                onFiles={(p) => void pickBg(p)}
              />
            )}
          </Field>
          <Field label={t('Video / ảnh phông xanh', 'Green-screen video / image')}>
            {ov ? (
              <PickedFile
                path={ov}
                info={ovInfo}
                icon={ovIsImage ? '🖼️' : '🟩'}
                onClear={() => (setOv(''), setOvInfo(null), setPreviewUrl(''))}
              />
            ) : (
              <FileDrop
                multi={false}
                allowFolder={false}
                accept={[OVERLAY_FILTER]}
                hint={t('Kéo-thả video/ảnh phông xanh, hoặc bấm để chọn', 'Drop the green-screen video/image, or click to browse')}
                onFiles={(p) => void pickOv(p)}
              />
            )}
          </Field>
        </div>
        {ov && ovIsImage && (
          <span className="hint">
            {t('Ảnh sẽ được lặp suốt thời lượng video nền.', 'The image will be looped for the whole background duration.')}
          </span>
        )}
      </div>

      <div className="card">
        <div className="card-title">{t('Thiết lập chromakey & vị trí', 'Chromakey & placement')}</div>
        <div className="grid-2">
          <Field label={t('Màu key', 'Key color')}>
            <div className="input-row">
              <input
                type="color"
                value={/^#[0-9a-fA-F]{6}$/.test(keyColor) ? keyColor : '#00ff00'}
                onChange={(e) => setKeyColor(e.target.value)}
                style={{ width: 46, height: 34, padding: 2, cursor: 'pointer', flex: '0 0 auto' }}
                title={t('Chọn màu key', 'Pick key color')}
              />
              <input className="input mono" value={keyColor} onChange={(e) => setKeyColor(e.target.value)} />
            </div>
          </Field>
          <Field label={t('Kích thước lớp phủ (% chiều rộng nền)', 'Overlay size (% of background width)')}>
            <NumInput value={sizePct} onChange={setSizePct} min={1} max={400} step={1} />
          </Field>
        </div>
        <div className="grid-2">
          <Field label={`Similarity: ${similarity.toFixed(2)}`}>
            <input
              type="range"
              style={{ width: '100%', accentColor: 'var(--accent)' }}
              min={0.01}
              max={1}
              step={0.01}
              value={similarity}
              onChange={(e) => setSimilarity(parseFloat(e.target.value))}
            />
          </Field>
          <Field label={`Blend: ${blend.toFixed(2)}`}>
            <input
              type="range"
              style={{ width: '100%', accentColor: 'var(--accent)' }}
              min={0}
              max={1}
              step={0.01}
              value={blend}
              onChange={(e) => setBlend(parseFloat(e.target.value))}
            />
          </Field>
        </div>
        <div className="grid-2">
          <Field label={t('Vị trí lớp phủ', 'Overlay position')}>
            <Select<GsPosition>
              value={position}
              onChange={setPosition}
              options={[
                { value: 'center', label: t('Chính giữa', 'Center') },
                { value: 'top-left', label: t('Trên - trái', 'Top left') },
                { value: 'top-right', label: t('Trên - phải', 'Top right') },
                { value: 'bottom-left', label: t('Dưới - trái', 'Bottom left') },
                { value: 'bottom-right', label: t('Dưới - phải', 'Bottom right') },
                { value: 'custom', label: t('Tuỳ chỉnh (px)', 'Custom (px)') }
              ]}
            />
          </Field>
          {position === 'custom' && (
            <div className="grid-2">
              <Field label="X (px)">
                <NumInput value={customX} onChange={setCustomX} min={0} step={1} />
              </Field>
              <Field label="Y (px)">
                <NumInput value={customY} onChange={setCustomY} min={0} step={1} />
              </Field>
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-title">{t('Xem thử & Render', 'Preview & Render')}</div>
        <Field
          label={`${t('Thời điểm xem thử', 'Preview time')}: ${secToHms(atSec)}`}
        >
          <input
            type="range"
            style={{ width: '100%', accentColor: 'var(--accent)' }}
            min={0}
            max={bgInfo ? Math.max(0, Math.floor(bgInfo.durationSec)) : 0}
            step={1}
            value={atSec}
            disabled={!bgInfo}
            onChange={(e) => setAtSec(parseInt(e.target.value, 10))}
          />
        </Field>
        <div className="row">
          <button className="btn" disabled={!valid || previewBusy} onClick={() => void doPreview()}>
            {previewBusy ? <span className="spin">⏳</span> : '👁️'} {t('Xem thử 1 frame', 'Preview 1 frame')}
          </button>
          <button className="btn btn-primary" disabled={!valid || busy} onClick={() => void run()}>
            🟩 {t('Bắt đầu render', 'Start render')}
          </button>
          <span className="hint">
            {t('Chế độ: re-encode (chromakey bắt buộc render lại)', 'Mode: re-encode (chromakey requires re-encoding)')}
          </span>
        </div>
        {previewUrl && (
          <div className="mt">
            <img
              src={previewUrl}
              alt={t('Xem thử phông xanh', 'Green-screen preview')}
              style={{ maxWidth: '100%', borderRadius: 8, display: 'block' }}
            />
          </div>
        )}
      </div>

      <TaskTable types={['green-screen']} />
    </div>
  )
}
