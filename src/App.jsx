/* ============================================
   Diamond Lineup - Main Application
   ============================================ */

import React from 'react';
import { AppContext, AppProvider } from './state/AppContext';
import { ConfirmDialog } from './components/ui';
import { ErrorBoundary } from './components/ErrorBoundary';
import { RosterView } from './views/RosterView';
import { SettingsView } from './views/SettingsView';
import { GameSetupView } from './views/GameSetupView';
import { LineupView } from './views/LineupView';
import { PitchersView } from './views/PitchersView';
import { StatsView } from './views/StatsView';
import { HistoryView } from './views/HistoryView';

// ============================================
// Navigation Component
// ============================================
function Navigation({ currentView, onViewChange }) {
  const { settings } = React.useContext(AppContext);
  const sportEmoji = settings.sport === 'softball' ? '🥎' : '⚾';
  const tabs = [
    { id: 'roster', label: 'Roster', icon: '👥' },
    { id: 'game', label: 'Game', icon: '📋' },
    { id: 'stats', label: 'Stats', icon: '📊' },
    { id: 'pitchers', label: 'Pitchers', icon: sportEmoji },
    { id: 'history', label: 'History', icon: '🗓️' },
    { id: 'settings', label: 'Settings', icon: '⚙️' }
  ];

  return (
    <nav className="nav">
      <div className="nav-content">
        <span className="nav-title">{sportEmoji} Diamond Lineup</span>
        <div className="nav-tabs">
          {tabs.map(tab => (
            <button
              key={tab.id}
              className={`nav-tab ${currentView === tab.id ? 'active' : ''}`}
              onClick={() => onViewChange(tab.id)}
            >
              <span className="nav-tab-icon" aria-hidden="true">{tab.icon}</span>
              <span className="nav-tab-label">{tab.label}</span>
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
  const { game, setGame, showToast } = React.useContext(AppContext);
  const [view, setView] = React.useState('roster');
  const [showLineup, setShowLineup] = React.useState(false);
  const [showGameChoice, setShowGameChoice] = React.useState(false);
  const [confirmNewGame, setConfirmNewGame] = React.useState(false);

  const isLiveGame = game?.status === 'live';

  const handleViewChange = (newView) => {
    if (newView === 'game') {
      // A live game goes straight back to the live screen
      if (isLiveGame) {
        setView('game');
        setShowLineup(true);
        setShowGameChoice(false);
        return;
      }
      // A draft with a lineup offers continue/new
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
    // Abandoning a draft/live game leaves NO trace in history, workload,
    // or stats - only completed games count (confirmed after this dialog)
    setGame(null);
    setShowLineup(false);
    setShowGameChoice(false);
    setConfirmNewGame(false);
  };

  const handleGameCompleted = () => {
    setShowLineup(false);
    setShowGameChoice(false);
    setView('history');
    showToast('Find the completed game in History - pitch counts stay correctable there');
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
                  <button className="btn btn-secondary btn-block" onClick={() => setConfirmNewGame(true)}>
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
          <LineupView onBack={handleBackToSetup} onGameCompleted={handleGameCompleted} />
        )}

        {view === 'stats' && <StatsView />}

        {view === 'pitchers' && <PitchersView />}

        {view === 'history' && <HistoryView />}

        {view === 'settings' && <SettingsView />}
      </main>

      {confirmNewGame && (
        <ConfirmDialog
          title="Start New Game"
          message="Discard the current game and start fresh? A discarded game leaves no history: no playing time, no pitching workload, no stats. If real innings were played, Complete Game instead."
          confirmLabel="Discard & Start New"
          danger
          onConfirm={handleNewGame}
          onCancel={() => setConfirmNewGame(false)}
        />
      )}
    </div>
  );
}

export function App() {
  return (
    <ErrorBoundary>
      <AppProvider>
        <AppContent />
      </AppProvider>
    </ErrorBoundary>
  );
}
