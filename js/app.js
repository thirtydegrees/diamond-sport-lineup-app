/* ============================================
   Youth Baseball Lineup - Main Application
   ============================================ */

// ============================================
// App Context (Global State)
// ============================================
const AppContext = React.createContext();

function AppProvider({ children }) {
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

// ============================================
// Navigation Component
// ============================================
function Navigation({ currentView, onViewChange }) {
  const tabs = [
    { id: 'roster', label: 'Roster' },
    { id: 'game', label: 'Game' },
    { id: 'pitchers', label: 'Pitchers' },
    { id: 'history', label: 'History' },
    { id: 'settings', label: '⚙️' }
  ];

  return (
    <nav className="nav">
      <div className="nav-content">
        <span className="nav-title">⚾ Lineup</span>
        <div className="nav-tabs">
          {tabs.map(tab => (
            <button
              key={tab.id}
              className={`nav-tab ${currentView === tab.id ? 'active' : ''}`}
              onClick={() => onViewChange(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
    </nav>
  );
}

// ============================================
// Main App Component
// ============================================
function AppContent() {
  const { game, setGame } = React.useContext(AppContext);
  const [view, setView] = React.useState('roster');
  const [showLineup, setShowLineup] = React.useState(false);
  const [showGameChoice, setShowGameChoice] = React.useState(false);

  const handleViewChange = (newView) => {
    if (newView === 'game') {
      // Check if there's an active game with a lineup
      const hasActiveGame = game && Object.keys(game.lineup || {}).length > 0;
      if (hasActiveGame) {
        setShowGameChoice(true);
        setView('game');
        return;
      }
    }
    setView(newView);
    setShowLineup(false);
    setShowGameChoice(false);
  };

  const handleStartGame = () => {
    setShowLineup(true);
    setShowGameChoice(false);
  };

  const handleBackToSetup = () => {
    setShowLineup(false);
  };

  const handleContinueGame = () => {
    setShowLineup(true);
    setShowGameChoice(false);
  };

  const handleNewGame = () => {
    // Clear the current game
    setGame(null);
    setShowLineup(false);
    setShowGameChoice(false);
  };

  return (
    <div className="app">
      <Navigation 
        currentView={view} 
        onViewChange={handleViewChange}
      />
      
      <main className="main">
        {view === 'roster' && <RosterView />}
        
        {view === 'game' && showGameChoice && (
          <div className="container">
            <div className="card">
              <div className="card-header">
                <div className="card-title">Game</div>
              </div>
              <div className="card-body">
                <p style={{ marginBottom: '16px' }}>You have an active game in progress.</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <button className="btn btn-primary btn-block" onClick={handleContinueGame}>
                    Continue Current Game
                  </button>
                  <button className="btn btn-secondary btn-block" onClick={handleNewGame}>
                    Start New Game
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
        
        {view === 'game' && !showLineup && !showGameChoice && (
          <GameSetupView onStartGame={handleStartGame} />
        )}
        
        {view === 'game' && showLineup && (
          <LineupView onBack={handleBackToSetup} />
        )}
        
        {view === 'pitchers' && <PitchersView />}
        
        {view === 'history' && <HistoryView />}
        
        {view === 'settings' && <SettingsView />}
      </main>
    </div>
  );
}

function App() {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
}

// ============================================
// Initialize Application
// ============================================
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
