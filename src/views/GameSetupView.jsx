/* ============================================
   Diamond Lineup - Game Setup View
   ============================================ */

import React from 'react';
import { todayISO } from '../domain/dates';
import { AppContext } from '../state/AppContext';
import { Storage } from '../services/storage';
import { GameStartOptionsModal } from '../components/modals';
import { Alert, Checkbox, PlayerTag } from '../components/ui';

export function GameSetupView({ onStartGame }) {
  const { roster, settings, game, setGame } = React.useContext(AppContext);

  const [showStartOptions, setShowStartOptions] = React.useState(false);
  const [battingOrder, setBattingOrder] = React.useState([]);
  const [availability, setAvailability] = React.useState({});
  const [opponent, setOpponent] = React.useState('');
  const [gameDate, setGameDate] = React.useState(todayISO());
  const [gameInnings, setGameInnings] = React.useState(settings.innings);
  const [draggedId, setDraggedId] = React.useState(null);
  const [initialized, setInitialized] = React.useState(false);
  const dragState = React.useRef(null);

  // Initialize from existing game or show options
  React.useEffect(() => {
    if (initialized) return;

    if (game?.battingOrder) {
      // Resume existing game
      setBattingOrder(game.battingOrder.length > 0 ?
        [...new Set([...game.battingOrder, ...roster.map(p => p.id)])] :
        roster.map(p => p.id)
      );
      setAvailability(game.availability || {});
      setOpponent(game.opponent || '');
      setGameDate(game.date || todayISO());
      setGameInnings(game.innings || settings.innings);
      setInitialized(true);
    } else {
      // New game - show options if there's a default order or last game
      const hasDefault = !!Storage.getDefaultBattingOrder();
      const hasLastGame = !!Storage.getLastGame();

      if (hasDefault || hasLastGame) {
        setShowStartOptions(true);
      } else {
        // Just use roster order
        setBattingOrder(roster.map(p => p.id));
        setInitialized(true);
      }
    }
  }, [game, roster, settings, initialized]);

  // Handle start option selection
  const handleStartOption = (option) => {
    let order;

    if (option === 'default') {
      const defaultOrder = Storage.getDefaultBattingOrder();
      order = defaultOrder?.filter(id => roster.some(p => p.id === id)) || [];
      // Add any new roster players
      roster.forEach(p => {
        if (!order.includes(p.id)) order.push(p.id);
      });
    } else if (option === 'lastGame') {
      const lastGame = Storage.getLastGame();
      order = lastGame?.battingOrder?.filter(id => roster.some(p => p.id === id)) || [];
      roster.forEach(p => {
        if (!order.includes(p.id)) order.push(p.id);
      });
    } else {
      order = roster.map(p => p.id);
    }

    setBattingOrder(order);
    setShowStartOptions(false);
    setInitialized(true);
  };

  // Keep batting order synced with roster changes and sort unavailable to bottom
  React.useEffect(() => {
    if (!initialized) return;

    const rosterIds = new Set(roster.map(p => p.id));
    const newOrder = battingOrder.filter(id => rosterIds.has(id));

    // Add any new roster players
    roster.forEach(p => {
      if (!newOrder.includes(p.id)) newOrder.push(p.id);
    });

    // Sort unavailable to bottom (stable)
    newOrder.sort((a, b) => {
      const aAvail = availability[a] !== false;
      const bAvail = availability[b] !== false;
      if (aAvail && !bAvail) return -1;
      if (!aAvail && bAvail) return 1;
      return 0;
    });

    if (newOrder.join(',') !== battingOrder.join(',')) {
      setBattingOrder(newOrder);
    }
  }, [roster, availability, initialized, battingOrder]);

  // Drag-to-reorder via pointer events. The HTML5 drag-and-drop API never
  // fires on iOS Safari, so this uses pointerdown/move/up on the handle,
  // which works identically for mouse and touch.
  const handleDragMove = React.useCallback((ev) => {
    const st = dragState.current;
    if (!st) return;
    const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-player-id]');
    if (!el) return;
    const overId = el.getAttribute('data-player-id');
    if (!overId || overId === st.playerId) return;
    if (el.getAttribute('data-available') !== 'true') return;

    setBattingOrder(prev => {
      const from = prev.indexOf(st.playerId);
      const to = prev.indexOf(overId);
      if (from < 0 || to < 0 || from === to) return prev;
      const next = [...prev];
      next.splice(from, 1);
      next.splice(to, 0, st.playerId);
      return next;
    });
  }, []);

  const handleDragEnd = React.useCallback(() => {
    dragState.current = null;
    setDraggedId(null);
    window.removeEventListener('pointermove', handleDragMove);
    window.removeEventListener('pointerup', handleDragEnd);
    window.removeEventListener('pointercancel', handleDragEnd);
  }, [handleDragMove]);

  const handleDragStart = (e, playerId) => {
    e.preventDefault();
    dragState.current = { playerId };
    setDraggedId(playerId);
    window.addEventListener('pointermove', handleDragMove);
    window.addEventListener('pointerup', handleDragEnd);
    window.addEventListener('pointercancel', handleDragEnd);
  };

  // Clean up listeners if the view unmounts mid-drag
  React.useEffect(() => handleDragEnd, [handleDragEnd]);

  // Toggle player availability
  const toggleAvailability = (playerId) => {
    const newAvail = { ...availability };
    newAvail[playerId] = availability[playerId] === false ? true : false;
    setAvailability(newAvail);
  };

  // Get available players
  const availablePlayers = battingOrder.filter(id => availability[id] !== false);

  // Fielder count is snapshotted on the game so changing settings mid-season
  // doesn't alter a game in progress
  const fielderCount = game?.fielderCount || settings.fielderCount;

  // Player count warning
  const playerCountWarning = availablePlayers.length > fielderCount + 5 ?
    `With ${availablePlayers.length} players, ${availablePlayers.length - fielderCount} must sit each inning. Sit balancing may be difficult.` :
    null;

  // Continue to lineup
  const handleContinue = () => {
    const gameData = {
      id: game?.id || Date.now().toString(),
      date: gameDate,
      opponent,
      innings: gameInnings,
      fielderCount,
      battingOrder: availablePlayers,
      availability,
      pitcherAssignments: game?.pitcherAssignments || {},
      lockedCells: game?.lockedCells || {},
      lineup: game?.lineup || {},
      score: game?.score || { us: {}, them: {} },
      pitchLog: game?.pitchLog || {},
      currentInning: game?.currentInning || 1,
      exitedPlayers: game?.exitedPlayers || {}
    };

    setGame(gameData);
    onStartGame(gameData);
  };

  // Show start options modal
  if (showStartOptions) {
    return (
      <GameStartOptionsModal
        hasDefaultOrder={!!Storage.getDefaultBattingOrder()}
        hasLastGame={!!Storage.getLastGame()}
        onSelect={handleStartOption}
        onClose={() => handleStartOption('blank')}
      />
    );
  }

  return (
    <div>
      {/* Game Info */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">Game Info</div>
        </div>
        <div className="card-body">
          <div className="form-group">
            <label className="form-label">Date</label>
            <input
              type="date"
              className="form-input"
              value={gameDate}
              onChange={(e) => setGameDate(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Opponent</label>
            <input
              type="text"
              className="form-input"
              value={opponent}
              onChange={(e) => setOpponent(e.target.value)}
              placeholder="Team name (optional)"
            />
          </div>
          <div className="form-group">
            <label className="form-label">Innings</label>
            <select
              className="form-select"
              value={gameInnings}
              onChange={(e) => setGameInnings(parseInt(e.target.value))}
            >
              <option value={5}>5 innings</option>
              <option value={6}>6 innings</option>
              <option value={7}>7 innings</option>
            </select>
            <p className="form-hint">Can add extra innings during game if needed.</p>
          </div>
        </div>
      </div>

      {/* Batting Order */}
      <div className="card">
        <div className="card-header">
          <div>
            <div className="card-title">Batting Order</div>
            <div className="card-subtitle">{availablePlayers.length} available</div>
          </div>
        </div>
        <div className="card-body no-padding">
          {battingOrder.map((playerId) => {
            const player = roster.find(p => p.id === playerId);
            if (!player) return null;

            const isAvailable = availability[playerId] !== false;
            const eligibility = player.canPitch ?
              Storage.getPitcherEligibility(playerId, gameDate) : null;

            return (
              <div
                key={playerId}
                data-player-id={playerId}
                data-available={isAvailable ? 'true' : 'false'}
                className={`player-item ${!isAvailable ? 'unavailable' : ''} ${draggedId === playerId ? 'dragging' : ''}`}
              >
                {isAvailable && (
                  <span
                    className="drag-handle"
                    onPointerDown={(e) => handleDragStart(e, playerId)}
                    aria-label="Drag to reorder"
                  >
                    ☰
                  </span>
                )}
                <div
                  className="player-number"
                  style={{ opacity: isAvailable ? 1 : 0.4 }}
                >
                  {isAvailable ? availablePlayers.indexOf(playerId) + 1 : '-'}
                </div>
                <div className="player-info">
                  <div className="player-name">{player.name}</div>
                  <div className="player-tags">
                    {eligibility && (
                      <PlayerTag type={eligibility.eligible ? 'eligible' : 'ineligible'}>
                        {eligibility.reason}
                      </PlayerTag>
                    )}
                  </div>
                </div>
                <Checkbox
                  checked={isAvailable}
                  onChange={() => toggleAvailability(playerId)}
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* Warnings */}
      {availablePlayers.length < fielderCount && (
        <Alert type="error">
          Need at least {fielderCount} available players. Currently have {availablePlayers.length}.
        </Alert>
      )}

      {playerCountWarning && (
        <Alert type="warning">
          {playerCountWarning}
        </Alert>
      )}

      {/* Continue Button */}
      <button
        className="btn btn-primary btn-block"
        onClick={handleContinue}
        disabled={availablePlayers.length < fielderCount}
      >
        Continue to Lineup →
      </button>
    </div>
  );
}
