/* ============================================
   Diamond Lineup - App Context (Global State)

   Local-first: state loads from and persists to localStorage.
   When signed in, every persisted change is also mirrored to
   an atomic, revision-checked team snapshot (serialized, debounced), and
   remote data can be applied back by refreshing state from
   Storage.

   Auth state is the sole owner of the sync lifecycle: a
   SIGNED_OUT event (from anywhere - our button, another tab,
   session expiry) disables sync immediately so queued writes
   can never cross an account boundary.
   ============================================ */

import React from 'react';
import { newId } from '../domain/ids';
import { normalizePitchRules } from '../domain/pitching';
import { Storage, StorageKeys } from '../services/storage';
import { supabase } from '../services/supabaseClient';
import { Sync } from '../services/sync';
import { authRedirectURL } from '../services/supabaseClient';
import { Modal } from '../components/ui';

export const AppContext = React.createContext(null);

export function AppProvider({ children }) {
  // Load initial state from storage
  const [roster, rawSetRoster] = React.useState(() => Storage.getRoster());
  const [settings, rawSetSettings] = React.useState(() => Storage.getSettings());
  const [game, rawSetGame] = React.useState(() => Storage.getCurrentGame());
  const [games, rawSetGames] = React.useState(() => Storage.getGames());
  const [defaultBattingOrder, rawSetDefaultBattingOrder] = React.useState(() => Storage.getDefaultBattingOrder());
  const [toasts, setToasts] = React.useState([]);

  // Account & sync
  const [user, setUser] = React.useState(null);
  const [syncStatus, setSyncStatus] = React.useState('signedOut');
  const [provisioningError, setProvisioningError] = React.useState(null);
  const initialSyncRan = React.useRef(false);
  const sessionId = React.useRef(null);
  const [remoteVersion, setRemoteVersion] = React.useState(0);

  const showToast = React.useCallback((message, type = 'success') => {
    const id = newId();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 2600);
  }, []);

  const dataRef = React.useRef({roster, settings, currentGame: game, games, defaultBattingOrder});
  const hydrate = React.useCallback((data) => {
    dataRef.current = data;
    rawSetRoster(data.roster); rawSetSettings(data.settings); rawSetGame(data.currentGame);
    rawSetGames(data.games); rawSetDefaultBattingOrder(data.defaultBattingOrder);
  }, []);
  const reloadFromStorage = React.useCallback(() => {hydrate(Storage.exportDataSet()); setRemoteVersion(v=>v+1);}, [hydrate]);
  const commitData = React.useCallback((patch) => {
    const next = {...dataRef.current, ...patch};
    if(patch.settings)next.settings={...patch.settings,pitchRules:normalizePitchRules(patch.settings.pitchRules)};
    try { Sync.saveLocal(next); hydrate(next); return true; }
    catch(e) { showToast(e.message, 'error'); return false; }
  }, [hydrate, showToast]);
  const change = (key) => (value) => commitData({[key]: typeof value === 'function' ? value(dataRef.current[key]) : value});
  const setRoster = change('roster'), setSettings = change('settings'), setGame = change('currentGame');
  const setGames = change('games'), setDefaultBattingOrder = change('defaultBattingOrder');

  // Apply dark mode
  React.useEffect(() => {
    document.documentElement.setAttribute(
      'data-theme',
      settings.darkMode ? 'dark' : 'light'
    );
  }, [settings.darkMode]);

  // Surface sync status changes
  React.useEffect(() => Sync.onStatus(setSyncStatus), []);

  // Remote hydration changes state without marking it as a local edit.
  React.useEffect(() => Sync.onRemoteApplied(() => {
    reloadFromStorage();
    showToast('Updated with newer changes from your account');
  }), [reloadFromStorage, showToast]);

  // Account-conflict guard: local data owned by a different account
  const [accountConflict, setAccountConflict] = React.useState(null);
  // Supabase password-recovery flow (user arrived via a reset email)
  const [passwordRecovery, setPasswordRecovery] = React.useState(false);

  const runInitialSync = React.useCallback(async (sessionUser) => {
    setProvisioningError(null);
    // The device may hold another coach's team: never auto-sync across the
    // boundary - make the user choose explicitly.
    const conflict = Sync.checkAccountConflict(sessionUser.id);
    if (conflict) {
      setAccountConflict({ owner: conflict, user: sessionUser });
      return false;
    }
    try {
      const decision = await Sync.initialSync(sessionUser.id);
      if (decision === 'applyRemote') {
        reloadFromStorage();
        showToast('Team data loaded from your account');
      }
      return true;
    } catch (e) {
      if(sessionId.current !== sessionUser.id)return false;
      setProvisioningError(e?.message || 'Cloud sync is unavailable');
      showToast('Cloud sync is unavailable right now - working locally', 'error');
      return false;
    }
  }, [reloadFromStorage, showToast]);

  // Track the auth session and run the initial sync when one appears
  React.useEffect(() => {
    let cancelled = false;
    let authEventSeen = false;

    const handleSession = async (session) => {
      if (cancelled) return;
      if (sessionId.current !== (session?.user?.id || null)) {
        Sync.disable(); initialSyncRan.current = false; sessionId.current = session?.user?.id || null;
      }
      setUser(session?.user ?? null);
      if (session?.user && !initialSyncRan.current) {
        initialSyncRan.current = true;
        await runInitialSync(session.user);
      }
    };

    supabase.auth.getSession().then(({ data }) => {if(!authEventSeen)handleSession(data.session);});
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if(cancelled)return;
      authEventSeen = true;
      if (event === 'PASSWORD_RECOVERY') {
        setPasswordRecovery(true);
      }
      if (!session) {
        // Auth is gone (sign-out here, another tab, or expiry): stop sync
        // NOW so no queued write can outlive the account (H4). Dirty flags
        // and the data-owner marker survive inside the sync service.
        initialSyncRan.current = false;
        sessionId.current = null;
        Sync.disable();
        setUser(null);
        setProvisioningError(null);
      } else {
        handleSession(session);
      }
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [runInitialSync]);

  /** Resolve an account conflict: replace device data with this account's. */
  const resolveAccountConflict = React.useCallback(async (choice) => {
    const conflict = accountConflict;
    setAccountConflict(null);
    if (!conflict) return;
    if (choice === 'replace') {
      try {
        await Sync.adoptAccount(conflict.user.id);
        reloadFromStorage();
        showToast('Loaded your account data on this device');
      } catch (e) {
        setProvisioningError(e?.message || 'Cloud sync is unavailable');
        showToast('Could not load your account data - working locally', 'error');
      }
    } else {
      // Sign out and leave the other account's local data untouched
      await supabase.auth.signOut();
    }
  }, [accountConflict, reloadFromStorage, showToast]);

  // ----------------------------------------
  // Account actions
  // ----------------------------------------
  const signIn = React.useCallback(async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw error;
  }, []);

  const signUp = React.useCallback(async (email, password, displayName) => {
    const { data, error } = await supabase.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: authRedirectURL(), data: { display_name: displayName?.trim() || null } } });
    if (error) throw error;
    // With email confirmation enabled, no session is returned yet
    return { needsConfirmation: !data.session };
  }, []);

  /**
   * Sign out. Tries to flush pending changes first; if some still haven't
   * reached the account, returns { pending: true } WITHOUT signing out so
   * the UI can ask the coach explicitly. Pending edits that are signed out
   * anyway stay on the device (with their dirty flags) and sync on the next
   * sign-in to the same account.
   */
  const signOut = React.useCallback(async ({ force = false } = {}) => {
    await Sync.flushBeforeSignOut();
    if (!force && Sync.hasPendingChanges()) {
      return { pending: true };
    }
    const { error } = await supabase.auth.signOut();
    if (error) {
      // The session may still be alive; do NOT claim a sign-out happened
      showToast(`Sign out failed: ${error.message}`, 'error');
      throw error;
    }
    // onAuthStateChange fires with no session and disables sync; this is a
    // belt-and-suspenders for environments where the event is delayed
    Sync.disable();
    initialSyncRan.current = false;
    setUser(null);
    showToast('Signed out - your data stays on this device');
    return { pending: false };
  }, [showToast]);

  /** Switch to another of this account's teams (replaces local data). */
  const switchTeam = React.useCallback(async (team) => {
    await Sync.switchTeam(team);
    reloadFromStorage();
    showToast(`Now working with ${team.name}`);
  }, [reloadFromStorage, showToast]);

  const resetPassword = React.useCallback(async (email) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: authRedirectURL()
    });
    if (error) throw error;
  }, []);

  const updatePassword = React.useCallback(async (newPassword) => {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw error;
    setPasswordRecovery(false);
    showToast('Password updated');
  }, [showToast]);

  const resendConfirmation = React.useCallback(async (email) => {
    const { error } = await supabase.auth.resend({ type: 'signup', email: email.trim(), options: { emailRedirectTo: authRedirectURL() } });
    if (error) throw error;
  }, []);

  const syncNow = React.useCallback(async () => {
    // A failed initial provisioning can be retried from the same button
    if (!Sync.isReady && user) {
      const ok = await runInitialSync(user);
      if (!ok) throw new Error(Sync.lastError || 'Sync is unavailable');
      showToast('Sync is back online');
      return;
    }
    await Sync.syncNow();
    reloadFromStorage();
    showToast(Sync.status === 'conflict' ? 'Sync conflict: review Account & Sync' : 'Everything synced', Sync.status === 'conflict' ? 'error' : 'success');
  }, [reloadFromStorage, runInitialSync, showToast, user]);

  const value = {
    roster,
    setRoster,
    settings,
    setSettings,
    game,
    setGame,
    games,
    setGames,
    commitData,
    remoteVersion,
    defaultBattingOrder,
    setDefaultBattingOrder,
    showToast,
    reloadFromStorage,
    user,
    syncStatus,
    provisioningError,
    signIn,
    signUp,
    signOut,
    syncNow,
    switchTeam,
    resetPassword,
    resendConfirmation
  };

  return (
    <AppContext.Provider value={value}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {toasts.map(t => (
          <div key={t.id} className={`toast toast-${t.type}`}>
            {t.message}
          </div>
        ))}
      </div>

      {accountConflict && (
        <Modal
          title="This Device Holds Another Team's Data"
          onClose={() => resolveAccountConflict('signOut')}
        >
          <p style={{ marginBottom: '12px' }}>
            The data on this device belongs to a different account
            (team "{accountConflict.owner.teamName || 'My Team'}"). To protect both
            coaches' data, it will not be uploaded to your account.
          </p>
          <p className="text-muted text-small" style={{ marginBottom: '16px' }}>
            "Use My Account" replaces the data on this device with your own
            account's team data. A recovery copy will be retained on this device, including unsynced changes. Download a backup first if you need a portable copy.
          </p>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => resolveAccountConflict('signOut')}>
              Sign Out
            </button>
            <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => resolveAccountConflict('replace')}>
              Use My Account
            </button>
          </div>
        </Modal>
      )}

      {passwordRecovery && (
        <PasswordRecoveryModal
          onSubmit={updatePassword}
          onClose={() => setPasswordRecovery(false)}
        />
      )}
    </AppContext.Provider>
  );
}

function PasswordRecoveryModal({ onSubmit, onClose }) {
  const [password, setPassword] = React.useState('');
  const [error, setError] = React.useState(null);
  const [busy, setBusy] = React.useState(false);

  const submit = async () => {
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit(password);
    } catch (e) {
      setError(e.message || 'Could not update the password');
      setBusy(false);
    }
  };

  return (
    <Modal title="Set a New Password" onClose={onClose}>
      <p className="text-muted text-small mb-md">
        You followed a password-reset link. Choose a new password for your account.
      </p>
      <div className="form-group">
        <label className="form-label">New Password</label>
        <input
          type="password"
          className="form-input"
          value={password}
          autoComplete="new-password"
          placeholder="At least 8 characters"
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
        />
      </div>
      {error && <p className="text-small text-danger mb-md">{error}</p>}
      <button className="btn btn-primary btn-block" disabled={busy || !password} onClick={submit}>
        Update Password
      </button>
    </Modal>
  );
}
