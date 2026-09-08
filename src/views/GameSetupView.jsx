/* ============================================
   Diamond Lineup - Game Setup View
   ============================================ */

import React from 'react';
import { todayISO } from '../domain/dates';
import { normalizeGamePlan } from '../domain/games';
import { newId } from '../domain/ids';
import { assessPitcherRest } from '../domain/pitching';
import { AppContext } from '../state/AppContext';
import { Storage } from '../services/storage';
import { GameStartOptionsModal } from '../components/modals';
import { Alert, Checkbox, PlayerTag } from '../components/ui';

export function GameSetupView({ onStartGame }) {
  const { roster, settings, game, setGame, games, defaultBattingOrder } = React.useContext(AppContext);

  const [showStartOptions, setShowStartOptions] = React.useState(false);
  const battingOrder = game?.setupOrder || game?.battingOrder || [];
  const availability = game?.availability || {};
  const opponent = game?.opponent || '';
  const gameDate = game?.date || todayISO();
  const gameInnings = game?.innings || settings.innings;
  const updateSetup = (field, value) => setGame(current => {
    if (!current || current.status !== 'draft') return current;
    const prior = field === 'setupOrder' ? (current.setupOrder || current.battingOrder) : current[field];
    const next = {...current, [field]: typeof value === 'function' ? value(prior) : value};
    return normalizeGamePlan({...next, battingOrder: (next.setupOrder || next.battingOrder).filter(id => next.availability[id] !== false)});
  });
  const setBattingOrder = value => updateSetup('setupOrder', value);
  const setAvailability = value => updateSetup('availability', value);
  const setOpponent = value => updateSetup('opponent', value);
  const setGameDate = value => { if (value) updateSetup('date', value); };
  const setGameInnings = value => updateSetup('innings', value);
  const createDraft = order => setGame(current => current || {
    schemaVersion: 2, id: newId(), status: 'draft', date: todayISO(), opponent: '',
    innings: settings.innings, fielderCount: settings.fielderCount, sport: settings.sport,
    rulesSnapshot: structuredClone(settings.pitchRules), rulesVersion: settings.pitchRulePreset + ':2026-09',
    setupOrder: order, battingOrder: order, availability: {}, pitcherAssignments: {}, lockedCells: {}, lineup: {},
    score: {us: {}, them: {}}, live: null, outs: [], pitchCounts: {}, playerNames: {}, exitedPlayers: {}
  });
  const [draggedId, setDraggedId] = React.useState(null);
  const [initialized, setInitialized] = React.useState(false);
  const dragState = React.useRef(null);

  // Initialize from existing game or show options
  React.useEffect(() => {
    if (initialized) return;

    if (game?.battingOrder) {
      setInitialized(true);
    } else {
      // New game - show options if there's a default order or last game
      const hasDefault = !!defaultBattingOrder;
      const hasLastGame = !!Storage.getLastGame();

      if (hasDefault || hasLastGame) {
        setShowStartOptions(true);
      } else {
        // Just use roster order
        createDraft(roster.map(p => p.id));
        setInitialized(true);
      }
    }
  }, [game, roster, settings, initialized]);

  // Handle start option selection
  const handleStartOption = (option) => {
    let order;

    if (option === 'default') {
      order = defaultBattingOrder?.filter(id => roster.some(p => p.id === id)) || [];
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

    createDraft(order);
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

  // Continue to lineup. The plan is normalized so availability and inning
  // edits can't leave hidden assignments, locks, or scores behind (H9).
  const handleContinue = () => {
    if (game?.status !== 'draft') return;
    const gameData = {...game, preparationStage: 'lineup'};
    if (!setGame(gameData)) return;
    onStartGame(gameData);
  };

  // Show start options modal
  if (showStartOptions) {
    return (
      <GameStartOptionsModal
        hasDefaultOrder={!!defaultBattingOrder}
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
          <div className="card-title">Draft · Game Info</div>
        </div>
        <div className="card-body">
          <div className="form-group">
            <label className="form-label" htmlFor="game-date">Scheduled date</label>
            <input
              type="date"
              id="game-date"
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
              <option value={7}>7 innings</option><option value={9}>9 innings</option>
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
              assessPitcherRest(playerId, gameDate, games, game?.rulesSnapshot || settings.pitchRules) : null;

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

      <p className="form-hint">Draft changes save automatically. The game starts only when you choose Start Game.</p>
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
