import { useState } from 'react'
import logoUrl from '../assets/ans-logo.png'
import { killAllFfmpeg } from '../api'
import { useT } from '../i18n'
import { useSettings } from '../store/settings'
import { useUi } from '../store/ui'
import { Modal } from './Modal'

export function Header(): React.JSX.Element {
  const t = useT()
  const license = useSettings((s) => s.settings?.license)
  const setSettingsOpen = useUi((s) => s.setSettingsOpen)
  const pushToast = useUi((s) => s.pushToast)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [killing, setKilling] = useState(false)

  const doKill = async (): Promise<void> => {
    setKilling(true)
    try {
      const r = await killAllFfmpeg()
      pushToast(
        'success',
        t(
          `Đã dừng ${r.cancelledTasks} tác vụ, kill ${r.killedProcesses} process`,
          `Stopped ${r.cancelledTasks} tasks, killed ${r.killedProcesses} processes`
        )
      )
    } finally {
      setKilling(false)
      setConfirmOpen(false)
    }
  }

  const hsd = license?.expiry
    ? new Date(license.expiry).toLocaleDateString('vi-VN')
    : t('Không giới hạn', 'Unlimited')

  return (
    <header className="header">
      <div className="brand">
        <span className="brand-mark" style={{ padding: 0, overflow: 'hidden' }}>
          <img
            src={logoUrl}
            alt="ANS"
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        </span>
        <span className="brand-name">
          <b>ANS</b> Video Tools
        </span>
      </div>
      <button className="btn btn-danger btn-sm" onClick={() => setConfirmOpen(true)}>
        ⛔ KILL ALL FFMPEG
      </button>
      <div className="spacer" />
      <div className="user-info">
        <span>
          {t('Xin chào', 'Hello')}, <b>{license?.username || 'User'}</b>
        </span>
        <span className="hsd-badge">HSD: {hsd}</span>
        <button className="btn btn-icon btn-ghost" title={t('Cài đặt', 'Settings')} onClick={() => setSettingsOpen(true)}>
          ⚙️
        </button>
      </div>

      {confirmOpen && (
        <Modal
          title={t('Dừng toàn bộ FFmpeg?', 'Kill all FFmpeg?')}
          onClose={() => setConfirmOpen(false)}
          actions={
            <>
              <button className="btn" onClick={() => setConfirmOpen(false)}>
                {t('Huỷ', 'Cancel')}
              </button>
              <button className="btn btn-danger" disabled={killing} onClick={() => void doKill()}>
                {killing ? t('Đang dừng...', 'Killing...') : t('Dừng tất cả', 'Kill all')}
              </button>
            </>
          }
        >
          <p className="text-dim">
            {t(
              'Mọi tác vụ FFmpeg đang chạy sẽ bị dừng ngay lập tức (bao gồm process mồ côi). Tác vụ tải video không bị ảnh hưởng.',
              'All running FFmpeg tasks will be terminated immediately (including orphaned processes). Downloads are not affected.'
            )}
          </p>
        </Modal>
      )}
    </header>
  )
}
