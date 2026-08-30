/* ============================================
   Diamond Lineup - App Context (Global State)

   Local-first: state loads from and persists to localStorage.
   When signed in, every persisted change is also mirrored to
   the team's cloud rows (per-key, serialized, debounced), and
   remote data can be applied back by refreshing state from
   Storage.

   Auth state is the sole owner of the sync lifecycle: a
   SIGNED_OUT event (from anywhere - our button, another tab,
   session expiry) disables sync immediately so queued writes
   can never cross an account boundary.
   ============================================ */

import React from 'react';
import { newId } from '../domain/ids';
import { Storage, StorageKeys } from '../services/storage';
import { supabase } from '../services/supabaseClient';
import { Sync } from '../services/sync';

export const AppContext = React.createContext(null);

export function AppProvider({ children }) {
  // Load initial state from storage
  const [roster, setRoster] = React.useState(() => Storage.getRoster());
  const [settings, setSettings] = React.useState(() => Storage.getSettings());
  const [game, setGame] = React.useState(() => Storage.getCurrentGame());
  const [games, setGames] = React.useState(() => Storage.getGames());
  const [defaultBattingOrder, setDefaultBattingOrder] = React.useState(() => Storage.getDefaultBattingOrder());
  const [toasts, setToasts] = React.useState([]);

  // Account & sync
  const [user, setUser] = React.useState(null);
  const [syncStatus, setSyncStatus] = React.useState('signedOut');
  const [provisioningError, setProvisioningError] = React.useState(null);
  const initialSyncRan = React.useRef(false);

  const showToast = React.useCallback((message, type = 'success') => {
    const id = newId();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 2600);
  }, []);

  /** Re-read all state from Storage (after a restore or remote sync). */
  const reloadFromStorage = React.useCallback(() => {
    setRoster(Storage.getRoster());
    setSettings(Storage.getSettings());
    setGame(Storage.getCurrentGame());
    setGames(Storage.getGames());
    setDefaultBattingOrder(Storage.getDefaultBattingOrder());
  }, []);

  // Persist changes to storage and mirror to the cloud when signed in.
  // Skips the initial mount (loading is not a change), and surfaces
  // write failures instead of silently dropping data (M6).
  const mounted = React.useRef(false);
  React.useEffect(() => {
    mounted.current = true;
  }, []);

  const persistFailed = React.useRef(new Set());
  const persist = React.useCallback((key, ok) => {
    if (!ok) {
      if (!persistFailed.current.has(key)) {
        persistFailed.current.add(key);
        showToast("Couldn't save to device storage - free up space and retry", 'error');
      }
      return;
    }
    persistFailed.current.delete(key);
    Sync.schedulePush(key);
  }, [showToast]);

  const usePersist = (key, save, value) => {
    const first = React.useRef(true);
    React.useEffect(() => {
      if (first.current) {
        first.current = false;
        return;
      }
      persist(key, save(value));
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value]);
  };

  usePersist(StorageKeys.ROSTER, v => Storage.saveRoster(v), roster);
  usePersist(StorageKeys.SETTINGS, v => Storage.saveSettings(v), settings);
  usePersist(StorageKeys.CURRENT_GAME, v => Storage.saveCurrentGame(v), game);
  usePersist(StorageKeys.GAMES, v => Storage.saveGames(v), games);
  usePersist(StorageKeys.DEFAULT_BATTING_ORDER, v => Storage.saveDefaultBattingOrder(v), defaultBattingOrder);

  // Apply dark mode
  React.useEffect(() => {
    document.documentElement.setAttribute(
      'data-theme',
      settings.darkMode ? 'dark' : 'light'
    );
  }, [settings.darkMode]);

  // Surface sync status changes
  React.useEffect(() => Sync.onStatus(setSyncStatus), []);

  const runInitialSync = React.useCallback(async (sessionUser) => {
    setProvisioningError(null);
    try {
      const decision = await Sync.initialSync(sessionUser.id);
      if (decision === 'applyRemote') {
        reloadFromStorage();
        showToast('Team data loaded from your account');
      }
      return true;
    } catch (e) {
      setProvisioningError(e?.message || 'Cloud sync is unavailable');
      showToast('Cloud sync is unavailable right now - working locally', 'error');
      return false;
    }
  }, [reloadFromStorage, showToast]);

  // Track the auth session and run the initial sync when one appears
  React.useEffect(() => {
    let cancelled = false;

    const handleSession = async (session) => {
      if (cancelled) return;
      setUser(session?.user ?? null);
      if (session?.user && !initialSyncRan.current) {
        initialSyncRan.current = true;
        await runInitialSync(session.user);
      }
    };

    supabase.auth.getSession().then(({ data }) => handleSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        // Auth is gone (sign-out here, another tab, or expiry): stop sync
        // NOW so no queued write can outlive the account (H4)
        initialSyncRan.current = false;
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

  // ----------------------------------------
  // Account actions
  // ----------------------------------------
  const signIn = React.useCallback(async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw error;
  }, []);

  const signUp = React.useCallback(async (email, password) => {
    const { data, error } = await supabase.auth.signUp({ email: email.trim(), password });
    if (error) throw error;
    // With email confirmation enabled, no session is returned yet
    return { needsConfirmation: !data.session };
  }, []);

  const signOut = React.useCallback(async () => {
    await Sync.flushBeforeSignOut();
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
  }, [showToast]);

  const syncNow = React.useCallback(async () => {
    // A failed initial provisioning can be retried from the same button
    if (!Sync.isReady && user) {
      const ok = await runInitialSync(user);
      if (!ok) throw new Error(Sync.lastError || 'Sync is unavailable');
      showToast('Sync is back online');
      return;
    }
    const decision = await Sync.syncNow();
    if (decision === 'applyRemote') {
      reloadFromStorage();
      showToast('Latest team data pulled from your account');
    } else {
      showToast('Everything synced');
    }
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
    syncNow
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
    </AppContext.Provider>
  );
}
