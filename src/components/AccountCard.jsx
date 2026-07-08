/* ============================================
   Diamond Lineup - Account & Sync card (Settings)
   ============================================ */

import React from 'react';
import { AppContext } from '../state/AppContext';

const STATUS_DISPLAY = {
  signedOut: { label: 'Not syncing', color: 'var(--text-tertiary)' },
  syncing: { label: 'Syncing…', color: 'var(--warning)' },
  synced: { label: 'Synced', color: 'var(--success)' },
  error: { label: 'Sync error - working locally', color: 'var(--danger)' }
};

export function AccountCard() {
  const { user, syncStatus, signIn, signUp, signOut, syncNow, showToast } = React.useContext(AppContext);
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(null);

  const runAuth = async (fn, successMessage) => {
    setError(null);
    setBusy(true);
    try {
      const result = await fn();
      if (result?.needsConfirmation) {
        showToast('Check your email to confirm your account, then sign in');
      } else if (successMessage) {
        showToast(successMessage);
      }
      setPassword('');
    } catch (e) {
      setError(e.message || 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const status = STATUS_DISPLAY[syncStatus] || STATUS_DISPLAY.signedOut;

  return (
    <div className="card">
      <div className="card-header">
        <div>
          <div className="card-title">Account & Sync</div>
          {user && (
            <div className="card-subtitle">
              <span style={{ color: status.color }}>●</span> {status.label}
            </div>
          )}
        </div>
      </div>
      <div className="card-body">
        {user ? (
          <>
            <p className="text-small mb-md">
              Signed in as <strong>{user.email}</strong>. Changes on this device sync
              to your account automatically; open the app on another device and sign
              in to pick up where you left off.
            </p>
            <div style={{ display: 'flex', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
              <button
                className="btn btn-secondary"
                disabled={busy || syncStatus === 'syncing'}
                onClick={() => runAuth(syncNow)}
              >
                🔄 Sync Now
              </button>
              <button
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => runAuth(signOut)}
              >
                Sign Out
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-muted text-small mb-md">
              Create a free account to sync your team between devices - set the lineup
              on your computer, run the game from your phone. Without an account,
              everything still works and stays on this device.
            </p>
            <div className="form-group">
              <label className="form-label">Email</label>
              <input
                type="email"
                className="form-input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="coach@example.com"
                autoComplete="email"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Password</label>
              <input
                type="password"
                className="form-input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 6 characters"
                autoComplete="current-password"
              />
            </div>
            {error && (
              <p className="text-small text-danger mb-md">{error}</p>
            )}
            <div style={{ display: 'flex', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
              <button
                className="btn btn-primary"
                disabled={busy || !email || !password}
                onClick={() => runAuth(() => signIn(email, password), 'Signed in')}
              >
                Sign In
              </button>
              <button
                className="btn btn-secondary"
                disabled={busy || !email || !password}
                onClick={() => runAuth(() => signUp(email, password))}
              >
                Create Account
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
