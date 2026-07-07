import { useEffect, useState } from 'react'
import type { AppSettings, HwInfo } from '@shared/types'
import { getHw, invoke } from '../api'
import { useT } from '../i18n'
import { useSettings } from '../store/settings'
import { useUi } from '../store/ui'
import { Check, Field, FolderInput, NumInput, Select } from './Field'
import { Modal } from './Modal'

export function SettingsModal(): React.JSX.Element | null {
  const t = useT()
  const open = useUi((s) => s.settingsOpen)
  const setOpen = useUi((s) => s.setSettingsOpen)
  const pushToast = useUi((s) => s.pushToast)
  const settings = useSettings((s) => s.settings)
  const update = useSettings((s) => s.update)

  const [draft, setDraft] = useState<AppSettings | null>(null)
  const [hw, setHw] = useState<HwInfo | null>(null)
  const [detecting, setDetecting] = useState(false)
  const [licUser, setLicUser] = useState('')
  const [licKey, setLicKey] = useState('')

  useEffect(() => {
    if (open && settings) {
      setDraft({ ...settings })
      setLicUser(settings.license.username)
      setLicKey(settings.license.key)
      getHw()
        .then(setHw)
        .catch(() => {})
    }
  }, [open, settings])

  if (!open || !draft) return null

  const save = async (): Promise<void> => {
    await update({
      outputDir: draft.outputDir,
      downloadDir: draft.downloadDir,
      maxFfmpeg: draft.maxFfmpeg,
      maxDownloads: draft.maxDownloads,
      maxLive: draft.maxLive,
      encoderPref: draft.encoderPref,
      autoStart: draft.autoStart,
      updateUrl: draft.updateUrl
    })
    if (licUser !== settings?.license.username || licKey !== settings?.license.key) {
      await invoke('core:license:set', { username: licUser, key: licKey })
      const s = await invoke<AppSettings>('core:settings:get')
      useSettings.getState().apply(s)
    }
    pushToast('success', t('Đã lưu cài đặt', 'Settings saved'))
    setOpen(false)
  }

  return (
    <Modal
      wide
      title={t('Cài đặt', 'Settings')}
      onClose={() => setOpen(false)}
      actions={
        <>
          <button className="btn" onClick={() => setOpen(false)}>
            {t('Huỷ', 'Cancel')}
          </button>
          <button className="btn btn-primary" onClick={() => void save()}>
            {t('Lưu', 'Save')}
          </button>
        </>
      }
    >
      <div className="grid-2">
        <div>
          <Field label={t('Tên hiển thị', 'Display name')}>
            <input className="input" value={licUser} onChange={(e) => setLicUser(e.target.value)} />
          </Field>
          <Field
            label={t('License key', 'License key')}
            hint={t('Key chứa ngày YYYY-MM-DD sẽ đặt HSD; để trống = Không giới hạn', 'Key containing YYYY-MM-DD sets expiry; empty = Unlimited')}
          >
            <input className="input" value={licKey} onChange={(e) => setLicKey(e.target.value)} />
          </Field>
          <Field label={t('Thư mục xuất mặc định', 'Default output folder')} hint={t('Để trống = cùng thư mục file gốc', 'Empty = same folder as source')}>
            <FolderInput value={draft.outputDir} onChange={(v) => setDraft({ ...draft, outputDir: v })} />
          </Field>
          <Field label={t('Thư mục tải video', 'Download folder')}>
            <FolderInput value={draft.downloadDir} onChange={(v) => setDraft({ ...draft, downloadDir: v })} />
          </Field>
          <Check
            checked={draft.autoStart}
            onChange={(v) => setDraft({ ...draft, autoStart: v })}
            label={t('Tự chạy cùng Windows', 'Start with Windows')}
          />
        </div>
        <div>
          <Field label={t('Số tác vụ FFmpeg song song', 'Parallel FFmpeg tasks')} hint={t('Bị giới hạn bởi số nhân CPU / 2', 'Capped at CPU cores / 2')}>
            <NumInput value={draft.maxFfmpeg} min={1} max={16} onChange={(v) => setDraft({ ...draft, maxFfmpeg: v })} />
          </Field>
          <Field label={t('Số video tải cùng lúc', 'Concurrent downloads')}>
            <NumInput value={draft.maxDownloads} min={1} max={10} onChange={(v) => setDraft({ ...draft, maxDownloads: v })} />
          </Field>
          <Field label={t('Số luồng live tối đa', 'Max live streams')}>
            <NumInput value={draft.maxLive} min={1} max={20} onChange={(v) => setDraft({ ...draft, maxLive: v })} />
          </Field>
          <Field label={t('Encoder ưu tiên', 'Preferred encoder')}>
            <Select
              value={draft.encoderPref}
              onChange={(v) => setDraft({ ...draft, encoderPref: v })}
              options={[
                { value: 'auto', label: t('Tự động (khuyến nghị)', 'Auto (recommended)') },
                { value: 'nvenc', label: 'NVIDIA NVENC' },
                { value: 'qsv', label: 'Intel QuickSync' },
                { value: 'amf', label: 'AMD AMF' },
                { value: 'x264', label: 'CPU (libx264)' }
              ]}
            />
          </Field>
          <Field label={t('URL kiểm tra cập nhật', 'Update check URL')}>
            <input
              className="input"
              placeholder="https://api.github.com/repos/.../releases/latest"
              value={draft.updateUrl}
              onChange={(e) => setDraft({ ...draft, updateUrl: e.target.value })}
            />
          </Field>
          <div className="card" style={{ padding: 10 }}>
            <div className="row">
              <b style={{ fontSize: 12 }}>{t('Phần cứng đã dò', 'Detected hardware')}</b>
              <button
                className="btn btn-sm"
                style={{ marginLeft: 'auto' }}
                disabled={detecting}
                onClick={async () => {
                  setDetecting(true)
                  try {
                    setHw(await getHw(true))
                  } finally {
                    setDetecting(false)
                  }
                }}
              >
                {detecting ? t('Đang dò...', 'Detecting...') : t('Dò lại', 'Re-detect')}
              </button>
            </div>
            <div className="hint mt">
              GPU: {hw?.gpus.join(', ') || '—'}
              <br />
              H264: <b className="text-success">{hw?.best.h264 ?? '—'}</b> · HEVC:{' '}
              <b className="text-success">{hw?.best.hevc ?? '—'}</b>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  )
}
