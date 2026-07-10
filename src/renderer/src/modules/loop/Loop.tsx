import { useEffect, useState } from 'react'
import type { MediaInfo } from '@shared/types'
import type { LoopMode, LoopStartPayload } from '@shared/modules/loop'
import { fmtBytes, secToHms } from '@shared/time'
import { invoke, kvGet, kvSet, pickFiles, probe } from '../../api'
import { Field, FolderInput, NumInput } from '../../components/Field'
import { FileDrop } from '../../components/FileDrop'
import { TaskTable } from '../../components/TaskTable'
import { useT } from '../../i18n'
import { useSettings } from '../../store/settings'
import { useUi } from '../../store/ui'

/**
 * Module Lặp lại Video (spec 4.8):
 * chọn 1 video → lặp đến tổng thời lượng mục tiêu HOẶC theo số lần lặp.
 * Luôn dùng -stream_loop + -c copy (không re-encode).
 */
export default function Loop(): React.JSX.Element {
  const t = useT()
  const pushToast = useUi((s) => s.pushToast)
  const defaultOutputDir = useSettings((s) => s.settings?.outputDir ?? '')

  const [input, setInput] = useState<string>('')
  const [outputDir, setOutputDir] = useState(defaultOutputDir)
  const [info, setInfo] = useState<MediaInfo | null>(null)
  const [mode, setMode] = useState<LoopMode>('duration')
  const [hours, setHours] = useState(1)
  const [minutes, setMinutes] = useState(0)
  const [seconds, setSeconds] = useState(0)
  const [count, setCount] = useState(2)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    void kvGet<string>('loop', 'outputDir', defaultOutputDir).then((saved) => {
      if (alive) setOutputDir(saved)
    })
    return () => {
      alive = false
    }
  }, [defaultOutputDir])

  const changeOutputDir = (value: string): void => {
    setOutputDir(value)
    void kvSet('loop', 'outputDir', value)
  }

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

  const clearSource = (): void => {
    setInput('')
    setInfo(null)
  }

  const replaceSource = async (): Promise<void> => {
    const paths = await pickFiles({ multi: false })
    if (paths.length) await pick(paths)
  }

  const targetSec =
    Math.max(0, hours) * 3600 + Math.max(0, minutes) * 60 + Math.max(0, seconds)
  const srcDur = info?.durationSec ?? 0
  const expectedSec = mode === 'duration' ? targetSec : srcDur * Math.floor(count)
  const valid = !!input && (mode === 'duration' ? targetSec > 0 : Math.floor(count) >= 1)

  const run = async (): Promise<void> => {
    if (!valid) return
    setBusy(true)
    try {
      const payload: LoopStartPayload = {
        input,
        mode,
        targetSec: mode === 'duration' ? targetSec : undefined,
        count: mode === 'count' ? Math.floor(count) : undefined,
        outputDir
      }
      await invoke<string>('mod:loop:start', payload)
      pushToast('success', t('Đã thêm vào hàng đợi', 'Added to queue'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="page-title">{t('Lặp lại Video', 'Loop Video')}</div>
      <div className="page-desc">
        {t(
          'Lặp một video đến tổng thời lượng mục tiêu (vd 1 giờ) hoặc theo số lần lặp. Dùng stream copy — không re-encode, hoàn tất trong vài giây.',
          'Loop a video to a target total duration (e.g. 1 hour) or by loop count. Uses stream copy — no re-encode, done in seconds.'
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
            <button className="btn btn-sm" onClick={() => void replaceSource()}>
              {t('Chọn lại', 'Change')}
            </button>
            <button className="btn btn-sm btn-danger" onClick={clearSource}>
              🗑 {t('Xoá', 'Clear')}
            </button>
          </div>
        ) : (
          <FileDrop multi={false} onFiles={(p) => void pick(p)} />
        )}
      </div>

      <div className="card">
        <div className="card-title">{t('Thiết lập lặp', 'Loop settings')}</div>
        <div className="row wrap">
          <label className="check">
            <input
              type="radio"
              name="loop-mode"
              checked={mode === 'duration'}
              onChange={() => setMode('duration')}
            />
            {t('Tổng thời lượng mục tiêu', 'Target total duration')}
          </label>
          <label className="check">
            <input type="radio" name="loop-mode" checked={mode === 'count'} onChange={() => setMode('count')} />
            {t('Số lần lặp', 'Loop count')}
          </label>
        </div>

        {mode === 'duration' ? (
          <div className="grid-3 mt">
            <Field label={t('Giờ', 'Hours')}>
              <NumInput value={hours} onChange={setHours} min={0} max={240} step={1} />
            </Field>
            <Field label={t('Phút', 'Minutes')}>
              <NumInput value={minutes} onChange={setMinutes} min={0} max={59} step={1} />
            </Field>
            <Field label={t('Giây', 'Seconds')}>
              <NumInput value={seconds} onChange={setSeconds} min={0} max={59} step={1} />
            </Field>
          </div>
        ) : (
          <div className="grid-2 mt">
            <Field
              label={t('Số lần phát tổng cộng', 'Total play count')}
              hint={t('2 = video phát 2 lần liên tiếp', '2 = video plays twice back-to-back')}
            >
              <NumInput value={count} onChange={setCount} min={1} max={10000} step={1} />
            </Field>
          </div>
        )}

        <Field
          label={t('Thư mục xuất', 'Output folder')}
          hint={t(
            'Để trống sẽ lưu cạnh video nguồn. Lựa chọn này được ghi nhớ cho lần mở sau.',
            'Leave empty to save next to the source video. This choice is remembered next time.'
          )}
        >
          <FolderInput
            value={outputDir}
            onChange={changeOutputDir}
            placeholder={t('Cùng thư mục với video nguồn', 'Next to the source video')}
          />
        </Field>

        <div className="row mt">
          <button className="btn btn-primary" disabled={!valid || busy} onClick={() => void run()}>
            🔁 {t('Bắt đầu lặp', 'Start loop')}
          </button>
          {valid && (
            <span className="hint">
              {t('Thời lượng kết quả dự kiến', 'Expected output duration')}:{' '}
              {mode === 'count' && !info ? t('(chưa đọc được nguồn)', '(source not probed)') : secToHms(expectedSec)}
              {mode === 'duration' && srcDur > 0 && targetSec > 0 && (
                <> · {t('lặp', 'loops')} ≈ {Math.max(1, Math.ceil(targetSec / srcDur))}×</>
              )}
              {' · '}
              {t('chế độ copy (không re-encode)', 'copy mode (no re-encode)')}
            </span>
          )}
        </div>
      </div>

      <TaskTable types={['loop']} />
    </div>
  )
}
