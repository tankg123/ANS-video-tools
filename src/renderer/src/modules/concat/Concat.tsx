import { useState } from 'react'
import type { MediaInfo } from '@shared/types'
import type { ConcatAnalyzeResult, ConcatMode, ConcatStartPayload } from '@shared/modules/concat'
import { fmtBytes, secToHms } from '@shared/time'
import { invoke, probe } from '../../api'
import { FileDrop } from '../../components/FileDrop'
import { Modal } from '../../components/Modal'
import { TaskTable } from '../../components/TaskTable'
import { useT } from '../../i18n'
import { useSettings } from '../../store/settings'
import { useUi } from '../../store/ui'

interface Item {
  path: string
  /** null = đang probe hoặc probe lỗi */
  info: MediaInfo | null
}

const baseName = (p: string): string => p.split(/[\\/]/).pop() ?? p

/**
 * Module Ghép nối Video (spec 4.9):
 * danh sách sắp xếp được (↑ ↓ 🗑) → Phân tích → copy tức thì nếu cùng chuẩn,
 * khác chuẩn thì hiện dialog cảnh báo chuẩn hoá + re-encode.
 */
export default function Concat(): React.JSX.Element {
  const t = useT()
  const pushToast = useUi((s) => s.pushToast)
  const outputDir = useSettings((s) => s.settings?.outputDir ?? '')

  const [items, setItems] = useState<Item[]>([])
  const [busy, setBusy] = useState(false)
  const [warn, setWarn] = useState<ConcatAnalyzeResult | null>(null)

  const probeOne = async (p: string): Promise<void> => {
    try {
      const info = await probe(p)
      setItems((prev) => prev.map((it) => (it.path === p ? { ...it, info } : it)))
    } catch {
      // giữ info = null, backend sẽ báo lỗi rõ khi phân tích
    }
  }

  const addFiles = (paths: string[]): void => {
    const have = new Set(items.map((i) => i.path))
    const fresh = paths.filter((p, idx, arr) => !have.has(p) && arr.indexOf(p) === idx)
    if (!fresh.length) return
    setItems((prev) => [...prev, ...fresh.map((p): Item => ({ path: p, info: null }))])
    for (const p of fresh) void probeOne(p)
  }

  const move = (idx: number, dir: -1 | 1): void => {
    setItems((prev) => {
      const j = idx + dir
      if (j < 0 || j >= prev.length) return prev
      const next = [...prev]
      const tmp = next[idx]
      next[idx] = next[j]
      next[j] = tmp
      return next
    })
  }

  const removeAt = (idx: number): void => setItems((prev) => prev.filter((_, i) => i !== idx))

  const totalDur = items.reduce((s, i) => s + (i.info?.durationSec ?? 0), 0)
  const canRun = items.length >= 2 && !busy

  const start = async (mode: ConcatMode): Promise<void> => {
    setBusy(true)
    try {
      const payload: ConcatStartPayload = { inputs: items.map((i) => i.path), mode, outputDir }
      await invoke<string>('mod:concat:start', payload)
      setWarn(null)
      pushToast(
        'success',
        mode === 'copy'
          ? t('Đã thêm vào hàng đợi — ghép nhanh (copy, không re-encode)', 'Queued — fast merge (copy, no re-encode)')
          : t('Đã thêm vào hàng đợi — chuẩn hoá + re-encode', 'Queued — normalize + re-encode')
      )
    } finally {
      setBusy(false)
    }
  }

  const analyzeAndMerge = async (): Promise<void> => {
    if (!canRun) return
    setBusy(true)
    try {
      const res = await invoke<ConcatAnalyzeResult>('mod:concat:analyze', {
        inputs: items.map((i) => i.path)
      })
      if (res.compatible) {
        await start('copy')
      } else {
        setWarn(res)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="page-title">{t('Ghép nối Video', 'Concat Videos')}</div>
      <div className="page-desc">
        {t(
          'Ghép nhiều video thành một theo thứ tự. Cùng codec/độ phân giải → ghép tức thì (copy); khác chuẩn → tự động chuẩn hoá + re-encode (có cảnh báo trước).',
          'Merge multiple videos in order. Same codec/resolution → instant merge (copy); mixed formats → auto-normalize + re-encode (with warning).'
        )}
      </div>

      <div className="card">
        <div className="card-title">
          {t('Danh sách ghép (theo thứ tự)', 'Merge list (in order)')}
          {items.length > 0 && (
            <span className="right text-dim" style={{ fontSize: 12 }}>
              {items.length} {t('file', 'files')} · {secToHms(totalDur)}
              <button className="btn btn-sm btn-ghost" style={{ marginLeft: 8 }} onClick={() => setItems([])}>
                {t('Xoá tất cả', 'Clear all')}
              </button>
            </span>
          )}
        </div>

        {items.length > 0 && (
          <div className="table-wrap mb">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 32 }}>#</th>
                  <th>{t('Tên file', 'File name')}</th>
                  <th>{t('Thời lượng', 'Duration')}</th>
                  <th>{t('Độ phân giải', 'Resolution')}</th>
                  <th>Codec</th>
                  <th>{t('Dung lượng', 'Size')}</th>
                  <th style={{ width: 120 }}></th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, idx) => (
                  <tr key={it.path}>
                    <td className="text-dim">{idx + 1}</td>
                    <td className="ellipsis" style={{ maxWidth: 320 }} title={it.path}>
                      🎬 {baseName(it.path)}
                    </td>
                    <td className="mono">{it.info ? secToHms(it.info.durationSec) : '…'}</td>
                    <td className="mono">
                      {it.info?.video ? `${it.info.video.width}×${it.info.video.height}` : '—'}
                    </td>
                    <td className="mono">
                      {it.info?.video
                        ? `${it.info.video.codec.toUpperCase()}${it.info.audio ? '+' + it.info.audio.codec.toUpperCase() : ''}`
                        : '—'}
                    </td>
                    <td className="text-dim">{it.info ? fmtBytes(it.info.sizeBytes) : '—'}</td>
                    <td>
                      <div className="row" style={{ justifyContent: 'flex-end' }}>
                        <button
                          className="btn btn-sm btn-icon"
                          disabled={idx === 0}
                          title={t('Lên', 'Up')}
                          onClick={() => move(idx, -1)}
                        >
                          ↑
                        </button>
                        <button
                          className="btn btn-sm btn-icon"
                          disabled={idx === items.length - 1}
                          title={t('Xuống', 'Down')}
                          onClick={() => move(idx, 1)}
                        >
                          ↓
                        </button>
                        <button
                          className="btn btn-sm btn-icon btn-danger"
                          title={t('Xoá khỏi danh sách', 'Remove')}
                          onClick={() => removeAt(idx)}
                        >
                          🗑
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <FileDrop multi onFiles={addFiles} />

        <div className="row mt">
          <button className="btn btn-primary" disabled={!canRun} onClick={() => void analyzeAndMerge()}>
            🔗 {t('Phân tích & Ghép', 'Analyze & Merge')}
          </button>
          <span className="hint">
            {items.length < 2
              ? t('Cần ít nhất 2 video', 'At least 2 videos required')
              : t(
                  'Cùng chuẩn → ghép copy tức thì; khác chuẩn → hỏi xác nhận re-encode',
                  'Same format → instant copy merge; mixed → asks to confirm re-encode'
                )}
          </span>
        </div>
      </div>

      {warn && (
        <Modal
          title={t('Cảnh báo: video khác chuẩn', 'Warning: mixed formats')}
          onClose={() => setWarn(null)}
          actions={
            <>
              <button className="btn" onClick={() => setWarn(null)}>
                {t('Huỷ', 'Cancel')}
              </button>
              <button className="btn btn-primary" disabled={busy} onClick={() => void start('re-encode')}>
                {t('Chuẩn hoá & Ghép', 'Normalize & Merge')}
              </button>
            </>
          }
        >
          <p>
            {t(
              'Các video không cùng chuẩn, sẽ được chuẩn hoá (scale + fps) và re-encode trước khi ghép — chậm hơn chế độ copy.',
              'The videos have mixed formats and will be normalized (scale + fps) and re-encoded before merging — slower than copy mode.'
            )}
          </p>
          {warn.reasons.length > 0 && (
            <ul style={{ margin: '8px 0 8px 18px' }}>
              {warn.reasons.map((r) => (
                <li key={r} className="text-dim" style={{ fontSize: 12.5 }}>
                  {r}
                </li>
              ))}
            </ul>
          )}
          <p className="hint">
            {t('Chuẩn đầu ra', 'Output target')}: {warn.targetW}×{warn.targetH} · {warn.targetFps} fps · H264 + AAC
            · {t('tổng thời lượng', 'total duration')} {secToHms(warn.totalDur)}
          </p>
        </Modal>
      )}

      <TaskTable types={['concat']} />
    </div>
  )
}
