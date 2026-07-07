import { useState } from 'react'
import type { MediaInfo } from '@shared/types'
import type { SplitMode, SplitStartPayload, SplitStartResult } from '@shared/modules/split'
import { fmtBytes, secToHms } from '@shared/time'
import { invoke, invokeSilent } from '../../api'
import { Check, Field, NumInput } from '../../components/Field'
import { FileDrop } from '../../components/FileDrop'
import { TaskTable } from '../../components/TaskTable'
import { useT } from '../../i18n'
import { useSettings } from '../../store/settings'
import { useUi } from '../../store/ui'

interface Item {
  path: string
  info: MediaInfo | null
}

/** Module Cắt chia nhỏ Video (spec 4.5) — chia theo thời lượng mỗi phần hoặc số phần. */
export default function Split(): React.JSX.Element {
  const t = useT()
  const pushToast = useUi((s) => s.pushToast)
  const outputDir = useSettings((s) => s.settings?.outputDir ?? '')

  const [items, setItems] = useState<Item[]>([])
  const [mode, setMode] = useState<SplitMode>('duration')
  const [minutes, setMinutes] = useState(10)
  const [parts, setParts] = useState(2)
  const [precise, setPrecise] = useState(false)
  const [busy, setBusy] = useState(false)

  const addFiles = (paths: string[]): void => {
    setItems((prev) => {
      const existing = new Set(prev.map((it) => it.path))
      const fresh = paths.filter((p) => !existing.has(p)).map((p): Item => ({ path: p, info: null }))
      for (const f of fresh) {
        void invokeSilent<MediaInfo>('core:probe', { path: f.path })
          .then((info) =>
            setItems((cur) => cur.map((it) => (it.path === f.path ? { ...it, info } : it)))
          )
          .catch(() => {})
      }
      return [...prev, ...fresh]
    })
  }

  const removeItem = (p: string): void => setItems((cur) => cur.filter((it) => it.path !== p))

  /** Số phần dự kiến cho 1 file theo thiết lập hiện tại. */
  const partsFor = (info: MediaInfo | null): number | null => {
    if (mode === 'parts') return parts >= 2 ? parts : null
    const secs = minutes * 60
    if (!(secs > 0)) return null
    if (!info || !(info.durationSec > 0)) return null
    return Math.max(1, Math.ceil(info.durationSec / secs))
  }

  const valid =
    items.length > 0 && (mode === 'duration' ? minutes > 0 : Number.isInteger(parts) && parts >= 2)

  const run = async (): Promise<void> => {
    if (!valid || busy) return
    setBusy(true)
    try {
      const payload: SplitStartPayload = {
        inputs: items.map((it) => it.path),
        mode,
        minutesPerPart: minutes,
        parts,
        precise,
        outputDir
      }
      const res = await invoke<SplitStartResult>('mod:split:start', payload)
      if (res.taskIds.length > 0) {
        pushToast(
          'success',
          t(
            `Đã thêm ${res.taskIds.length} tác vụ chia video vào hàng đợi`,
            `Added ${res.taskIds.length} split task(s) to queue`
          )
        )
      }
      for (const err of res.errors) pushToast('error', err)
    } catch {
      // invoke đã hiện toast lỗi
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="page-title">{t('Cắt chia nhỏ Video', 'Split Video')}</div>
      <div className="page-desc">
        {t(
          'Chia video thành nhiều phần theo thời lượng mỗi phần hoặc theo số phần. Chế độ copy không re-encode — gần như tức thì.',
          'Split videos into parts by duration per part or by part count. Copy mode does not re-encode — nearly instant.'
        )}
      </div>

      <div className="card">
        <div className="card-title">
          {t('Nguồn video', 'Source videos')} <span className="badge">{items.length}</span>
          {items.length > 0 && (
            <span className="right">
              <button className="btn btn-sm btn-ghost" onClick={() => setItems([])}>
                {t('Xoá tất cả', 'Clear all')}
              </button>
            </span>
          )}
        </div>
        <FileDrop multi allowFolder onFiles={addFiles} />
        {items.length > 0 && (
          <div className="table-wrap mt" style={{ maxHeight: 260 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>{t('Tên file', 'File')}</th>
                  <th>{t('Thời lượng', 'Duration')}</th>
                  <th>{t('Kích thước', 'Size')}</th>
                  <th>{t('Số phần dự kiến', 'Expected parts')}</th>
                  <th style={{ textAlign: 'right' }}></th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => {
                  const n = partsFor(it.info)
                  return (
                    <tr key={it.path}>
                      <td className="ellipsis" title={it.path} style={{ maxWidth: 320 }}>
                        🎬 {it.path}
                      </td>
                      <td className="mono">
                        {it.info && it.info.durationSec > 0 ? (
                          secToHms(it.info.durationSec)
                        ) : (
                          <span className="text-faint">—</span>
                        )}
                      </td>
                      <td className="text-dim">{it.info ? fmtBytes(it.info.sizeBytes) : '—'}</td>
                      <td>
                        {n ? (
                          <span className="badge">
                            {n} {t('phần', 'parts')}
                          </span>
                        ) : (
                          <span className="text-faint">—</span>
                        )}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <button
                          className="btn btn-sm btn-ghost"
                          title={t('Bỏ file này', 'Remove')}
                          onClick={() => removeItem(it.path)}
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-title">{t('Thiết lập chia', 'Split settings')}</div>
        <div className="row wrap">
          <label className="check">
            <input
              type="radio"
              name="split-mode"
              checked={mode === 'duration'}
              onChange={() => setMode('duration')}
            />
            {t('Theo thời lượng mỗi phần', 'By duration per part')}
          </label>
          <label className="check">
            <input
              type="radio"
              name="split-mode"
              checked={mode === 'parts'}
              onChange={() => setMode('parts')}
            />
            {t('Theo số phần', 'By number of parts')}
          </label>
        </div>
        <div className="grid-2 mt">
          <Field label={t('Phút mỗi phần', 'Minutes per part')}>
            <NumInput
              value={minutes}
              onChange={setMinutes}
              min={0.1}
              step={1}
              disabled={mode !== 'duration'}
            />
          </Field>
          <Field label={t('Số phần', 'Number of parts')}>
            <NumInput
              value={parts}
              onChange={(v) => setParts(Math.round(v))}
              min={2}
              step={1}
              disabled={mode !== 'parts'}
            />
          </Field>
        </div>
        <Check
          checked={precise}
          onChange={setPrecise}
          label={t(
            'Cắt chính xác từng frame (re-encode, chậm hơn)',
            'Frame-accurate cut (re-encode, slower)'
          )}
        />
        <div className="row mt">
          <button className="btn btn-primary" disabled={!valid || busy} onClick={() => void run()}>
            ✂️ {t('Bắt đầu chia', 'Start split')}
          </button>
          {valid && (
            <span className="hint">
              {precise ? t('chế độ re-encode', 're-encode mode') : t('chế độ copy (nhanh)', 'copy mode (fast)')} ·{' '}
              {t('xuất file dạng', 'output as')} <span className="mono">&lt;tên&gt;_part_000, _part_001...</span>
            </span>
          )}
        </div>
      </div>

      <TaskTable types={['split']} />
    </div>
  )
}
