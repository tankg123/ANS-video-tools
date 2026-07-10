/** value: 0..100, hoặc -1 = indeterminate */
export function ProgressBar({ value, label }: { value: number; label?: string }): React.JSX.Element {
  const indet = value < 0
  const normalized = Math.min(100, Math.max(0, value))
  return (
    <div className="progress-row">
      <div
        className={`progress grow${indet ? ' indeterminate' : ''}`}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={indet ? undefined : normalized}
      >
        <i style={{ width: indet ? undefined : `${normalized}%` }} />
      </div>
      {label !== undefined && <span className="progress-label">{label}</span>}
      {label === undefined && !indet && (
        <span className="progress-label">{Math.floor(normalized)}%</span>
      )}
    </div>
  )
}
