import { FormEvent, useEffect, useState } from 'react'
import logoUrl from '../assets/ans-logo.png'
import { cleanError } from '../api'
import { useT } from '../i18n'
import { useAuth } from '../store/auth'
import { Icon } from './Icon'

export function LoginScreen(): React.JSX.Element {
  const t = useT()
  const status = useAuth((state) => state.status)
  const initialError = useAuth((state) => state.error)
  const reason = useAuth((state) => state.reason)
  const signIn = useAuth((state) => state.login)
  const retryInit = useAuth((state) => state.init)

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(initialError)

  useEffect(() => {
    setError(initialError)
  }, [initialError])

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    const normalizedUsername = username.trim()
    if (!normalizedUsername) {
      setError(t('Vui lòng nhập tài khoản.', 'Please enter your username.'))
      return
    }
    if (!password) {
      setError(t('Vui lòng nhập mật khẩu.', 'Please enter your password.'))
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      await signIn(normalizedUsername, password)
    } catch (loginError) {
      setError(cleanError(loginError))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="login-shell">
      <section className="login-card" aria-labelledby="login-title">
        <div className="login-brand">
          <span className="login-logo"><img src={logoUrl} alt="ANS Studio" /></span>
          <span>
            <strong>ANS Video Tools</strong>
            <small>ANS STUDIO</small>
          </span>
        </div>

        <div className="login-heading">
          <span className="login-shield"><Icon name="shield" size={24} /></span>
          <div>
            <h1 id="login-title">{t('Đăng nhập để sử dụng', 'Sign in to continue')}</h1>
            <p>{t(
              'Tài khoản phải còn hạn và được cấp phép cho đúng thiết bị này.',
              'Your account must be active and licensed for this device.'
            )}</p>
          </div>
        </div>

        {reason === 'expired' && (
          <div className="login-notice" role="status">
            <Icon name="alert" size={18} />
            <span>{t('Gói sử dụng đã hết hạn. Vui lòng gia hạn trước khi đăng nhập lại.', 'Your license has expired. Renew it before signing in again.')}</span>
          </div>
        )}

        <form className="login-form" onSubmit={(event) => void submit(event)}>
          <div className="field">
            <label className="field-label" htmlFor="auth-username">{t('Tài khoản', 'Username')}</label>
            <span className="login-input-wrap">
              <Icon name="user" size={17} />
              <input
                className="input"
                id="auth-username"
                value={username}
                maxLength={128}
                autoComplete="username"
                autoFocus
                disabled={submitting}
                placeholder={t('Nhập tài khoản ANS', 'Enter your ANS username')}
                onChange={(event) => setUsername(event.target.value)}
              />
            </span>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="auth-password">{t('Mật khẩu', 'Password')}</label>
            <span className="login-input-wrap login-password-wrap">
              <Icon name="shield" size={17} />
              <input
                className="input"
                id="auth-password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                maxLength={1024}
                autoComplete="current-password"
                disabled={submitting}
                placeholder={t('Nhập mật khẩu', 'Enter your password')}
                onChange={(event) => setPassword(event.target.value)}
              />
              <button
                type="button"
                className="login-password-toggle"
                disabled={submitting}
                onClick={() => setShowPassword((value) => !value)}
              >
                {showPassword ? t('Ẩn', 'Hide') : t('Hiện', 'Show')}
              </button>
            </span>
          </div>

          {error && (
            <div className="login-error" role="alert">
              <Icon name="alert" size={18} />
              <span>{error}</span>
            </div>
          )}

          <button className="btn btn-primary login-submit" type="submit" disabled={submitting}>
            {submitting ? <span className="spin" /> : <Icon name="shield" size={17} />}
            {submitting ? t('Đang xác thực...', 'Signing in...') : t('Đăng nhập', 'Sign in')}
          </button>
        </form>

        {!status && (
          <button
            className="btn btn-sm login-retry"
            type="button"
            disabled={submitting}
            onClick={() => void retryInit()}
          >
            <Icon name="refresh" size={14} /> {t('Thử lại kiểm tra tài khoản', 'Retry account check')}
          </button>
        )}

        <p className="login-footnote">
          <Icon name="shield" size={14} />
          {t(
            'Thông tin đăng nhập được Windows mã hóa và ghi nhớ tối đa 48 giờ trên máy này.',
            'Your sign-in is encrypted by Windows and remembered on this device for up to 48 hours.'
          )}
        </p>
      </section>
    </main>
  )
}
