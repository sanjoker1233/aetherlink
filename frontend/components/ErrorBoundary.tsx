'use client'

import { Component } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { GlassCard } from '@/components/ui/GlassCard'
import { GlassButton } from '@/components/ui/GlassButton'

interface Props {
  children: React.ReactNode
}

interface State {
  hasError: boolean
  error?: Error
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center min-h-[400px] p-8">
          <GlassCard variant="neon" hover={false} className="p-8 max-w-md text-center">
            <AlertTriangle size={48} className="text-rose-500 mx-auto mb-4" />
            <h2 className="text-lg font-semibold mb-2">An error occurred</h2>
            <p className="text-sm text-gray-400 mb-4">
              {this.state.error?.message || 'Unexpected error'}
            </p>
            <GlassButton variant="primary" onClick={() => this.setState({ hasError: false, error: undefined })} icon={<RefreshCw size={14} />}>
              Retry
            </GlassButton>
          </GlassCard>
        </div>
      )
    }
    return this.props.children
  }
}
