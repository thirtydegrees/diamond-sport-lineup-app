/* ============================================
   Diamond Lineup - App Context (Global State)

   Local-first: state loads from and persists to localStorage.
   When signed in, every persisted change is also mirrored to
   the team's cloud rows (debounced), and remote data can be
   applied back by refreshing state from Storage.
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
  const [pitchHistory, setPitchHistory] = React.useState(() => Storage.getPitchHistory());
  const [toasts, setToasts] = React.useState([]);

  // Account & sync
  const [user, setUser] = React.useState(null);
  const [syncStatus, setSyncStatus] = React.useState('signedOut');
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
    setPitchHistory(Storage.getPitchHistory());
  }, []);

  // Persist changes to storage and mirror to the cloud when signed in
  React.useEffect(() => {
    Storage.saveRoster(roster);
    Sync.schedulePush(StorageKeys.ROSTER, roster);
  }, [roster]);

  React.useEffect(() => {
    Storage.saveSettings(settings);
    Sync.schedulePush(StorageKeys.SETTINGS, settings);
  }, [settings]);

  React.useEffect(() => {
    Storage.saveCurrentGame(game);
    Sync.schedulePush(StorageKeys.CURRENT_GAME, game);
  }, [game]);

  React.useEffect(() => {
    Storage.saveGames(games);
    Sync.schedulePush(StorageKeys.GAMES, games);
  }, [games]);

  React.useEffect(() => {
    Storage.savePitchHistory(pitchHistory);
    Sync.schedulePush(StorageKeys.PITCH_HISTORY, pitchHistory);
  }, [pitchHistory]);

  // Apply dark mode
  React.useEffect(() => {
    document.documentElement.setAttribute(
      'data-theme',
      settings.darkMode ? 'dark' : 'light'
    );
  }, [settings.darkMode]);

  // Surface sync status changes
  React.useEffect(() => Sync.onStatus(setSyncStatus), []);

  // Track the auth session and run the initial sync when one appears
  React.useEffect(() => {
    let cancelled = false;

    const handleSession = async (session) => {
      if (cancelled) return;
      setUser(session?.user ?? null);
      if (session?.user && !initialSyncRan.current) {
        initialSyncRan.current = true;
        try {
          const decision = await Sync.initialSync();
          if (cancelled) return;
          if (decision === 'applyRemote') {
            reloadFromStorage();
            showToast('Team data loaded from your account');
          }
        } catch {
          showToast('Cloud sync is unavailable right now - working locally', 'error');
        }
      }
    };

    supabase.auth.getSession().then(({ data }) => handleSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        initialSyncRan.current = false;
        setUser(null);
      } else {
        handleSession(session);
      }
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [reloadFromStorage, showToast]);

  // ----------------------------------------
  // Account actions
  // ----------------------------------------
  const signIn = React.useCallback(async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }, []);

  const signUp = React.useCallback(async (email, password) => {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;
    // With email confirmation enabled, no session is returned yet
    return { needsConfirmation: !data.session };
  }, []);

  const signOut = React.useCallback(async () => {
    await supabase.auth.signOut();
    Sync.disable();
    initialSyncRan.current = false;
    setUser(null);
    showToast('Signed out - your data stays on this device');
  }, [showToast]);

  const syncNow = React.useCallback(async () => {
    const decision = await Sync.syncNow();
    if (decision === 'applyRemote') {
      reloadFromStorage();
      showToast('Latest team data pulled from your account');
    } else {
      showToast('Everything synced');
    }
  }, [reloadFromStorage, showToast]);

  const value = {
    roster,
    setRoster,
    settings,
    setSettings,
    game,
    setGame,
    games,
    setGames,
    pitchHistory,
    setPitchHistory,
    showToast,
    reloadFromStorage,
    user,
    syncStatus,
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
