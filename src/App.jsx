/* ============================================
   Diamond Lineup - Main Application
   ============================================ */

import React from 'react';
import { UpdateNotice } from './components/UpdateNotice';
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
  const { settings, activeTeam, user, syncStatus, saveError } = React.useContext(AppContext);
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
        <div className="nav-brand"><span className="nav-title">{sportEmoji} Diamond Lineup</span><span className="active-team"><span className="active-team-label">{user ? 'Team' : activeTeam ? 'Saved team' : 'Team'}</span> <strong>{activeTeam?.teamName || 'Local team'}</strong></span></div>
        <button className="save-status" title={saveError || undefined} onClick={() => onViewChange('settings')}>
          {saveError ? 'Change not saved' : syncStatus === 'error' || syncStatus === 'conflict' ? 'Sync needs attention' : syncStatus === 'synced' && user ? 'Synced' : syncStatus === 'syncing' ? 'Saved on device · syncing' : 'Saved on this device'}
        </button>
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
function TeamWorkspace() {
  return <AppContent />;
}

function AppContent() {
  const { game, setGame, showToast, remoteVersion, switchingTeam, signedOutVersion, startupReady, saveError } = React.useContext(AppContext);
  const [view, setView] = React.useState('roster');
  const [showLineup, setShowLineup] = React.useState(false);
  const [showGameChoice, setShowGameChoice] = React.useState(false);
  const [confirmNewGame, setConfirmNewGame] = React.useState(false);

  const isLiveGame = game?.status === 'live';
  const launchHandled = React.useRef(false);
  React.useLayoutEffect(() => {
    if (!startupReady || launchHandled.current) return;
    launchHandled.current = true;
    if (game?.status === 'live' || game?.status === 'draft') {
      setView('game');
      setShowLineup(game.status === 'live' || (game.preparationStage ? game.preparationStage === 'lineup' : Object.keys(game.lineup || {}).length > 0));
    }
  }, [startupReady, game]);

  React.useLayoutEffect(() => {
    // Keep navigation, but discard dialogs and form state from the old snapshot.
    setShowLineup(wasOpen => game?.status === 'live' || (game?.status === 'draft' && (game.preparationStage ? game.preparationStage === 'lineup' : wasOpen && Object.keys(game.lineup || {}).length > 0)));
    setShowGameChoice(false);
    setConfirmNewGame(false);
  }, [remoteVersion]);

  React.useLayoutEffect(() => {
    if (!signedOutVersion) return;
    setView('settings');
    setShowLineup(false);
    setShowGameChoice(false);
    setConfirmNewGame(false);
    window.scrollTo(0, 0);
  }, [signedOutVersion]);

  const handleViewChange = (newView) => {
    launchHandled.current = true;
    if (newView === 'game') {
      // A live game goes straight back to the live screen
      if (isLiveGame) {
        setView('game');
        setShowLineup(true);
        setShowGameChoice(false);
        return;
      }
      if (game?.status === 'draft') {
        setView('game');
        setShowLineup(game.preparationStage ? game.preparationStage === 'lineup' : Object.keys(game.lineup || {}).length > 0);
        setShowGameChoice(false);
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
    if (game?.status === 'draft') setGame({...game, preparationStage: 'setup'});
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
      <div inert={switchingTeam ? '' : undefined}>
      <Navigation
        currentView={view}
        onViewChange={handleViewChange}
      />

      <UpdateNotice />
      {saveError && <div className="alert alert-error" role="alert">The last change was not saved: {saveError}</div>}
      <main className="main" key={`${remoteVersion}:${signedOutVersion}`}>
        {view === 'roster' && <RosterView />}

        {view === 'game' && showGameChoice && (
          <div className="container">
            <div className="card">
              <div className="card-header">
                <div className="card-title">Game</div>
              </div>
              <div className="card-body">
                <p style={{ marginBottom: '16px' }}>You have a saved draft.</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <button className="btn btn-primary btn-block" onClick={handleContinueGame}>
                    Resume Draft
                  </button>
                  <button className="btn btn-secondary btn-block" onClick={() => setConfirmNewGame(true)}>
                    Start New Game
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {view === 'game' && game?.status === 'draft' && <button className="btn btn-ghost" onClick={() => setConfirmNewGame(true)}>Discard Draft / New Game</button>}

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

      </div>
      {switchingTeam && <div className="team-transition" role="status">Switching to {switchingTeam.name}…</div>}

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
        <TeamWorkspace />
      </AppProvider>
    </ErrorBoundary>
  );
}
