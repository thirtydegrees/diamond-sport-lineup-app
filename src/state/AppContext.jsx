/* ============================================
   Diamond Lineup - App Context (Global State)
   ============================================ */

import React from 'react';
import { Storage } from '../services/storage';

export const AppContext = React.createContext(null);

export function AppProvider({ children }) {
  // Load initial state from storage
  const [roster, setRoster] = React.useState(() => Storage.getRoster());
  const [settings, setSettings] = React.useState(() => Storage.getSettings());
  const [game, setGame] = React.useState(() => Storage.getCurrentGame());
  const [games, setGames] = React.useState(() => Storage.getGames());
  const [pitchHistory, setPitchHistory] = React.useState(() => Storage.getPitchHistory());

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
    setPitchHistory
  };

  return (
    <AppContext.Provider value={value}>
      {children}
    </AppContext.Provider>
  );
}
