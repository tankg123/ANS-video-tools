/** value: 0..100, hoặc -1 = indeterminate (livestream) */
export function ProgressBar({ value, label }: { value: number; label?: string }): React.JSX.Element {
  const indet = value < 0
  return (
    <div className="row" style={{ minWidth: 120 }}>
      <div className={`progress grow${indet ? ' indeterminate' : ''}`}>
        <i style={{ width: indet ? undefined : `${Math.min(100, Math.max(0, value))}%` }} />
      </div>
      {label !== undefined && <span className="progress-label">{label}</span>}
      {label === undefined && !indet && (
        <span className="progress-label">{Math.floor(value)}%</span>
      )}
    </div>
  )
}
