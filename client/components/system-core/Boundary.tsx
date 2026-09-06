"use client"

// Keeps a failed WebGL context or a bad scene build inside the canvas layer,
// so the window manager and chrome above it stay usable.
//
// DIVERGENCE FROM THE REFERENCE: there, the core lived in a modal and the
// boundary needed no reset path — "the dialog unmounts its body on close, so
// reopening mounts a fresh boundary along with a fresh renderer". Here the core
// is the persistent landing surface and never unmounts, so a lost context would
// be permanent. `retry` remounts the subtree by changing a key.

import React from "react"

interface BoundaryProps {
  children: React.ReactNode
  fallback: (retry: () => void) => React.ReactNode
}

interface BoundaryState {
  hasError: boolean
  /** Bumped on retry to force a fresh subtree, and so a fresh renderer. */
  attempt: number
}

export default class Boundary extends React.Component<BoundaryProps, BoundaryState> {
  constructor(props: BoundaryProps) {
    super(props)
    this.state = { hasError: false, attempt: 0 }
  }

  static getDerivedStateFromError(): Partial<BoundaryState> {
    return { hasError: true }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("System Core rendering error:", error, errorInfo)
  }

  private retry = () => {
    this.setState((s) => ({ hasError: false, attempt: s.attempt + 1 }))
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback(this.retry)
    }
    return <React.Fragment key={this.state.attempt}>{this.props.children}</React.Fragment>
  }
}
