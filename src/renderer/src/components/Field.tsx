import { ReactNode, useEffect, useRef, useState } from 'react'
import { pickFolder } from '../api'
import { useT } from '../i18n'

export function Field({ label, children, hint }: { label: ReactNode; children: ReactNode; hint?: string }): React.JSX.Element {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </div>
  )
}

export function Select<T extends string | number>({
  value,
  onChange,
  options,
  disabled
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
  disabled?: boolean
}): React.JSX.Element {
  return (
    <select
      className="input"
      value={String(value)}
      disabled={disabled}
      onChange={(e) => {
        const raw = e.target.value
        const opt = options.find((o) => String(o.value) === raw)
        if (opt) onChange(opt.value)
      }}
    >
      {options.map((o) => (
        <option key={String(o.value)} value={String(o.value)}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

export function NumInput({
  value,
  onChange,
  min,
  max,
  step,
  disabled
}: {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  disabled?: boolean
}): React.JSX.Element {
  // Giữ text thô khi đang gõ để không clamp từng phím (vd min=200 sẽ gõ được "2", "20"...)
  const [text, setText] = useState(Number.isFinite(value) ? String(value) : '')
  const focused = useRef(false)

  // Đồng bộ lại khi value đổi từ ngoài (không đè khi đang gõ)
  useEffect(() => {
    if (!focused.current) setText(Number.isFinite(value) ? String(value) : '')
  }, [value])

  // Clamp + báo giá trị cuối cùng khi blur/Enter
  const commit = (): void => {
    let v = parseFloat(text)
    if (Number.isNaN(v)) v = min ?? 0
    if (min !== undefined) v = Math.max(min, v)
    if (max !== undefined) v = Math.min(max, v)
    setText(String(v))
    onChange(v)
  }

  return (
    <input
      type="number"
      className="input"
      value={text}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      onFocus={() => {
        focused.current = true
      }}
      onChange={(e) => {
        const raw = e.target.value
        setText(raw)
        // Đang gõ mà đã hợp lệ trong range → báo luôn cho mượt
        const v = parseFloat(raw)
        if (!Number.isNaN(v) && (min === undefined || v >= min) && (max === undefined || v <= max)) {
          onChange(v)
        }
      }}
      onBlur={() => {
        focused.current = false
        commit()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
      }}
    />
  )
}

export function Check({
  checked,
  onChange,
  label,
  disabled
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: ReactNode
  disabled?: boolean
}): React.JSX.Element {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  )
}

/** Ô chọn thư mục có nút Browse. */
export function FolderInput({
  value,
  onChange,
  placeholder
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}): React.JSX.Element {
  const t = useT()
  return (
    <div className="input-row">
      <input className="input" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      <button
        className="btn"
        onClick={async () => {
          const dir = await pickFolder()
          if (dir) onChange(dir)
        }}
      >
        {t('Chọn...', 'Browse...')}
      </button>
    </div>
  )
}
