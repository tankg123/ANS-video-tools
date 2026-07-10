import { useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import logoUrl from '../assets/ans-logo.png'
import { killAllFfmpeg } from '../api'
import { useT } from '../i18n'
import { MODULES } from '../modules/registry'
import { useSettings } from '../store/settings'
import { useTasks } from '../store/tasks'
import { useUi } from '../store/ui'
import { Icon } from './Icon'
import { Modal } from './Modal'

export function Header(): React.JSX.Element {
  const t = useT()
  const active = useUi((s) => s.active)
  const license = useSettings((s) => s.settings?.license)
  const setSettingsOpen = useUi((s) => s.setSettingsOpen)
  const pushToast = useUi((s) => s.pushToast)
  const activity = useTasks(
    useShallow((s) => {
      let running = 0
      let queued = 0
      for (const id of s.order) {
        const task = s.byId[id]
        if (!task) continue
        if (task.status === 'running') running++
        if (task.status === 'queued') queued++
      }
      return { running, queued }
    })
  )
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [killing, setKilling] = useState(false)

  const currentModule = MODULES.find((module) => module.key === active) ?? MODULES[0]
  const activeJobs = activity.running + activity.queued
  const username = license?.username?.trim() || 'ANS User'
  const initials = username
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')
  const expiry = license?.expiry
    ? new Date(license.expiry).toLocaleDateString('vi-VN')
    : t('Không giới hạn', 'Unlimited')

  const doKill = async (): Promise<void> => {
    setKilling(true)
    try {
      const result = await killAllFfmpeg()
      pushToast(
        'success',
        t(
          `Đã dừng ${result.cancelledTasks} tác vụ và ${result.killedProcesses} tiến trình`,
          `Stopped ${result.cancelledTasks} tasks and ${result.killedProcesses} processes`
        )
      )
      setConfirmOpen(false)
    } finally {
      setKilling(false)
    }
  }

  return (
    <header className="header">
      <div className="brand">
        <span className="brand-mark">
          <img src={logoUrl} alt="ANS Studio" />
        </span>
        <span className="brand-copy">
          <strong>ANS Video Tools</strong>
          <small>{t('Creative desktop suite', 'Creative desktop suite')}</small>
        </span>
      </div>

      <div className="header-context" title={t(currentModule.vi, currentModule.en)}>
        <span>{t('Không gian làm việc', 'Workspace')}</span>
        <Icon name="chevron-right" size={14} />
        <Icon name={currentModule.icon} size={16} />
        <strong>{t(currentModule.vi, currentModule.en)}</strong>
      </div>

      <div className="spacer" />

      <div className={`job-pill${activeJobs ? ' busy' : ''}`}>
        <span className="job-dot" />
        <Icon name="activity" size={16} />
        <span>
          {activeJobs
            ? t(`${activity.running} đang chạy · ${activity.queued} chờ`, `${activity.running} running · ${activity.queued} queued`)
            : t('Hệ thống sẵn sàng', 'System ready')}
        </span>
      </div>

      <button
        className="btn btn-stop btn-sm kill-ffmpeg-button"
        disabled={killing}
        title={t('Dừng toàn bộ tiến trình FFmpeg', 'Stop every FFmpeg process')}
        onClick={() => setConfirmOpen(true)}
      >
        <Icon name="stop" size={15} />
        KILL FFMPEG
      </button>

      <div className="user-info">
        <span className="user-avatar">{initials || 'A'}</span>
        <span className="user-copy">
          <b>{username}</b>
          <small>{t('HSD', 'License')}: {expiry}</small>
        </span>
        <button
          className="btn btn-icon btn-ghost settings-trigger"
          title={t('Cài đặt', 'Settings')}
          aria-label={t('Mở cài đặt', 'Open settings')}
          onClick={() => setSettingsOpen(true)}
        >
          <Icon name="settings" size={18} />
        </button>
      </div>

      {confirmOpen && (
        <Modal
          title={t('KILL toàn bộ tiến trình FFmpeg?', 'KILL all FFmpeg processes?')}
          closeDisabled={killing}
          onClose={() => setConfirmOpen(false)}
          actions={
            <>
              <button className="btn" disabled={killing} onClick={() => setConfirmOpen(false)}>
                {t('Quay lại', 'Go back')}
              </button>
              <button className="btn btn-danger" disabled={killing} onClick={() => void doKill()}>
                <Icon name="stop" size={16} />
                {killing ? t('Đang dừng...', 'Stopping...') : 'KILL FFMPEG'}
              </button>
            </>
          }
        >
          <div className="dialog-callout danger">
            <Icon name="alert" size={20} />
            <p>
              {t(
                'Các tác vụ xử lý video đang chạy và đang chờ sẽ dừng ngay. Tác vụ tải video không bị ảnh hưởng.',
                'Running and queued video-processing tasks will stop immediately. Video downloads are not affected.'
              )}
            </p>
          </div>
        </Modal>
      )}
    </header>
  )
}
