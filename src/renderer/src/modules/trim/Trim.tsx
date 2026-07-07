import { useState } from 'react'
import type { MediaInfo } from '@shared/types'
import type { TrimStartPayload } from '@shared/modules/trim'
import { fmtBytes, hmsToSec, secToHms } from '@shared/time'
import { invoke, probe } from '../../api'
import { Check, Field } from '../../components/Field'
import { FileDrop } from '../../components/FileDrop'
import { TaskTable } from '../../components/TaskTable'
import { useT } from '../../i18n'
import { useSettings } from '../../store/settings'
import { useUi } from '../../store/ui'

/**
 * Module tham chiếu — Cắt ngắn Video (spec 4.6).
 * Các module khác theo đúng pattern này: form → invoke('mod:<key>:start') → TaskTable.
 */
export default function Trim(): React.JSX.Element {
  const t = useT()
  const pushToast = useUi((s) => s.pushToast)
  const outputDir = useSettings((s) => s.settings?.outputDir ?? '')

  const [input, setInput] = useState<string>('')
  const [info, setInfo] = useState<MediaInfo | null>(null)
  const [start, setStart] = useState('00:00:00')
  const [end, setEnd] = useState('00:00:10')
  const [precise, setPrecise] = useState(false)
  const [busy, setBusy] = useState(false)

  const pick = async (paths: string[]): Promise<void> => {
    const p = paths[0]
    if (!p) return
    setInput(p)
    try {
      const i = await probe(p)
      setInfo(i)
      setStart('00:00:00')
      setEnd(secToHms(i.durationSec))
    } catch {
      setInfo(null)
    }
  }

  const startSec = hmsToSec(start)
  const endSec = hmsToSec(end)
  const valid = !!input && Number.isFinite(startSec) && Number.isFinite(endSec) && endSec > startSec

  const run = async (): Promise<void> => {
    if (!valid) return
    setBusy(true)
    try {
      const payload: TrimStartPayload = {
        input,
        start: startSec,
        end: endSec,
        precise,
        outputDir
      }
      await invoke<string>('mod:trim:start', payload)
      pushToast('success', t('Đã thêm vào hàng đợi', 'Added to queue'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="page-title">{t('Cắt ngắn Video', 'Trim Video')}</div>
      <div className="page-desc">
        {t(
          'Cắt một đoạn video theo thời điểm bắt đầu/kết thúc. Chế độ copy không re-encode — hoàn tất trong vài giây.',
          'Cut a clip by start/end time. Copy mode does not re-encode — done in seconds.'
        )}
      </div>

      <div className="card">
        <div className="card-title">{t('Nguồn video', 'Source video')}</div>
        {input ? (
          <div className="row wrap">
            <span className="ellipsis grow" title={input}>
              🎬 {input}
            </span>
            {info && (
              <span className="text-dim" style={{ fontSize: 12 }}>
                {secToHms(info.durationSec)} · {info.video ? `${info.video.width}×${info.video.height}` : ''} ·{' '}
                {info.video?.codec.toUpperCase()} · {fmtBytes(info.sizeBytes)}
              </span>
            )}
            <button className="btn btn-sm" onClick={() => (setInput(''), setInfo(null))}>
              {t('Chọn lại', 'Change')}
            </button>
          </div>
        ) : (
          <FileDrop multi={false} onFiles={(p) => void pick(p)} />
        )}
      </div>

      <div className="card">
        <div className="card-title">{t('Thiết lập cắt', 'Trim settings')}</div>
        <div className="grid-2">
          <Field label={t('Bắt đầu (hh:mm:ss)', 'Start (hh:mm:ss)')}>
            <input className="input mono" value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label={t('Kết thúc (hh:mm:ss)', 'End (hh:mm:ss)')}>
            <input className="input mono" value={end} onChange={(e) => setEnd(e.target.value)} />
          </Field>
        </div>
        {info && (
          <input
            type="range"
            style={{ width: '100%', accentColor: 'var(--accent)' }}
            min={0}
            max={Math.floor(info.durationSec)}
            value={Number.isFinite(endSec) ? Math.min(endSec, info.durationSec) : 0}
            onChange={(e) => setEnd(secToHms(parseInt(e.target.value, 10)))}
          />
        )}
        <Check
          checked={precise}
          onChange={setPrecise}
          label={t('Cắt chính xác từng frame (re-encode, chậm hơn)', 'Frame-accurate cut (re-encode, slower)')}
        />
        <div className="row mt">
          <button className="btn btn-primary" disabled={!valid || busy} onClick={() => void run()}>
            ✂️ {t('Bắt đầu cắt', 'Start trim')}
          </button>
          {valid && (
            <span className="hint">
              {t('Thời lượng đoạn cắt', 'Clip duration')}: {secToHms(endSec - startSec)} ·{' '}
              {precise ? t('chế độ re-encode', 're-encode mode') : t('chế độ copy (nhanh)', 'copy mode (fast)')}
            </span>
          )}
        </div>
      </div>

      <TaskTable types={['trim']} />
    </div>
  )
}
