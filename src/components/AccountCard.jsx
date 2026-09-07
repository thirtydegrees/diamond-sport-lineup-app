/* ============================================
   Diamond Lineup - Account & Sync card (Settings)

   One account can run several teams (the 10U team and the 7U
   team). The card shows which team this device is working with,
   lets the coach switch (replacing local data with that team's
   cloud copy - never merging), and creates additional teams.
   ============================================ */

import React from 'react';
import { AppContext } from '../state/AppContext';
import { Sync } from '../services/sync';
import { getPreset, getPresetsForSport } from '../domain/presets';
import { ConfirmDialog } from './ui';

const STATUS_DISPLAY = {
  signedOut: { label: 'Not syncing', color: 'var(--text-tertiary)' },
  syncing: { label: 'Syncing…', color: 'var(--warning)' },
  synced: { label: 'Synced', color: 'var(--success)' },
  error: { label: 'Sync error - working locally', color: 'var(--danger)' }
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Mirrors the Supabase project's password policy (configure the same
// minimum under Authentication -> Policies). Supabase remains the
// authoritative enforcer; this just gives instant feedback.
const MIN_PASSWORD_LENGTH = 8;

export function AccountCard() {
  const {
    user, syncStatus, provisioningError, settings, setSettings,
    signIn, signUp, signOut, syncNow, switchTeam,
    resetPassword, resendConfirmation, showToast
  } = React.useContext(AppContext);

  const [displayName, setDisplayName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(null);
  // Durable "check your email" state (not just a vanishing toast)
  const [pendingConfirmEmail, setPendingConfirmEmail] = React.useState(null);
  const [confirmSignOut, setConfirmSignOut] = React.useState(false);

  // Teams
  const [rename, setRename] = React.useState('');
  const [teamType, setTeamType] = React.useState(settings.sport);
  const [presetId, setPresetId] = React.useState(settings.pitchRulePreset);
  const [teams, setTeams] = React.useState(null);
  const [newTeamName, setNewTeamName] = React.useState('');
  const [showNewTeam, setShowNewTeam] = React.useState(false);
  const currentTeam = Sync.currentTeam;

  React.useEffect(() => {
    let cancelled = false;
    if (user && syncStatus !== 'signedOut' && syncStatus !== 'error') {
      Sync.listTeams()
        .then(list => { if (!cancelled) setTeams(list); })
        .catch(() => { if (!cancelled) setTeams(null); });
    }
    return () => { cancelled = true; };
  }, [user, syncStatus === 'synced']); // eslint-disable-line react-hooks/exhaustive-deps

  const validateInputs = () => {
    if (!EMAIL_RE.test(email.trim())) {
      setError('Enter a valid email address');
      return false;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
      return false;
    }
    return true;
  };

  const runAuth = async (fn, successMessage, validate = false) => {
    setError(null);
    if (validate && !validateInputs()) return;
    setBusy(true);
    try {
      const result = await fn();
      if (result?.needsConfirmation) {
        setPendingConfirmEmail(email.trim());
      } else if (successMessage) {
        showToast(successMessage);
      }
      setPassword('');
      return result;
    } catch (e) {
      setError(e.message || 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const handleSignOut = async (force = false) => {
    setError(null);
    setBusy(true);
    try {
      const result = await signOut({ force });
      if (result?.pending) {
        setConfirmSignOut(true);
      } else {
        setTeams(null);
      }
    } catch {
      // signOut already surfaced the failure
    } finally {
      setBusy(false);
    }
  };

  const handleForgotPassword = async () => {
    setError(null);
    if (!EMAIL_RE.test(email.trim())) {
      setError('Enter your email above first, then tap "Forgot password"');
      return;
    }
    setBusy(true);
    try {
      await resetPassword(email);
      showToast('Password reset email sent - check your inbox');
    } catch (e) {
      setError(e.message || 'Could not send the reset email');
    } finally {
      setBusy(false);
    }
  };

  const handleSwitchTeam = async (team) => {
    setError(null);
    setBusy(true);
    try {
      await switchTeam(team);
    } catch (e) {
      setError(e.message || 'Team switch failed');
    } finally {
      setBusy(false);
    }
  };

  const handleCreateTeam = async () => {
    if (!newTeamName.trim()) return;
    setError(null);
    setBusy(true);
    try {
      const team = await Sync.createTeam(newTeamName);
      setShowNewTeam(false);
      setNewTeamName('');
      await switchTeam(team);
      setTeams(await Sync.listTeams());
    } catch (e) {
      setError(e.message || 'Could not create the team');
    } finally {
      setBusy(false);
    }
  };

  const status = STATUS_DISPLAY[syncStatus] || {label: syncStatus === 'conflict' ? 'Conflict: edits preserved' : 'Changes pending', color: 'var(--warning)'};
  const syncError = syncStatus === 'error' ? (provisioningError || Sync.lastError) : null;
  const otherTeams = (teams || []).filter(t => t.id !== currentTeam?.id);

  return (
    <div className="card">
      <div className="card-header">
        <div>
          <div className="card-title">Account & Sync</div>
          {user && (
            <div className="card-subtitle">
              <span style={{ color: status.color }}>●</span> {status.label}
              {currentTeam && <> · Team: <strong>{currentTeam.name}</strong></>}
            </div>
          )}
        </div>
      </div>
      <div className="card-body">
        {Sync.recoveryCopies().length>0 && <details><summary>Recovery copies on this device</summary>{Sync.recoveryCopies().map(copy=><button className="btn btn-secondary" key={copy.key} onClick={()=>{const url=URL.createObjectURL(new Blob([JSON.stringify({app:'diamond-lineup',version:2,exportDate:new Date().toISOString(),data:copy.data},null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`diamond-recovery-${copy.key.slice(13)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}}>Download {copy.teamName} recovery</button>)}</details>}

        {user ? (
          <>
            <p className="text-small mb-md">
              Signed in as <strong>{user.email}</strong>. Changes on this device sync
              to the team shown above; sign in on another device to pick up where
              you left off.
            </p>
            {syncError && (
              <p className="text-small mb-md" style={{ color: 'var(--danger)' }}>
                {syncError}. Your data is safe on this device - use Sync Now to retry.
              </p>
            )}
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
                onClick={() => handleSignOut(false)}
              >
                Sign Out
              </button>
            </div>

            {syncStatus === 'conflict' && <div role="alert"><p>{Sync.lastError}</p><p>Download your local backup below before loading the cloud copy. A recovery copy also stays on this device.</p><button className="btn btn-secondary" onClick={async()=>{try{await Sync.useCloudCopy();}catch(e){setError(e.message);}}}>Load Cloud Copy</button></div>}
            <p className="text-small">Sync Now checks for cloud changes and sends pending edits. Offline edits stay on this device; simultaneous edits require review.</p><p className="text-small">Last checked: {Sync.lastPulledAt ? new Date(Sync.lastPulledAt).toLocaleTimeString() : 'Not yet'}</p>
            <div className="form-group"><label className="form-label">Team name</label><input className="form-input" value={rename} placeholder={currentTeam?.name || 'Team name'} onChange={e=>setRename(e.target.value)}/><button className="btn btn-secondary" disabled={!rename.trim() || busy} onClick={async()=>{setBusy(true);try{await Sync.renameTeam(rename);setRename('');}catch(e){setError(e.message);}finally{setBusy(false);}}}>Rename Team</button></div>
            {!settings.onboardingComplete && currentTeam && <div className="card"><div className="card-body"><strong>Set up this team</strong><p className="text-small">Rename your team above, then choose its sport and age/rules group. You can adjust rules in Settings.</p><select aria-label="Team sport" className="form-select" value={teamType} onChange={e=>{setTeamType(e.target.value);setPresetId(getPresetsForSport(e.target.value)[0].id);}}><option value="baseball">Baseball</option><option value="softball">Softball</option></select><select aria-label="Team rules" className="form-select" value={presetId} onChange={e=>setPresetId(e.target.value)}>{getPresetsForSport(teamType).map(p=><option key={p.id} value={p.id}>{p.label}</option>)}</select><button className="btn btn-primary" onClick={()=>setSettings({...settings,sport:teamType,teamType,pitchRulePreset:presetId,pitchRules:structuredClone(getPreset(presetId).rules),onboardingComplete:true})}>Save Team Setup</button></div></div>}
            {/* Teams */}
            <div style={{ marginTop: 'var(--space-md)', paddingTop: 'var(--space-md)', borderTop: '1px solid var(--border-light)' }}>
              <div className="text-muted text-small" style={{ marginBottom: '6px' }}>
                Your teams {otherTeams.length === 0 && teams !== null ? '(just this one so far)' : ''}
              </div>
              {otherTeams.map(team => (
                <div key={team.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 0' }}>
                  <span className="text-small" style={{ flex: 1 }}>{team.name}</span>
                  <button
                    className="btn btn-sm btn-secondary"
                    disabled={busy || syncStatus === 'syncing'}
                    onClick={() => handleSwitchTeam(team)}
                  >
                    Switch
                  </button>
                </div>
              ))}
              {showNewTeam ? (
                <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
                  <input
                    type="text"
                    className="form-input"
                    style={{ flex: 1 }}
                    placeholder="e.g. Red Sox 8U"
                    value={newTeamName}
                    autoFocus
                    onChange={(e) => setNewTeamName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleCreateTeam(); }}
                  />
                  <button className="btn btn-sm btn-primary" disabled={busy || !newTeamName.trim()} onClick={handleCreateTeam}>
                    Create
                  </button>
                  <button className="btn btn-sm btn-ghost" onClick={() => setShowNewTeam(false)}>✕</button>
                </div>
              ) : (
                <button className="btn btn-sm btn-ghost" style={{ marginTop: '4px' }} onClick={() => setShowNewTeam(true)}>
                  + New Team
                </button>
              )}
              <p className="form-hint" style={{ marginTop: '6px' }}>
                Switching replaces this device's data with that team's cloud copy.
                Each team's roster, games, and workload stay completely separate.
              </p>
            </div>
            {error && (
              <p className="text-small text-danger" style={{ marginTop: 'var(--space-sm)' }}>{error}</p>
            )}
          </>
        ) : pendingConfirmEmail ? (
          <>
            <p className="text-small mb-md">
              📬 Almost there - we sent a confirmation link to{' '}
              <strong>{pendingConfirmEmail}</strong>. Open it, then come back and
              sign in.
            </p>
            <div style={{ display: 'flex', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
              <button
                className="btn btn-secondary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await resendConfirmation(pendingConfirmEmail);
                    showToast('Confirmation email re-sent');
                  } catch (e) {
                    setError(e.message || 'Could not resend');
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Resend Email
              </button>
              <button className="btn btn-ghost" onClick={() => setPendingConfirmEmail(null)}>
                Back to Sign In
              </button>
            </div>
            {error && <p className="text-small text-danger" style={{ marginTop: '8px' }}>{error}</p>}
          </>
        ) : (
          <>
            <p className="text-muted text-small mb-md">
              Create a free account to sync your team between devices - set the lineup
              on your computer, run the game from your phone. Without an account,
              everything still works and stays on this device.
            </p>
            <div className="form-group"><label className="form-label">Display name (optional, for a new account)</label><input className="form-input" value={displayName} onChange={e=>setDisplayName(e.target.value)} autoComplete="name" /></div>
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
                placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
                autoComplete="current-password"
              />
            </div>
            {error && (
              <p className="text-small text-danger mb-md">{error}</p>
            )}
            <div style={{ display: 'flex', gap: 'var(--space-sm)', flexWrap: 'wrap', alignItems: 'center' }}>
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
                onClick={() => runAuth(() => signUp(email, password, displayName), 'Account created - syncing this device', true)}
              >
                Create Account
              </button>
              <button className="btn btn-ghost btn-sm" disabled={busy} onClick={handleForgotPassword}>
                Forgot password?
              </button>
            </div>
          </>
        )}
      </div>

      {confirmSignOut && (
        <ConfirmDialog
          title="Unsynced Changes"
          message="Some changes haven't reached your account yet (you may be offline). They will stay safely on this device and sync automatically the next time you sign in to this account. Sign out anyway?"
          confirmLabel="Sign Out Anyway"
          onConfirm={() => { setConfirmSignOut(false); handleSignOut(true); }}
          onCancel={() => setConfirmSignOut(false)}
        />
      )}
    </div>
  );
}
