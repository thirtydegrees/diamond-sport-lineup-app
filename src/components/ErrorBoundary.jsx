/* ============================================
   Diamond Lineup - Error Boundary

   A render crash must never white-screen a coach mid-game.
   Data lives in localStorage and is untouched by a render
   error, so the recovery screen can honestly say so.
   ============================================ */

import React from 'react';

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('App crash:', error, info);
  }

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif'
      }}>
        <div style={{ textAlign: 'center', maxWidth: '420px' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>⚾</div>
          <h1 style={{ fontSize: '20px', marginBottom: '8px' }}>Something went wrong</h1>
          <p style={{ color: '#86868B', marginBottom: '20px' }}>
            Your roster, games, and pitch history are saved on this device and are not affected.
            Reload to pick up where you left off.
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              background: '#007AFF',
              color: 'white',
              border: 'none',
              borderRadius: '10px',
              padding: '12px 24px',
              fontSize: '16px',
              fontWeight: 500,
              cursor: 'pointer'
            }}
          >
            Reload App
          </button>
          <details style={{ marginTop: '20px', textAlign: 'left' }}>
            <summary style={{ color: '#86868B', cursor: 'pointer', fontSize: '13px' }}>
              Technical details
            </summary>
            <pre style={{
              fontSize: '11px',
              color: '#86868B',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              marginTop: '8px'
            }}>
              {String(this.state.error?.stack || this.state.error)}
            </pre>
          </details>
        </div>
      </div>
    );
  }
}
