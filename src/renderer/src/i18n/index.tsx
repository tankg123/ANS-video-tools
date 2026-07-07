import { useCallback } from 'react'
import { useLang, useSettings } from '../store/settings'

/**
 * i18n tối giản, không file dịch tập trung để các module độc lập nhau:
 *   const t = useT()
 *   t('Tiếng Việt', 'English')
 * Ngôn ngữ mặc định VI (spec mục 1), chuyển VI/EN ở status bar.
 */
export type TFunc = (vi: string, en?: string) => string

export function useT(): TFunc {
  const lang = useLang()
  return useCallback<TFunc>((vi, en) => (lang === 'vi' ? vi : (en ?? vi)), [lang])
}

export function useToggleLang(): () => void {
  const update = useSettings((s) => s.update)
  const lang = useLang()
  return useCallback(() => {
    void update({ language: lang === 'vi' ? 'en' : 'vi' })
  }, [lang, update])
}
