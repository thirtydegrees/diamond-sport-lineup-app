/* ============================================
   Diamond Lineup - Main Application
   ============================================ */

import React from 'react';
import { AppContext, AppProvider } from './state/AppContext';
import { RosterView } from './views/RosterView';
import { SettingsView } from './views/SettingsView';
import { GameSetupView } from './views/GameSetupView';
import { LineupView } from './views/LineupView';
import { PitchersView } from './views/PitchersView';
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

export function App() {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
}
