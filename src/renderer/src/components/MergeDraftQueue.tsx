import { useId } from 'react'
import { useT } from '../i18n'
import { Icon } from './Icon'

export interface MergeDraftBase {
  id: string
  inputs: string[]
  createdAt: number
}

interface MergeDraftQueueProps<D extends MergeDraftBase> {
  drafts: readonly D[]
  submittingIds: ReadonlySet<string>
  /** Tên loại nội dung theo thứ tự [Tiếng Việt, English]. */
  mediaWord: [string, string]
  renderMedia(path: string, index: number, draft: D): React.ReactNode
  renderDetails?(draft: D): React.ReactNode
  onRun(draft: D): void
  onRemove(draft: D): void
  onRunAll(): void
  onClear(): void
}

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() || path
}

function formatTime(value: number): string {
  if (!Number.isFinite(value)) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function MergeDraftQueue<D extends MergeDraftBase>({
  drafts,
  submittingIds,
  mediaWord,
  renderMedia,
  renderDetails,
  onRun,
  onRemove,
  onRunAll,
  onClear
}: MergeDraftQueueProps<D>): React.JSX.Element {
  const t = useT()
  const headingId = useId()
  const mediaLabel = t(mediaWord[0], mediaWord[1])
  const isSubmitting = submittingIds.size > 0

  return (
    <section className="card merge-draft-card" aria-labelledby={headingId}>
      <div className="card-title" id={headingId}>
        <span className="card-title-icon">
          <Icon name="layers" size={16} />
        </span>
        {t('Hàng đợi bản ghép', 'Merge queue')}
        <span className="badge">{drafts.length}</span>
        <span className="right merge-draft-status">
          {isSubmitting ? (
            <span className="merge-draft-status-running" role="status">
              <span className="merge-draft-spinner" aria-hidden="true" />
              {t('Đang chuyển tác vụ sang xử lý', 'Sending jobs for processing')}
            </span>
          ) : (
            <span>{t('Chưa chạy', 'Not started')}</span>
          )}
        </span>
      </div>

      {drafts.length === 0 ? (
        <div className="empty-state merge-draft-empty">
          <div className="empty-icon">
            <Icon name="inbox" size={27} />
          </div>
          <strong>{t('Hàng đợi đang trống', 'The merge queue is empty')}</strong>
          <span>
            {t(
              'Bấm “Tạo bản ghép” để chuẩn bị tác vụ. Video và âm thanh chỉ bắt đầu xử lý khi bạn bấm Chạy.',
              'Choose “Create merge” to prepare a job. Processing starts only after you choose Run.'
            )}
          </span>
        </div>
      ) : (
        <>
          <div className="merge-draft-list" role="list">
            {drafts.map((draft, draftIndex) => {
              const submitting = submittingIds.has(draft.id)
              const time = formatTime(draft.createdAt)
              return (
                <article
                  className={submitting ? 'merge-draft-item is-submitting' : 'merge-draft-item'}
                  key={draft.id}
                  role="listitem"
                  aria-busy={submitting}
                >
                  <header className="merge-draft-item-head">
                    <span className="merge-draft-number" aria-hidden="true">
                      {String(draftIndex + 1).padStart(2, '0')}
                    </span>
                    <div className="merge-draft-summary">
                      <strong>{t(`Bản ghép #${draftIndex + 1}`, `Merge #${draftIndex + 1}`)}</strong>
                      <span>
                        {t(
                          `${draft.inputs.length} ${mediaWord[0]}`,
                          `${draft.inputs.length} ${mediaWord[1]}${draft.inputs.length === 1 ? '' : 's'}`
                        )}
                        {time ? ` · ${time}` : ''}
                      </span>
                    </div>
                    <div className="merge-draft-actions">
                      <button
                        type="button"
                        className="btn btn-sm btn-primary"
                        disabled={submitting}
                        aria-label={t(`Chạy bản ghép #${draftIndex + 1}`, `Run merge #${draftIndex + 1}`)}
                        onClick={() => onRun(draft)}
                      >
                        {submitting ? (
                          <span className="merge-draft-spinner" aria-hidden="true" />
                        ) : (
                          <Icon name="play" size={14} />
                        )}
                        {submitting ? t('Đang chạy', 'Starting') : t('Chạy', 'Run')}
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-stop"
                        disabled={submitting}
                        aria-label={t(`Xóa bản ghép #${draftIndex + 1}`, `Delete merge #${draftIndex + 1}`)}
                        onClick={() => onRemove(draft)}
                      >
                        <Icon name="trash" size={14} />
                        {t('Xóa', 'Delete')}
                      </button>
                    </div>
                  </header>

                  <div
                    className="merge-draft-sequence"
                    aria-label={t(
                      `Thứ tự ${mediaLabel} trong bản ghép #${draftIndex + 1}`,
                      `${mediaLabel} order in merge #${draftIndex + 1}`
                    )}
                    tabIndex={draft.inputs.length > 4 ? 0 : undefined}
                  >
                    {draft.inputs.map((path, inputIndex) => (
                      <div className="merge-draft-sequence-part" key={`${inputIndex}-${path}`}>
                        {inputIndex > 0 && (
                          <span className="merge-draft-connector" aria-hidden="true">
                            <Icon name="chevron-right" size={15} />
                          </span>
                        )}
                        <div className="merge-draft-media" title={path}>
                          <span className="merge-draft-media-index">{inputIndex + 1}</span>
                          <div className="merge-draft-media-preview">
                            {renderMedia(path, inputIndex, draft)}
                          </div>
                          <span className="merge-draft-media-name">{baseName(path)}</span>
                        </div>
                      </div>
                    ))}
                  </div>

                  {renderDetails && <div className="merge-draft-details">{renderDetails(draft)}</div>}
                </article>
              )
            })}
          </div>

          <footer className="merge-draft-footer">
            <span>
              {t(
                `${drafts.length} bản ghép đã sẵn sàng trong hàng đợi`,
                `${drafts.length} ${drafts.length === 1 ? 'merge is' : 'merges are'} ready in the queue`
              )}
            </span>
            <div className="merge-draft-footer-actions">
              <button
                type="button"
                className="btn btn-sm btn-ghost merge-draft-clear"
                disabled={isSubmitting}
                onClick={onClear}
              >
                <Icon name="trash" size={14} />
                {t('Xóa hàng đợi', 'Clear queue')}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={isSubmitting}
                onClick={onRunAll}
              >
                {isSubmitting ? (
                  <span className="merge-draft-spinner" aria-hidden="true" />
                ) : (
                  <Icon name="play" size={15} />
                )}
                {isSubmitting
                  ? t('Đang chuyển tác vụ...', 'Starting jobs...')
                  : t(`Chạy tất cả (${drafts.length})`, `Run all (${drafts.length})`)}
              </button>
            </div>
          </footer>
        </>
      )}
    </section>
  )
}
