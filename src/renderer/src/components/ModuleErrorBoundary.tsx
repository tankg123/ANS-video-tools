import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Icon } from './Icon'

interface Props {
  children: ReactNode
  title: string
  description: string
  retryLabel: string
}

interface State {
  error: Error | null
}

export class ModuleErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Module renderer failed', error, info.componentStack)
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div className="module-error" role="alert">
        <span className="module-error-icon"><Icon name="alert" size={28} /></span>
        <div>
          <strong>{this.props.title}</strong>
          <p>{this.props.description}</p>
          <pre>{this.state.error.message}</pre>
          <button
            className="btn btn-primary"
            onClick={() => window.location.reload()}
          >
            <Icon name="refresh" size={16} />
            {this.props.retryLabel}
          </button>
        </div>
      </div>
    )
  }
}
