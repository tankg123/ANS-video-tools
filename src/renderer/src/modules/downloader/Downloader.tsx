import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type {
  CookieConfig,
  DlItem,
  DlQuality,
  DownloadPayload,
  DownloadResult,
  FetchInfoResult
} from '@shared/modules/downloader'
import { fmtBytes, secToHms } from '@shared/time'
import { cancelTask, invoke, kvGet, kvSet, pickFiles, showInFolder } from '../../api'
import { Field, FolderInput, NumInput, Select } from '../../components/Field'
import { LogModal } from '../../components/LogModal'
import { ProgressBar } from '../../components/ProgressBar'
import { StatusChip } from '../../components/StatusChip'
import { useT } from '../../i18n'
import { useSettings } from '../../store/settings'
import { useTask, useTasks } from '../../store/tasks'
import { useUi } from '../../store/ui'
import { useDl } from './store'

/**
 * Module Tải Video (spec 4.10):
 * Nguồn (link + cookies) | Đầu ra (thư mục, chất lượng, song song) → Danh sách video persist,
 * tiến trình realtime join từ task store, virtual list khi > 50 dòng.
 */

type QOption = { value: DlQuality; label: string }

// ---------------- Row ----------------

interface RowProps {
  item: DlItem
  index: number
  qOptions: QOption[]
  onDownload: (item: DlItem) => void
  onRemove: (item: DlItem) => void
  onQuality: (id: string, q: DlQuality) => void
  onLog: (taskId: string) => void
}

const Row = memo(function Row({
  item,
  index,
  qOptions,
  onDownload,
  onRemove,
  onQuality,
  onLog
}: RowProps): React.JSX.Element {
  const t = useT()
  const task = useTask(item.taskId ?? '')

  // trạng thái hiển thị: ưu tiên task đang sống trong store, fallback trạng thái đã persist
  let status: DlItem['status'] = item.status
  if (task) {
    if (task.status === 'queued') status = 'queued'
    else if (task.status === 'running') status = 'downloading'
    else if (task.status === 'completed') status = 'done'
    else if (task.status === 'error') status = 'error'
    else status = 'idle' // killed
  }
  const active = status === 'queued' || status === 'downloading'
  const outputPath = item.outputPath || task?.outputPath
  const errText = item.error || task?.error

  return (
    <tr>
      <td className="text-dim" style={{ width: 34 }}>
        {index + 1}
      </td>
      <td style={{ width: 80 }}>
        {item.thumbnail ? (
          <img
            className="thumb"
            loading="lazy"
            alt=""
            src={item.thumbnail}
            referrerPolicy="no-referrer"
            onError={(e) => {
              e.currentTarget.style.display = 'none'
            }}
          />
        ) : (
          <div className="thumb" />
        )}
      </td>
      <td className="ellipsis" style={{ maxWidth: 260 }} title={item.title}>
        {item.title}
        {item.uploader && (
          <div className="text-faint" style={{ fontSize: 11 }}>
            {item.uploader}
          </div>
        )}
        {status === 'error' && errText && (
          <div className="text-danger" style={{ fontSize: 11 }} title={errText}>
            {errText.slice(0, 100)}
          </div>
        )}
      </td>
      <td className="mono text-dim" style={{ fontSize: 12 }}>
        {item.durationSec ? secToHms(item.durationSec) : '—'}
      </td>
      <td className="mono text-dim" style={{ fontSize: 12 }}>
        {fmtBytes(item.filesizeApprox)}
      </td>
      <td style={{ width: 150 }}>
        <Select<DlQuality>
          value={item.quality}
          onChange={(q) => onQuality(item.id, q)}
          options={qOptions}
          disabled={active}
        />
      </td>
      <td style={{ width: 180 }}>
        {status === 'downloading' && task ? (
          <div>
            <ProgressBar value={task.progress} />
            <div className="mono text-dim" style={{ fontSize: 10.5 }}>
              {[task.speed, task.eta && `ETA ${task.eta}`, task.detail].filter(Boolean).join(' · ') || '…'}
            </div>
          </div>
        ) : status === 'queued' ? (
          <StatusChip status="queued" />
        ) : status === 'done' ? (
          <StatusChip status="completed" />
        ) : status === 'error' ? (
          <span title={errText}>
            <StatusChip status="error" />
          </span>
        ) : (
          <span className="text-faint">{t('Chờ', 'Waiting')}</span>
        )}
      </td>
      <td>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          {active ? (
            <button
              className="btn btn-sm btn-danger"
              title={t('Dừng', 'Stop')}
              onClick={() => item.taskId && void cancelTask(item.taskId)}
            >
              ■
            </button>
          ) : (
            <button
              className="btn btn-sm btn-ghost"
              title={status === 'done' || status === 'error' ? t('Tải lại', 'Re-download') : t('Tải', 'Download')}
              onClick={() => onDownload(item)}
            >
              ⬇
            </button>
          )}
          {item.taskId && (
            <button className="btn btn-sm btn-ghost" title={t('Xem log', 'View log')} onClick={() => onLog(item.taskId!)}>
              📄
            </button>
          )}
          {status === 'done' && outputPath && (
            <button
              className="btn btn-sm btn-ghost"
              title={t('Mở thư mục', 'Show in folder')}
              onClick={() => void showInFolder(outputPath)}
            >
              📂
            </button>
          )}
          <button className="btn btn-sm btn-ghost" title={t('Xoá khỏi danh sách', 'Remove')} onClick={() => onRemove(item)}>
            🗑
          </button>
        </div>
      </td>
    </tr>
  )
})

// ---------------- Page ----------------

export default function Downloader(): React.JSX.Element {
  const t = useT()
  const pushToast = useUi((s) => s.pushToast)
  const downloadDir = useSettings((s) => s.settings?.downloadDir ?? '')
  const maxDownloads = useSettings((s) => s.settings?.maxDownloads ?? 2)
  const updateSettings = useSettings((s) => s.update)

  const items = useDl((s) => s.items)

  const [url, setUrl] = useState('')
  const [fetching, setFetching] = useState(false)
  const [busy, setBusy] = useState(false)
  const [defQuality, setDefQuality] = useState<DlQuality>('best')
  const [cookieMode, setCookieMode] = useState<CookieConfig['mode']>('none')
  const [cookieFile, setCookieFile] = useState('')
  const [cookieBrowser, setCookieBrowser] = useState('chrome')
  const [logTask, setLogTask] = useState<string | null>(null)
  const [cfgLoaded, setCfgLoaded] = useState(false)

  const cookies = useMemo<CookieConfig>(
    () => ({ mode: cookieMode, file: cookieFile || undefined, browser: cookieBrowser }),
    [cookieMode, cookieFile, cookieBrowser]
  )

  const qOptions = useMemo<QOption[]>(
    () => [
      { value: 'best', label: t('Tốt nhất hiện có', 'Best available') },
      { value: '2160', label: '2160p (4K)' },
      { value: '1440', label: '1440p (2K)' },
      { value: '1080', label: '1080p' },
      { value: '720', label: '720p' },
      { value: '480', label: '480p' },
      { value: 'mp3', label: t('Chỉ âm thanh MP3', 'Audio only MP3') },
      { value: 'm4a', label: t('Chỉ âm thanh M4A', 'Audio only M4A') }
    ],
    [t]
  )

  // nạp danh sách + cấu hình đã lưu (kv namespace 'downloader')
  useEffect(() => {
    void useDl.getState().load()
    void Promise.all([
      kvGet<DlQuality>('downloader', 'quality', 'best'),
      kvGet<CookieConfig>('downloader', 'cookies', { mode: 'none' })
    ]).then(([q, c]) => {
      setDefQuality(q)
      setCookieMode(c?.mode ?? 'none')
      setCookieFile(c?.file ?? '')
      setCookieBrowser(c?.browser ?? 'chrome')
      setCfgLoaded(true)
    })
  }, [])

  // persist cấu hình nhỏ (chỉ sau khi đã nạp xong để không ghi đè bằng default)
  useEffect(() => {
    if (!cfgLoaded) return
    void kvSet('downloader', 'quality', defQuality)
    void kvSet('downloader', 'cookies', cookies)
  }, [cfgLoaded, defQuality, cookies])

  // đồng bộ trạng thái task → item (ngoài chu kỳ render; chỉ update store khi thật sự đổi)
  useEffect(() => {
    const seen = new Set<string>()
    const reconcile = (): void => {
      const byId = useTasks.getState().byId
      const st = useDl.getState()
      for (const it of st.items) {
        if (!it.taskId) continue
        const task = byId[it.taskId]
        if (task) {
          seen.add(it.taskId)
          let patch: Partial<DlItem> | null = null
          if (task.status === 'completed' && (it.status !== 'done' || (task.outputPath && it.outputPath !== task.outputPath)))
            patch = { status: 'done', outputPath: task.outputPath, error: undefined }
          else if (task.status === 'error' && it.status !== 'error') patch = { status: 'error', error: task.error }
          else if (task.status === 'killed' && it.status !== 'idle') patch = { status: 'idle' }
          else if (task.status === 'running' && it.status !== 'downloading') patch = { status: 'downloading' }
          if (patch) st.update(it.id, patch)
        } else if (seen.has(it.taskId) && (it.status === 'queued' || it.status === 'downloading')) {
          // task bị xoá khỏi store khi item còn đang chờ/tải → trả về idle
          st.update(it.id, { status: 'idle', taskId: undefined })
        }
      }
    }
    reconcile()
    const unsub = useTasks.subscribe(reconcile)
    // quét item kẹt trạng thái (task đã biến mất khi tab này unmount) — chờ 1.5s cho store nhận batch đầu
    const sweep = setTimeout(() => {
      const byId = useTasks.getState().byId
      const st = useDl.getState()
      for (const it of st.items) {
        if ((it.status === 'queued' || it.status === 'downloading') && (!it.taskId || !byId[it.taskId])) {
          st.update(it.id, { status: 'idle', taskId: undefined })
        }
      }
    }, 1500)
    return () => {
      unsub()
      clearTimeout(sweep)
    }
  }, [])

  // ---------------- actions ----------------

  const fetchInfo = async (): Promise<void> => {
    const u = url.trim()
    if (!u || fetching) return
    setFetching(true)
    try {
      const res = await invoke<FetchInfoResult>('mod:downloader:fetchInfo', { url: u, cookies })
      const withQ = res.items.map((it) => ({ ...it, quality: defQuality }))
      const added = useDl.getState().merge(withQ)
      const dup = res.items.length - added
      pushToast(
        'success',
        t(
          `Đã thêm ${added} video${dup > 0 ? `, bỏ qua ${dup} video trùng` : ''}`,
          `Added ${added} video(s)${dup > 0 ? `, skipped ${dup} duplicate(s)` : ''}`
        )
      )
      if (added > 0) setUrl('')
    } catch {
      /* toast lỗi đã hiện ở api.invoke */
    } finally {
      setFetching(false)
    }
  }

  const startDownload = useCallback(
    async (list: DlItem[]): Promise<void> => {
      if (!list.length) return
      const payload: DownloadPayload = {
        items: list.map((it) => ({ id: it.id, url: it.url, title: it.title, quality: it.quality })),
        downloadDir,
        cookies
      }
      const res = await invoke<DownloadResult>('mod:downloader:download', payload)
      useDl.getState().markStarted(res)
    },
    [downloadDir, cookies]
  )

  const downloadOne = useCallback(
    (item: DlItem) => {
      void startDownload([item])
    },
    [startDownload]
  )

  const downloadAll = async (): Promise<void> => {
    const pending = items.filter((it) => it.status === 'idle' || it.status === 'error')
    if (!pending.length) {
      pushToast('info', t('Không có video nào cần tải', 'No videos to download'))
      return
    }
    setBusy(true)
    try {
      await startDownload(pending)
      pushToast('success', t(`Đã thêm ${pending.length} video vào hàng đợi tải`, `Queued ${pending.length} video(s)`))
    } catch {
      /* toast lỗi đã hiện ở api.invoke */
    } finally {
      setBusy(false)
    }
  }

  const stopAll = async (): Promise<void> => {
    const n = await invoke<number>('mod:downloader:stopAll')
    pushToast('info', t(`Đã dừng ${n} tác vụ tải`, `Stopped ${n} download task(s)`))
  }

  const clearAll = async (): Promise<void> => {
    if (items.some((it) => it.status === 'queued' || it.status === 'downloading')) {
      await invoke<number>('mod:downloader:stopAll')
    }
    useDl.getState().clear()
  }

  const removeOne = useCallback((item: DlItem) => {
    const task = item.taskId ? useTasks.getState().byId[item.taskId] : undefined
    if (task && (task.status === 'queued' || task.status === 'running') && item.taskId) {
      void cancelTask(item.taskId)
    }
    useDl.getState().remove(item.id)
  }, [])

  const setQuality = useCallback((id: string, q: DlQuality) => {
    useDl.getState().update(id, { quality: q })
  }, [])

  const onLog = useCallback((taskId: string) => setLogTask(taskId), [])

  // ---------------- virtual list ----------------

  const scrollRef = useRef<HTMLDivElement>(null)
  const useVirtual = items.length > 50
  const virtualizer = useVirtualizer({
    count: useVirtual ? items.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 54,
    overscan: 10
  })

  const header = (
    <thead>
      <tr>
        <th style={{ width: 34 }}>#</th>
        <th style={{ width: 80 }}>{t('Ảnh', 'Thumb')}</th>
        <th>{t('Tên', 'Title')}</th>
        <th style={{ width: 88 }}>{t('Thời lượng', 'Duration')}</th>
        <th style={{ width: 88 }}>{t('Kích thước', 'Size')}</th>
        <th style={{ width: 150 }}>{t('Chất lượng', 'Quality')}</th>
        <th style={{ width: 180 }}>{t('Tiến trình', 'Progress')}</th>
        <th style={{ textAlign: 'right' }}>{t('Hành động', 'Actions')}</th>
      </tr>
    </thead>
  )

  const rowProps = { qOptions, onDownload: downloadOne, onRemove: removeOne, onQuality: setQuality, onLog }

  return (
    <div>
      <div className="page-title">{t('Tải Video', 'Download Video')}</div>
      <div className="page-desc">
        {t(
          'Tải video / playlist / kênh từ YouTube, TikTok, Facebook… bằng yt-dlp. Danh sách được lưu lại khi mở lại app.',
          'Download videos / playlists / channels from YouTube, TikTok, Facebook… via yt-dlp. The list persists across restarts.'
        )}
      </div>

      <div className="grid-2">
        {/* ---- Nguồn Video ---- */}
        <div className="card">
          <div className="card-title">{t('Nguồn Video', 'Video source')}</div>
          <Field label={t('Link Video / Playlist / Kênh', 'Video / Playlist / Channel link')}>
            <div className="input-row">
              <input
                className="input"
                placeholder={t('Dán link YouTube / TikTok / Facebook…', 'Paste YouTube / TikTok / Facebook link…')}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void fetchInfo()
                }}
              />
              <button className="btn btn-primary" disabled={fetching || !url.trim()} onClick={() => void fetchInfo()}>
                {fetching ? `⏳ ${t('Đang lấy...', 'Fetching...')}` : `🔎 ${t('Tải thông tin', 'Fetch info')}`}
              </button>
            </div>
          </Field>
          <Field label={t('Cookies (video cần đăng nhập)', 'Cookies (login-required videos)')}>
            <Select<CookieConfig['mode']>
              value={cookieMode}
              onChange={setCookieMode}
              options={[
                { value: 'none', label: t('Không dùng (video công khai)', 'None (public videos)') },
                { value: 'file', label: t('File cookies.txt', 'cookies.txt file') },
                { value: 'browser', label: t('Lấy từ trình duyệt', 'From browser') }
              ]}
            />
          </Field>
          {cookieMode === 'file' && (
            <Field label={t('File cookies.txt', 'cookies.txt file')}>
              <div className="input-row">
                <input
                  className="input"
                  value={cookieFile}
                  placeholder="cookies.txt"
                  onChange={(e) => setCookieFile(e.target.value)}
                />
                <button
                  className="btn"
                  onClick={async () => {
                    const p = await pickFiles({
                      multi: false,
                      filters: [{ name: 'Cookies', extensions: ['txt'] }]
                    })
                    if (p[0]) setCookieFile(p[0])
                  }}
                >
                  {t('Chọn...', 'Browse...')}
                </button>
              </div>
            </Field>
          )}
          {cookieMode === 'browser' && (
            <Field label={t('Trình duyệt', 'Browser')}>
              <Select
                value={cookieBrowser}
                onChange={setCookieBrowser}
                options={[
                  { value: 'chrome', label: 'Chrome' },
                  { value: 'edge', label: 'Edge' },
                  { value: 'firefox', label: 'Firefox' }
                ]}
              />
            </Field>
          )}
          <div className="hint">
            {t(
              '“Tải thông tin” chỉ lấy metadata (không tải file). Playlist/kênh sẽ được tách thành từng video.',
              '“Fetch info” only reads metadata (no file download). Playlists/channels are expanded into individual videos.'
            )}
          </div>
        </div>

        {/* ---- Đầu ra & Xử lý ---- */}
        <div className="card">
          <div className="card-title">{t('Đầu ra & Xử lý', 'Output & Processing')}</div>
          <Field label={t('Thư mục lưu (nhớ cho lần sau)', 'Save folder (remembered)')}>
            <FolderInput value={downloadDir} onChange={(v) => void updateSettings({ downloadDir: v })} />
          </Field>
          <div className="grid-2">
            <Field label={t('Chất lượng mặc định', 'Default quality')}>
              <Select<DlQuality> value={defQuality} onChange={setDefQuality} options={qOptions} />
            </Field>
            <Field label={t('Số video tải cùng lúc', 'Concurrent downloads')}>
              <NumInput
                value={maxDownloads}
                min={1}
                max={10}
                step={1}
                onChange={(v) => void updateSettings({ maxDownloads: Math.round(v) })}
              />
            </Field>
          </div>
          <div className="row mt">
            <button className="btn btn-success" disabled={busy || items.length === 0} onClick={() => void downloadAll()}>
              ⬇️ {t('Tải tất cả', 'Download all')}
            </button>
            <button className="btn btn-danger" onClick={() => void stopAll()}>
              ⛔ {t('Dừng tất cả', 'Stop all')}
            </button>
          </div>
        </div>
      </div>

      {/* ---- Danh sách Video ---- */}
      <div className="card">
        <div className="card-title">
          {t('Danh sách Video', 'Video list')} <span className="badge">{items.length}</span>
          <span className="right">
            <button className="btn btn-sm btn-ghost" disabled={items.length === 0} onClick={() => void clearAll()}>
              🗑 {t('Xoá tất cả', 'Clear all')}
            </button>
          </span>
        </div>
        {items.length === 0 ? (
          <div className="empty-state">
            <div className="big">⬇️</div>
            {t('Dán link rồi bấm “Tải thông tin” để thêm video', 'Paste a link and press “Fetch info” to add videos')}
          </div>
        ) : (
          <div className="table-wrap" ref={scrollRef} style={{ maxHeight: 480 }}>
            <table className="table">
              {header}
              {useVirtual ? (
                <tbody style={{ position: 'relative' }}>
                  {virtualizer.getVirtualItems().length > 0 && (
                    <tr style={{ height: virtualizer.getVirtualItems()[0].start }} aria-hidden />
                  )}
                  {virtualizer.getVirtualItems().map((v) => (
                    <Row key={items[v.index].id} item={items[v.index]} index={v.index} {...rowProps} />
                  ))}
                  <tr
                    style={{
                      height: virtualizer.getTotalSize() - (virtualizer.getVirtualItems().at(-1)?.end ?? 0)
                    }}
                    aria-hidden
                  />
                </tbody>
              ) : (
                <tbody>
                  {items.map((it, i) => (
                    <Row key={it.id} item={it} index={i} {...rowProps} />
                  ))}
                </tbody>
              )}
            </table>
          </div>
        )}
      </div>

      <div className="text-faint" style={{ fontSize: 11, textAlign: 'center', marginTop: 10 }}>
        ⚖️{' '}
        {t(
          'Chỉ tải nội dung bạn có quyền tải. Bạn tự chịu trách nhiệm tuân thủ điều khoản nền tảng và luật bản quyền.',
          'Only download content you have the right to download. You are responsible for complying with platform terms and copyright law.'
        )}
      </div>

      {logTask && <LogModal taskId={logTask} onClose={() => setLogTask(null)} />}
    </div>
  )
}
