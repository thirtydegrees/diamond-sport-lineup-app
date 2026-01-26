/* ============================================
   Youth Baseball Lineup - Storage Service
   ============================================
   
   Abstraction layer for data persistence.
   Currently uses localStorage, but designed to be
   easily swapped for an API backend in the future.
   
   All storage operations go through this service.
   ============================================ */

const STORAGE_PREFIX = 'ybl_';

const StorageKeys = {
  ROSTER: 'roster',
  SETTINGS: 'settings',
  CURRENT_GAME: 'currentGame',
  GAMES: 'games',
  PITCH_HISTORY: 'pitchHistory',
  DEFAULT_BATTING_ORDER: 'defaultBattingOrder'
};

const Storage = {
  // ----------------------------------------
  // Core storage operations
  // ----------------------------------------
  
  _get(key, defaultValue = null) {
    try {
      const data = localStorage.getItem(STORAGE_PREFIX + key);
      if (data === null) return defaultValue;
      return JSON.parse(data);
    } catch (e) {
      console.error(`Storage read error for ${key}:`, e);
      return defaultValue;
    }
  },
  
  _set(key, value) {
    try {
      localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.error(`Storage write error for ${key}:`, e);
      return false;
    }
  },
  
  _remove(key) {
    try {
      localStorage.removeItem(STORAGE_PREFIX + key);
      return true;
    } catch (e) {
      console.error(`Storage remove error for ${key}:`, e);
      return false;
    }
  },
  
  // ----------------------------------------
  // Roster operations
  // ----------------------------------------
  
  getRoster() {
    return this._get(StorageKeys.ROSTER, []);
  },
  
  saveRoster(roster) {
    return this._set(StorageKeys.ROSTER, roster);
  },
  
  addPlayer(player) {
    const roster = this.getRoster();
    roster.push(player);
    return this.saveRoster(roster);
  },
  
  updatePlayer(playerId, updates) {
    const roster = this.getRoster();
    const index = roster.findIndex(p => p.id === playerId);
    if (index === -1) return false;
    roster[index] = { ...roster[index], ...updates };
    return this.saveRoster(roster);
  },
  
  deletePlayer(playerId) {
    const roster = this.getRoster();
    const filtered = roster.filter(p => p.id !== playerId);
    return this.saveRoster(filtered);
  },
  
  // ----------------------------------------
  // Settings operations
  // ----------------------------------------
  
  getSettings() {
    const saved = this._get(StorageKeys.SETTINGS, {});
    // Merge with defaults to ensure all fields exist
    return {
      ...DEFAULT_SETTINGS,
      ...saved,
      pitchRules: {
        ...DEFAULT_SETTINGS.pitchRules,
        ...(saved.pitchRules || {})
      }
    };
  },
  
  saveSettings(settings) {
    return this._set(StorageKeys.SETTINGS, settings);
  },
  
  updateSetting(key, value) {
    const settings = this.getSettings();
    settings[key] = value;
    return this.saveSettings(settings);
  },
  
  // ----------------------------------------
  // Default batting order
  // ----------------------------------------
  
  getDefaultBattingOrder() {
    return this._get(StorageKeys.DEFAULT_BATTING_ORDER, null);
  },
  
  saveDefaultBattingOrder(order) {
    return this._set(StorageKeys.DEFAULT_BATTING_ORDER, order);
  },
  
  clearDefaultBattingOrder() {
    return this._remove(StorageKeys.DEFAULT_BATTING_ORDER);
  },
  
  // ----------------------------------------
  // Current game operations
  // ----------------------------------------
  
  getCurrentGame() {
    return this._get(StorageKeys.CURRENT_GAME, null);
  },
  
  saveCurrentGame(game) {
    return this._set(StorageKeys.CURRENT_GAME, game);
  },
  
  clearCurrentGame() {
    return this._remove(StorageKeys.CURRENT_GAME);
  },
  
  // ----------------------------------------
  // Game history operations
  // ----------------------------------------
  
  getGames() {
    return this._get(StorageKeys.GAMES, []);
  },
  
  saveGames(games) {
    return this._set(StorageKeys.GAMES, games);
  },
  
  addGame(game) {
    const games = this.getGames();
    // Check if game already exists (update) or new (add)
    const existingIndex = games.findIndex(g => g.id === game.id);
    if (existingIndex >= 0) {
      games[existingIndex] = game;
    } else {
      games.push(game);
    }
    return this.saveGames(games);
  },
  
  getGameById(gameId) {
    const games = this.getGames();
    return games.find(g => g.id === gameId) || null;
  },
  
  deleteGame(gameId) {
    const games = this.getGames();
    const filtered = games.filter(g => g.id !== gameId);
    return this.saveGames(filtered);
  },
  
  // Get the most recent game (for "use last game's lineup" feature)
  getLastGame() {
    const games = this.getGames();
    if (games.length === 0) return null;
    // Sort by date descending
    const sorted = [...games].sort((a, b) => new Date(b.date) - new Date(a.date));
    return sorted[0];
  },
  
  // ----------------------------------------
  // Pitch history operations
  // ----------------------------------------
  
  getPitchHistory() {
    return this._get(StorageKeys.PITCH_HISTORY, []);
  },
  
  savePitchHistory(history) {
    return this._set(StorageKeys.PITCH_HISTORY, history);
  },
  
  addPitchRecord(record) {
    const history = this.getPitchHistory();
    // Check if record for this player/game exists
    const existingIndex = history.findIndex(
      r => r.playerId === record.playerId && r.gameId === record.gameId
    );
    if (existingIndex >= 0) {
      history[existingIndex] = { ...history[existingIndex], ...record };
    } else {
      history.push({
        id: Date.now().toString(),
        ...record
      });
    }
    return this.savePitchHistory(history);
  },
  
  getPitchHistoryForPlayer(playerId) {
    const history = this.getPitchHistory();
    return history.filter(r => r.playerId === playerId);
  },
  
  // Calculate pitcher eligibility based on rest rules
  getPitcherEligibility(playerId, gameDate) {
    const history = this.getPitchHistoryForPlayer(playerId);
    const settings = this.getSettings();
    const rules = settings.pitchRules;
    
    if (history.length === 0) {
      return { eligible: true, reason: 'Eligible', daysRest: null };
    }
    
    // Sort by date descending to get most recent
    const sorted = [...history].sort((a, b) => new Date(b.date) - new Date(a.date));
    const lastPitched = sorted[0];
    
    // Calculate days since last pitched
    const lastDate = new Date(lastPitched.date);
    const currentDate = new Date(gameDate);
    const daysSince = Math.floor((currentDate - lastDate) / (1000 * 60 * 60 * 24));
    
    // Find required rest days based on pitches thrown
    let requiredRest = 0;
    for (const bp of rules.breakpoints) {
      if (lastPitched.pitches <= bp.maxPitches) {
        requiredRest = bp.restDays;
        break;
      }
    }
    
    // Check if exceeded all breakpoints
    const lastBreakpoint = rules.breakpoints[rules.breakpoints.length - 1];
    if (lastPitched.pitches > lastBreakpoint.maxPitches) {
      requiredRest = rules.absoluteMaxRest;
    }
    
    if (daysSince >= requiredRest) {
      return { 
        eligible: true, 
        reason: 'Eligible',
        daysRest: daysSince,
        lastPitched: lastPitched.pitches
      };
    } else {
      const daysNeeded = requiredRest - daysSince;
      return {
        eligible: false,
        reason: `${daysNeeded}d rest`,
        daysRest: daysSince,
        daysNeeded,
        lastPitched: lastPitched.pitches
      };
    }
  },
  
  // ----------------------------------------
  // Bulk operations
  // ----------------------------------------
  
  clearAllData() {
    Object.values(StorageKeys).forEach(key => {
      this._remove(key);
    });
    return true;
  },
  
  // Export all data (for backup or migration)
  exportAllData() {
    return {
      roster: this.getRoster(),
      settings: this.getSettings(),
      currentGame: this.getCurrentGame(),
      games: this.getGames(),
      pitchHistory: this.getPitchHistory(),
      defaultBattingOrder: this.getDefaultBattingOrder(),
      exportDate: new Date().toISOString()
    };
  },
  
  // Import data (for restore or migration)
  importAllData(data) {
    try {
      if (data.roster) this.saveRoster(data.roster);
      if (data.settings) this.saveSettings(data.settings);
      if (data.currentGame) this.saveCurrentGame(data.currentGame);
      if (data.games) this.saveGames(data.games);
      if (data.pitchHistory) this.savePitchHistory(data.pitchHistory);
      if (data.defaultBattingOrder) this.saveDefaultBattingOrder(data.defaultBattingOrder);
      return true;
    } catch (e) {
      console.error('Import error:', e);
      return false;
    }
  }
};
