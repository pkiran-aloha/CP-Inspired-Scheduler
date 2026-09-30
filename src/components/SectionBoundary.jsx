import React from 'react'

// Keep navigation available if a routed section fails to render.
export default class SectionBoundary extends React.Component {
  state = { failed: false }

  static getDerivedStateFromError() { return { failed: true } }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="panel" role="alert" style={{ margin: 24, padding: 24 }}>
        <h2>This section could not be displayed</h2>
        <p>Your workspace has not been cleared. Try again or choose another section.</p>
        <button className="btn btn-primary" onClick={() => this.setState({ failed: false })}>Retry</button>
      </div>
    )
  }
}
