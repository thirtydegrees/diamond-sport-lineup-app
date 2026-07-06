/* ============================================
   Diamond Lineup - Game Setup View
   ============================================ */

import React from 'react';
import { todayISO } from '../domain/dates';
import { AppContext } from '../state/AppContext';
import { Storage } from '../services/storage';
import { GameStartOptionsModal } from '../components/modals';
import { Alert, Checkbox, DragHandle, PlayerTag } from '../components/ui';

export function GameSetupView({ onStartGame }) {
  const { roster, settings, game, setGame } = React.useContext(AppContext);

  const [showStartOptions, setShowStartOptions] = React.useState(false);
  const [battingOrder, setBattingOrder] = React.useState([]);
  const [availability, setAvailability] = React.useState({});
  const [opponent, setOpponent] = React.useState('');
  const [gameDate, setGameDate] = React.useState(todayISO());
  const [gameInnings, setGameInnings] = React.useState(settings.innings);
  const [draggedIdx, setDraggedIdx] = React.useState(null);
  const [initialized, setInitialized] = React.useState(false);

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

  // Drag handlers
  const handleDragStart = (idx) => setDraggedIdx(idx);

  const handleDragOver = (e, idx) => {
    e.preventDefault();
    if (draggedIdx === null || draggedIdx === idx) return;

    const newOrder = [...battingOrder];
    const [removed] = newOrder.splice(draggedIdx, 1);
    newOrder.splice(idx, 0, removed);
    setBattingOrder(newOrder);
    setDraggedIdx(idx);
  };

  const handleDragEnd = () => setDraggedIdx(null);

  // Toggle player availability
  const toggleAvailability = (playerId) => {
    const newAvail = { ...availability };
    newAvail[playerId] = availability[playerId] === false ? true : false;
    setAvailability(newAvail);
  };

  // Get available players
  const availablePlayers = battingOrder.filter(id => availability[id] !== false);

  // Player count warning
  const playerCountWarning = availablePlayers.length > 14 ?
    `With ${availablePlayers.length} players, ${availablePlayers.length - 9} must sit each inning. Sit balancing may be difficult.` :
    null;

  // Continue to lineup
  const handleContinue = () => {
    const gameData = {
      id: game?.id || Date.now().toString(),
      date: gameDate,
      opponent,
      innings: gameInnings,
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
          {battingOrder.map((playerId, idx) => {
            const player = roster.find(p => p.id === playerId);
            if (!player) return null;

            const isAvailable = availability[playerId] !== false;
            const eligibility = player.canPitch ?
              Storage.getPitcherEligibility(playerId, gameDate) : null;

            return (
              <div
                key={playerId}
                className={`player-item ${!isAvailable ? 'unavailable' : ''} ${draggedIdx === idx ? 'dragging' : ''}`}
                draggable={isAvailable}
                onDragStart={() => isAvailable && handleDragStart(idx)}
                onDragOver={(e) => isAvailable && handleDragOver(e, idx)}
                onDragEnd={handleDragEnd}
              >
                {isAvailable && <DragHandle />}
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
      {availablePlayers.length < 9 && (
        <Alert type="error">
          Need at least 9 available players. Currently have {availablePlayers.length}.
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
        disabled={availablePlayers.length < 9}
      >
        Continue to Lineup →
      </button>
    </div>
  );
}
