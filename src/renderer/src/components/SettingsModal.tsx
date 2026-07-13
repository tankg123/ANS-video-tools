import { useEffect, useRef, useState } from 'react'
import type { AppSettings, HwInfo } from '@shared/types'
import { ACCENT_PRESETS, DEFAULT_ACCENT_COLOR } from '@shared/theme'
import { getHw } from '../api'
import { useT } from '../i18n'
import { useAuth } from '../store/auth'
import { useSettings } from '../store/settings'
import { useUi } from '../store/ui'
import { Check, Field, FolderInput, NumInput, Select } from './Field'
import { Icon } from './Icon'
import { Modal } from './Modal'

export function SettingsModal(): React.JSX.Element | null {
  const t = useT()
  const open = useUi((s) => s.settingsOpen)
  const setOpen = useUi((s) => s.setSettingsOpen)
  const pushToast = useUi((s) => s.pushToast)
  const settings = useSettings((s) => s.settings)
  const update = useSettings((s) => s.update)
  const account = useAuth((s) => s.status?.account)

  const [draft, setDraft] = useState<AppSettings | null>(null)
  const [hw, setHw] = useState<HwInfo | null>(null)
  const [detecting, setDetecting] = useState(false)
  const [saving, setSaving] = useState(false)
  const initialized = useRef(false)

  useEffect(() => {
    if (!open) {
      initialized.current = false
      return
    }
    if (!settings || initialized.current) return
    initialized.current = true
    setDraft({ ...settings })
    void getHw().then(setHw).catch(() => {})
  }, [open, settings])

  if (!open || !draft) return null

  const dirty = !!settings && (
    draft.outputDir !== settings.outputDir ||
    draft.downloadDir !== settings.downloadDir ||
    draft.maxFfmpeg !== settings.maxFfmpeg ||
    draft.maxDownloads !== settings.maxDownloads ||
    draft.encoderPref !== settings.encoderPref ||
    draft.autoStart !== settings.autoStart ||
    draft.accentColor !== settings.accentColor
  )

  const requestClose = (): void => {
    if (saving) return
    if (
      dirty &&
      !window.confirm(
        t(
          'Bạn có thay đổi chưa lưu. Đóng mà không lưu?',
          'You have unsaved changes. Close without saving?'
        )
      )
    ) return
    setOpen(false)
  }

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      await update({
        outputDir: draft.outputDir,
        downloadDir: draft.downloadDir,
        maxFfmpeg: draft.maxFfmpeg,
        maxDownloads: draft.maxDownloads,
        encoderPref: draft.encoderPref,
        autoStart: draft.autoStart,
        accentColor: draft.accentColor
      })
      pushToast('success', t('Đã lưu cài đặt', 'Settings saved'))
      setOpen(false)
    } catch {
      // api.invoke đã hiển thị lỗi; giữ modal mở để người dùng sửa.
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      wide
      title={
        <span className="modal-heading">
          <span className="modal-heading-icon"><Icon name="settings" size={19} /></span>
          <span>
            <strong>{t('Cài đặt ứng dụng', 'Application settings')}</strong>
            <small>{t('Cá nhân hóa không gian và hiệu năng xử lý', 'Personalize your workspace and processing performance')}</small>
          </span>
        </span>
      }
      onClose={requestClose}
      actions={
        <>
          <span className="settings-unsaved">{dirty ? t('Có thay đổi chưa lưu', 'Unsaved changes') : ''}</span>
          <button className="btn" disabled={saving} onClick={requestClose}>
            {t('Huỷ', 'Cancel')}
          </button>
          <button className="btn btn-primary" disabled={saving || !dirty} onClick={() => void save()}>
            {saving ? <span className="spin" /> : <Icon name="check" size={16} />}
            {saving ? t('Đang lưu...', 'Saving...') : t('Lưu thay đổi', 'Save changes')}
          </button>
        </>
      }
    >
      <div className="settings-grid">
        <section className="settings-section settings-section-wide appearance-section">
          <header>
            <span><Icon name="palette" size={18} /></span>
            <div>
              <strong>{t('Giao diện & màu chủ đạo', 'Appearance & accent color')}</strong>
              <small>{t('Màu được áp dụng đồng bộ cho toàn bộ công cụ sau khi lưu', 'Applied consistently across every tool after saving')}</small>
            </div>
          </header>
          <div className="accent-picker">
            <div
              className="accent-presets"
              role="radiogroup"
              aria-label={t('Màu chủ đạo có sẵn', 'Accent color presets')}
            >
              {ACCENT_PRESETS.map((preset) => {
                const selected = draft.accentColor === preset.value
                return (
                  <button
                    key={preset.value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    className={`accent-option${selected ? ' selected' : ''}`}
                    onClick={() => setDraft({ ...draft, accentColor: preset.value })}
                  >
                    <span className="accent-swatch" style={{ backgroundColor: preset.value }}>
                      {selected && <Icon name="check" size={15} />}
                    </span>
                    <span>{t(preset.vi, preset.en)}</span>
                  </button>
                )
              })}
            </div>
            <label className="accent-custom">
              <input
                type="color"
                value={draft.accentColor}
                aria-label={t('Chọn màu tùy chỉnh', 'Choose a custom color')}
                onChange={(event) => setDraft({ ...draft, accentColor: event.target.value.toUpperCase() })}
              />
              <span>
                <small>{t('Màu tùy chỉnh', 'Custom color')}</small>
                <b>{draft.accentColor}</b>
              </span>
            </label>
            <button
              type="button"
              className="btn btn-sm"
              disabled={draft.accentColor === DEFAULT_ACCENT_COLOR}
              onClick={() => setDraft({ ...draft, accentColor: DEFAULT_ACCENT_COLOR })}
            >
              <Icon name="refresh" size={15} />
              {t('Mặc định', 'Default')}
            </button>
          </div>
        </section>

        <section className="settings-section">
          <header>
            <span><Icon name="user" size={18} /></span>
            <div>
              <strong>{t('Tài khoản & bản quyền', 'Account & license')}</strong>
              <small>{t('Thông tin được xác thực từ máy chủ', 'Server-verified license details')}</small>
            </div>
          </header>
          <div className="license-summary">
            <div>
              <span>{t('Tài khoản', 'Username')}</span>
              <strong>{account?.username || '—'}</strong>
            </div>
            <div>
              <span>{t('Ngày hết hạn', 'Expires at')}</span>
              <strong>{account?.expiresAt
                ? new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(account.expiresAt))
                : '—'}</strong>
            </div>
            <div>
              <span>{t('Thời gian còn lại', 'Time remaining')}</span>
              <strong>{account ? t(`${account.remainingDays} ngày`, `${account.remainingDays} days`) : '—'}</strong>
            </div>
            <div>
              <span>{t('Mã thiết bị', 'Device ID')}</span>
              <code>{account?.hwid || '—'}</code>
            </div>
          </div>
        </section>

        <section className="settings-section">
          <header>
            <span><Icon name="folder" size={18} /></span>
            <div>
              <strong>{t('Thư mục & khởi động', 'Folders & startup')}</strong>
              <small>{t('Vị trí lưu mặc định cho các workflow', 'Default destinations for your workflows')}</small>
            </div>
          </header>
          <Field label={t('Thư mục xuất mặc định', 'Default output folder')} hint={t('Để trống để lưu cạnh file nguồn.', 'Leave empty to save next to the source file.')}>
            <FolderInput value={draft.outputDir} onChange={(value) => setDraft({ ...draft, outputDir: value })} />
          </Field>
          <Field label={t('Thư mục tải video', 'Video download folder')}>
            <FolderInput value={draft.downloadDir} onChange={(value) => setDraft({ ...draft, downloadDir: value })} />
          </Field>
          <div className="setting-toggle-row">
            <div>
              <strong>{t('Khởi động cùng Windows', 'Start with Windows')}</strong>
              <small>{t('Mở ANS Video Tools khi đăng nhập', 'Launch ANS Video Tools when you sign in')}</small>
            </div>
            <Check
              checked={draft.autoStart}
              onChange={(value) => setDraft({ ...draft, autoStart: value })}
              label={t('Bật', 'Enabled')}
            />
          </div>
        </section>

        <section className="settings-section settings-section-wide">
          <header>
            <span><Icon name="cpu" size={18} /></span>
            <div>
              <strong>{t('Hiệu năng xử lý', 'Processing performance')}</strong>
              <small>{t('Cân bằng tốc độ, CPU/GPU và số tác vụ song song', 'Balance throughput, CPU/GPU and concurrency')}</small>
            </div>
          </header>
          <div className="grid-3 settings-performance-grid">
            <Field label={t('Tác vụ FFmpeg song song', 'Parallel FFmpeg tasks')} hint={t('Giới hạn bởi số nhân CPU / 2.', 'Capped at half of your CPU cores.')}>
              <NumInput value={draft.maxFfmpeg} min={1} max={16} onChange={(value) => setDraft({ ...draft, maxFfmpeg: value })} />
            </Field>
            <Field label={t('Video tải cùng lúc', 'Concurrent downloads')}>
              <NumInput value={draft.maxDownloads} min={1} max={10} onChange={(value) => setDraft({ ...draft, maxDownloads: value })} />
            </Field>
            <Field label={t('Encoder ưu tiên', 'Preferred encoder')}>
              <Select
                value={draft.encoderPref}
                onChange={(value) => setDraft({ ...draft, encoderPref: value })}
                options={[
                  { value: 'auto', label: t('Tự động (khuyên dùng)', 'Auto (recommended)') },
                  { value: 'nvenc', label: 'NVIDIA NVENC' },
                  { value: 'qsv', label: 'Intel QuickSync' },
                  { value: 'amf', label: 'AMD AMF' },
                  { value: 'x264', label: 'CPU (libx264)' }
                ]}
              />
            </Field>
          </div>

          <div className="hardware-panel">
            <span className="hardware-icon"><Icon name="sparkles" size={18} /></span>
            <div className="hardware-copy">
              <strong>{t('Phần cứng đã xác minh', 'Verified hardware')}</strong>
              <span>{hw?.gpus.join(' · ') || t('Đang đọc thông tin GPU...', 'Reading GPU information...')}</span>
              <small>
                H264 <b>{hw?.best.h264 ?? '—'}</b>
                <i /> HEVC <b>{hw?.best.hevc ?? '—'}</b>
              </small>
            </div>
            <button
              className="btn btn-sm"
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
              {detecting ? <span className="spin" /> : <Icon name="refresh" size={15} />}
              {detecting ? t('Đang dò...', 'Detecting...') : t('Dò lại', 'Re-detect')}
            </button>
          </div>
        </section>
      </div>
    </Modal>
  )
}
