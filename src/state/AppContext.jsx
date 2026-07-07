/* ============================================
   Diamond Lineup - App Context (Global State)
   ============================================ */

import React from 'react';
import { newId } from '../domain/ids';
import { Storage } from '../services/storage';

export const AppContext = React.createContext(null);

export function AppProvider({ children }) {
  // Load initial state from storage
  const [roster, setRoster] = React.useState(() => Storage.getRoster());
  const [settings, setSettings] = React.useState(() => Storage.getSettings());
  const [game, setGame] = React.useState(() => Storage.getCurrentGame());
  const [games, setGames] = React.useState(() => Storage.getGames());
  const [pitchHistory, setPitchHistory] = React.useState(() => Storage.getPitchHistory());
  const [toasts, setToasts] = React.useState([]);

  const showToast = React.useCallback((message, type = 'success') => {
    const id = newId();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 2600);
  }, []);

  // Persist changes to storage
  React.useEffect(() => {
    Storage.saveRoster(roster);
  }, [roster]);

  React.useEffect(() => {
    Storage.saveSettings(settings);
  }, [settings]);

  React.useEffect(() => {
    Storage.saveCurrentGame(game);
  }, [game]);

  React.useEffect(() => {
    Storage.saveGames(games);
  }, [games]);

  React.useEffect(() => {
    Storage.savePitchHistory(pitchHistory);
  }, [pitchHistory]);

  // Apply dark mode
  React.useEffect(() => {
    document.documentElement.setAttribute(
      'data-theme',
      settings.darkMode ? 'dark' : 'light'
    );
  }, [settings.darkMode]);

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
    showToast
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
