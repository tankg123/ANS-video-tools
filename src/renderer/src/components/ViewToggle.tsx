import { useT } from '../i18n'
import { Icon } from './Icon'

export type MediaViewMode = 'grid' | 'list'

export function ViewToggle({
  value,
  onChange
}: {
  value: MediaViewMode
  onChange(value: MediaViewMode): void
}): React.JSX.Element {
  const t = useT()

  return (
    <div
      className="media-view-toggle"
      role="group"
      aria-label={t('Kiểu hiển thị kho nội dung', 'Library view')}
    >
      <button
        type="button"
        className={value === 'grid' ? 'is-active' : undefined}
        aria-pressed={value === 'grid'}
        aria-label={t('Hiển thị dạng lưới', 'Grid view')}
        title={t('Hiển thị dạng lưới', 'Grid view')}
        onClick={() => onChange('grid')}
      >
        <Icon name="grid" size={14} />
        <span>{t('Lưới', 'Grid')}</span>
      </button>
      <button
        type="button"
        className={value === 'list' ? 'is-active' : undefined}
        aria-pressed={value === 'list'}
        aria-label={t('Hiển thị dạng danh sách', 'List view')}
        title={t('Hiển thị dạng danh sách', 'List view')}
        onClick={() => onChange('list')}
      >
        <Icon name="list" size={15} />
        <span>{t('Danh sách', 'List')}</span>
      </button>
    </div>
  )
}
