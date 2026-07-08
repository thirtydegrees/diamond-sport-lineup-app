/* ============================================
   Diamond Lineup - Lineup View (Game Day)

   Solver invocations here run synchronously on an explicit
   `nextGame` snapshot and then commit it with setGame. The
   previous implementation ran the solver inside setGame
   updaters and chained re-solves through setTimeout, which
   raced React's render cycle and made Fill/Re-solve silently
   fail at times.
   ============================================ */

import React from 'react';
import { getFieldingPositions } from '../domain/constants';
import { formatDateLong } from '../domain/dates';
import { Solver } from '../domain/solver';
import { AppContext } from '../state/AppContext';
import { Storage } from '../services/storage';
import {
  AvoidOverrideModal,
  CellActionModal,
  DisplacementModal,
  PitchCounterModal,
  PitcherPickerModal,
  PlayerExitModal,
  PositionPickerModal,
  SitOverrideModal
} from '../components/modals';
import { InningSelector, LineupGrid, LineupStats, PitcherAssignments } from '../components/LineupGrid';
import { Alert, Modal, OptionItem, OptionList } from '../components/ui';

export function LineupView({ onBack }) {
  const { roster, settings, game, setGame, setGames, pitchHistory, setPitchHistory, showToast } = React.useContext(AppContext);

  const [currentInning, setCurrentInning] = React.useState(game?.currentInning || 1);
  const [error, setError] = React.useState(null);
  const [warnings, setWarnings] = React.useState(null);
  const [showStartChoice, setShowStartChoice] = React.useState(() => {
    // Show choice if lineup is empty (new game)
    const lineupEmpty = !game?.lineup || Object.keys(game.lineup).length === 0;
    return lineupEmpty;
  });

  // Overrides granted for this game (kept for every subsequent re-solve)
  const [avoidOverrides, setAvoidOverrides] = React.useState([]);
  const [sitOverrides, setSitOverrides] = React.useState([]);

  // Modal states
  const [pitcherModal, setPitcherModal] = React.useState(null);
  const [cellAction, setCellAction] = React.useState(null);
  const [positionModal, setPositionModal] = React.useState(null);
  const [pitchCounterModal, setPitchCounterModal] = React.useState(null);
  const [exitConfirm, setExitConfirm] = React.useState(null);
  const [avoidOverridePrompt, setAvoidOverridePrompt] = React.useState(null);
  const [sitOverridePrompt, setSitOverridePrompt] = React.useState(null);
  const [displacementModal, setDisplacementModal] = React.useState(null);

  const innings = game?.innings || settings.innings;
  const fieldingPositions = getFieldingPositions(game?.fielderCount || settings.fielderCount);
  const isSoftball = settings.sport === 'softball';

  const getActivePlayers = React.useCallback((g) => {
    if (!g?.battingOrder) return [];
    return g.battingOrder
      .map(id => roster.find(p => p.id === id))
      .filter(p => p && !g.exitedPlayers?.[p.id]);
  }, [roster]);

  const activePlayers = React.useMemo(() => getActivePlayers(game), [getActivePlayers, game]);

  /**
   * Run the solver against an explicit game snapshot and commit the result.
   * Always commits `baseGame` even on failure so that upstream edits
   * (pitcher assignment, exit, etc.) are never lost.
   */
  const runSolver = React.useCallback((baseGame, fromInning = 1, opts = {}) => {
    if (!baseGame) return;

    setError(null);
    setWarnings(null);

    const effectiveAvoid = opts.avoidOverrides ?? avoidOverrides;
    const effectiveSit = opts.sitOverrides ?? sitOverrides;

    const result = Solver.solve({
      players: getActivePlayers(baseGame),
      innings: baseGame.innings || innings,
      startInning: fromInning,
      existingPlan: baseGame.lineup || {},
      lockedCells: baseGame.lockedCells || {},
      pitcherAssignments: baseGame.pitcherAssignments || {},
      maxSitsPerGame: settings.maxSitsPerGame,
      avoidOverrides: effectiveAvoid,
      sitOverrides: effectiveSit,
      fieldingPositions: getFieldingPositions(baseGame.fielderCount || settings.fielderCount),
      enforcePitcherCatcherRule: !isSoftball,
      requireContiguousPitching: !isSoftball,
      maxPitcherInningsPerGame: settings.pitchRules.limitType === 'innings'
        ? settings.pitchRules.maxInningsPerGame
        : null,
      maxConsecutiveSits: settings.fairness.maxConsecutiveSits,
      everyoneInfield: settings.fairness.everyoneInfield
    });

    if (result.success) {
      if (result.warnings) {
        setWarnings(result.warnings);
      }
      // Merge: keep assignments for players not re-solved (e.g. exited players' history)
      const mergedLineup = { ...baseGame.lineup, ...result.solution };
      setGame({ ...baseGame, lineup: mergedLineup });
    } else if (result.needsOverride) {
      setGame(baseGame);
      setAvoidOverridePrompt({ blockers: result.avoidBlockers, fromInning });
    } else if (result.needsSitOverride) {
      setGame(baseGame);
      setSitOverridePrompt({ players: result.sitOverrideNeeded, fromInning });
    } else {
      setGame(baseGame);
      setError({ message: result.error, conflicts: result.conflicts });
    }
  }, [avoidOverrides, sitOverrides, getActivePlayers, innings, settings, isSoftball, setGame]);

  const generateLineup = React.useCallback((fromInning = 1, opts = {}) => {
    runSolver(game, fromInning, opts);
  }, [runSolver, game]);

  // Track if user chose blank start
  const [startedBlank, setStartedBlank] = React.useState(false);

  // Initial generation - only if not showing start choice and didn't choose blank
  React.useEffect(() => {
    if (showStartChoice) return; // Wait for user choice
    if (startedBlank) return; // User chose blank start
    if (game && Object.keys(game.lineup || {}).length === 0) {
      generateLineup(1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showStartChoice, startedBlank]);

  // Handle start choice
  const handleStartChoice = (choice) => {
    setShowStartChoice(false);
    if (choice === 'populated') {
      generateLineup(1);
    } else {
      // User chose blank - set flag to prevent auto-generation
      setStartedBlank(true);
    }
  };

  // When the Next Inning flow opens the pitcher picker (no pitcher assigned),
  // chain into the pitch counter once a pitcher is chosen
  const autoCounterAfterPick = React.useRef(false);

  /**
   * Advance the game one inning: finalize the outgoing pitcher's record,
   * move the current-inning marker, and open the pitch counter for the
   * incoming pitcher (or the picker if the inning has none). On the last
   * inning it finishes and saves the game instead.
   */
  const handleNextInning = () => {
    // Finalize whoever pitched the inning we're leaving
    const outgoing = getPitcherAt(currentInning);
    if (outgoing && game.pitchLog?.[outgoing.id]) {
      persistPitching(outgoing);
    }

    if (currentInning >= innings) {
      handleSaveGame();
      return;
    }

    const next = currentInning + 1;
    setCurrentInning(next);
    setGame({ ...game, currentInning: next });

    const incoming = getPitcherAt(next);
    if (incoming) {
      setPitchCounterModal({ player: incoming, inning: next });
    } else {
      autoCounterAfterPick.current = true;
      setPitcherModal(next);
    }
  };

  // Handle pitcher assignment
  const handlePitcherAssign = (playerId) => {
    const inning = pitcherModal;

    const newAssignments = { ...game.pitcherAssignments };
    const newLocks = { ...game.lockedCells };
    const newLineup = { ...game.lineup };

    // Clear old pitcher for this inning
    const oldPitcherId = newAssignments[inning];
    if (oldPitcherId) {
      delete newLocks[`${oldPitcherId}-${inning}`];
      if (newLineup[`${oldPitcherId}-${inning}`] === 'P') {
        delete newLineup[`${oldPitcherId}-${inning}`];
      }
    }

    if (playerId) {
      newAssignments[inning] = playerId;
      newLocks[`${playerId}-${inning}`] = 'P';
      newLineup[`${playerId}-${inning}`] = 'P';
    } else {
      delete newAssignments[inning];
    }

    setPitcherModal(null);

    runSolver({
      ...game,
      pitcherAssignments: newAssignments,
      lockedCells: newLocks,
      lineup: newLineup
    }, inning);

    // Next Inning flow: picker was opened automatically, so continue
    // straight into the pitch counter for the chosen pitcher
    if (autoCounterAfterPick.current) {
      autoCounterAfterPick.current = false;
      const player = roster.find(p => p.id === playerId);
      if (player) {
        setPitchCounterModal({ player, inning });
      }
    }
  };

  // Handle cell click
  const handleCellClick = (player, inning, position, isLocked) => {
    if (position === null) {
      // Empty cell - go directly to position picker
      setPositionModal({ player, inning, currentPosition: null });
    } else {
      setCellAction({ player, inning, position, isLocked });
    }
  };

  // Handle cell action
  const handleCellAction = (action) => {
    const { player, inning, position } = cellAction;
    const key = `${player.id}-${inning}`;

    switch (action) {
      case 'lock': {
        setGame({
          ...game,
          lockedCells: { ...game.lockedCells, [key]: position }
        });
        break;
      }
      case 'unlock': {
        const newLocks = { ...game.lockedCells };
        delete newLocks[key];
        setGame({ ...game, lockedCells: newLocks });
        break;
      }
      case 'pitchCount': {
        setCellAction(null);
        setPitchCounterModal({ player, inning });
        return;
      }
      case 'changePosition': {
        setCellAction(null);
        setPositionModal({ player, inning, currentPosition: position });
        return;
      }
      case 'exit': {
        setCellAction(null);
        setExitConfirm({ player, inning });
        return;
      }
    }
    setCellAction(null);
  };

  // Handle position change
  const handlePositionSelect = (newPosition) => {
    const { player, inning } = positionModal;

    // Calculate changes
    const changes = Solver.calculateSwapChanges(
      game.lineup || {},
      player,
      inning,
      newPosition,
      activePlayers
    );

    // Apply changes
    const newLineup = { ...game.lineup };
    const newLocks = { ...game.lockedCells };
    const newPitchers = { ...game.pitcherAssignments };

    changes.forEach(change => {
      const key = `${change.playerId}-${inning}`;
      if (change.to === null) {
        // Displaced to empty - remove from lineup
        delete newLineup[key];
        delete newLocks[key];
      } else {
        newLineup[key] = change.to;
        if (change.type === 'manual') {
          newLocks[key] = change.to;
        }
      }
    });

    // Update pitcher assignments
    if (newPosition === 'P') {
      newPitchers[inning] = player.id;
    } else if (game.pitcherAssignments?.[inning] === player.id) {
      delete newPitchers[inning];
    }

    setGame({
      ...game,
      lineup: newLineup,
      lockedCells: newLocks,
      pitcherAssignments: newPitchers
    });

    setPositionModal(null);

    // Show displacement if there was one
    const displacements = changes.filter(c => c.type === 'displaced');
    if (displacements.length > 0) {
      setDisplacementModal({ changes, inning });
    }
  };

  // Handle player exit
  const handleExitConfirm = (action) => {
    const { player, inning } = exitConfirm;
    const exitInning = inning;

    const newExited = { ...game.exitedPlayers, [player.id]: exitInning };
    const newLineup = { ...game.lineup };
    const newLocks = { ...game.lockedCells };
    const newPitchers = { ...game.pitcherAssignments };

    // Only clear assignments from exit inning forward
    for (let i = exitInning; i <= (game.innings || innings); i++) {
      delete newLineup[`${player.id}-${i}`];
      delete newLocks[`${player.id}-${i}`];
      if (newPitchers[i] === player.id) {
        delete newPitchers[i];
      }
    }

    const nextGame = {
      ...game,
      exitedPlayers: newExited,
      lineup: newLineup,
      lockedCells: newLocks,
      pitcherAssignments: newPitchers
    };

    setExitConfirm(null);

    if (action === 'resolve') {
      // Re-solve only from the exit inning forward
      runSolver(nextGame, exitInning);
    } else {
      setGame(nextGame);
    }
  };

  // Handle pitch count update
  const handlePitchUpdate = (inning, count) => {
    const { player } = pitchCounterModal;
    const newPitchLog = { ...game.pitchLog };

    newPitchLog[player.id] = { ...(newPitchLog[player.id] || {}), [inning]: count };

    setGame({ ...game, pitchLog: newPitchLog });
  };

  /** Save a pitcher's game workload to pitch history (upsert by player+game). */
  const persistPitching = React.useCallback((player, baseGame = game) => {
    const pitcherLog = baseGame.pitchLog?.[player.id] || {};
    const totalPitches = Object.values(pitcherLog).reduce((a, b) => a + b, 0);
    const inningsPitched = Object.entries(baseGame.lineup || {})
      .filter(([key, pos]) => pos === 'P' && key.startsWith(`${player.id}-`)).length;

    Storage.addPitchRecord({
      playerId: player.id,
      gameId: baseGame.id,
      date: baseGame.date,
      pitches: totalPitches,
      innings: pitcherLog,
      inningsPitched: inningsPitched || undefined
    });
    setPitchHistory(Storage.getPitchHistory());
  }, [game, setPitchHistory]);

  // End pitching inning (from the counter's End Inning button)
  const handleEndPitchingInning = () => {
    persistPitching(pitchCounterModal.player);
    setPitchCounterModal(null);
  };

  /** The player fielding P in a given inning, if any. */
  const getPitcherAt = React.useCallback((inning, baseGame = game) => {
    return getActivePlayers(baseGame).find(
      p => (baseGame.lineup || {})[`${p.id}-${inning}`] === 'P'
    ) || null;
  }, [game, getActivePlayers]);

  // Handle score update
  const handleScoreChange = (team, inning, value) => {
    const newScore = { ...game.score };
    newScore[team] = { ...(newScore[team] || {}), [inning]: value };
    setGame({ ...game, score: newScore });
  };

  // Add inning
  const handleAddInning = () => {
    const newInnings = (game?.innings || settings.innings) + 1;
    runSolver({ ...game, innings: newInnings }, newInnings);
  };

  // Save game (also records innings pitched for rest tracking)
  const handleSaveGame = () => {
    Storage.addGame(game);
    Storage.recordGamePitching(game);
    setGames(Storage.getGames());
    setPitchHistory(Storage.getPitchHistory());
    showToast('Game saved');
  };

  // Handle avoid override selection
  const handleAvoidOverride = (override) => {
    const { fromInning } = avoidOverridePrompt;
    const newOverrides = [...avoidOverrides, override];
    setAvoidOverrides(newOverrides);
    setAvoidOverridePrompt(null);
    runSolver(game, fromInning, { avoidOverrides: newOverrides });
  };

  // Handle sit override (allow listed players to exceed max sits this game)
  const handleSitOverride = (playerIds) => {
    const { fromInning } = sitOverridePrompt;
    const newOverrides = [...new Set([...sitOverrides, ...playerIds])];
    setSitOverrides(newOverrides);
    setSitOverridePrompt(null);
    runSolver(game, fromInning, { sitOverrides: newOverrides });
  };

  // Clear & re-solve: drop unlocked cells but preserve exited players' prior innings
  const handleClearAndResolve = () => {
    const newLineup = {};
    const lockedCells = game.lockedCells || {};
    const exitedPlayers = game.exitedPlayers || {};

    // Keep locked positions
    Object.keys(lockedCells).forEach(key => {
      newLineup[key] = lockedCells[key];
    });

    // Keep exited players' positions from before they exited
    Object.entries(exitedPlayers).forEach(([playerId, exitInning]) => {
      for (let i = 1; i < exitInning; i++) {
        const key = `${playerId}-${i}`;
        if (game.lineup?.[key]) {
          newLineup[key] = game.lineup[key];
        }
      }
    });

    runSolver({ ...game, lineup: newLineup }, 1);
  };

  // Print
  const handlePrint = () => window.print();

  if (!game) return <Alert type="error">No active game</Alert>;

  return (
    <div>
      {/* Print Header */}
      <div className="print-header">
        <h1>{isSoftball ? '🥎' : '⚾'} {game.opponent ? `vs ${game.opponent}` : 'Game Lineup'}</h1>
        <p>{formatDateLong(game.date)}</p>
      </div>

      {/* Errors & Warnings */}
      {error && (
        <Alert type="error" onDismiss={() => setError(null)}>
          <strong>{error.message}</strong>
          {error.conflicts && (
            <ul style={{ marginTop: '8px', marginLeft: '16px' }}>
              {error.conflicts.map((c, i) => <li key={i}>{c}</li>)}
            </ul>
          )}
        </Alert>
      )}
      {warnings && warnings.length > 0 && (
        <Alert type="warning" onDismiss={() => setWarnings(null)}>
          {warnings.map((w, i) => <div key={i}>{w}</div>)}
        </Alert>
      )}

      {/* Stats */}
      <div className="card no-print">
        <div className="card-body" style={{ padding: 'var(--space-md)' }}>
          <LineupStats game={game} players={roster} />
        </div>
      </div>

      {/* Current Inning */}
      <div className="card no-print">
        <div className="card-body" style={{ padding: 'var(--space-md)' }}>
          <InningSelector
            currentInning={currentInning}
            totalInnings={innings}
            onChange={(inn) => {
              setCurrentInning(inn);
              setGame({ ...game, currentInning: inn });
            }}
            onAddInning={handleAddInning}
          />
          <button
            className="btn btn-primary btn-block"
            style={{ marginTop: 'var(--space-md)' }}
            onClick={handleNextInning}
          >
            {currentInning >= innings ? '🏁 Finish & Save Game' : `▶ Next Inning (${currentInning + 1})`}
          </button>
          <p className="form-hint" style={{ textAlign: 'center' }}>
            {currentInning >= innings
              ? 'Logs the final pitch counts and saves the game to history.'
              : 'Logs this inning\'s pitch count and opens the counter for the next pitcher.'}
          </p>
        </div>
      </div>

      {/* Pitcher Assignments */}
      <div className="card no-print">
        <div className="card-header">
          <div className="card-title">Pitchers</div>
        </div>
        <div className="card-body" style={{ padding: 'var(--space-md)' }}>
          <PitcherAssignments
            game={game}
            roster={roster}
            onAssignClick={(inning) => setPitcherModal(inning)}
          />
        </div>
      </div>

      {/* Lineup Grid */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">Defensive Lineup</div>
          <button className="btn btn-secondary btn-sm no-print" onClick={handlePrint}>
            🖨️ Print
          </button>
        </div>
        <div className="card-body no-padding">
          <LineupGrid
            game={game}
            roster={roster}
            currentInning={currentInning}
            onCellClick={handleCellClick}
            onScoreChange={handleScoreChange}
          />
        </div>
      </div>

      {/* Actions */}
      <div className="card no-print">
        <div className="card-body">
          <div style={{ display: 'flex', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={() => generateLineup(1)}>
              Fill / Re-solve
            </button>
            <button className="btn btn-secondary" onClick={handleClearAndResolve}>
              Clear & Re-solve
            </button>
            <button className="btn btn-secondary" onClick={handleSaveGame}>
              💾 Save Game
            </button>
          </div>
        </div>
      </div>

      <button className="btn btn-ghost btn-block no-print" onClick={onBack}>
        ← Back to Setup
      </button>

      {/* Modals */}
      {showStartChoice && (
        <Modal title="Start Lineup" onClose={() => handleStartChoice('populated')}>
          <p style={{ marginBottom: '16px' }}>How would you like to start?</p>
          <OptionList>
            <OptionItem
              title="Auto-Generate"
              description="Solver fills all positions based on preferences"
              onClick={() => handleStartChoice('populated')}
            />
            <OptionItem
              title="Start Blank"
              description="Lock in pitchers and key positions, then solve the rest"
              onClick={() => handleStartChoice('blank')}
            />
          </OptionList>
        </Modal>
      )}

      {pitcherModal && (
        <PitcherPickerModal
          inning={pitcherModal}
          players={activePlayers}
          currentPitcherId={game.pitcherAssignments?.[pitcherModal]}
          gameDate={game.date}
          onSelect={handlePitcherAssign}
          onClose={() => { autoCounterAfterPick.current = false; setPitcherModal(null); }}
        />
      )}

      {cellAction && (
        <CellActionModal
          player={cellAction.player}
          inning={cellAction.inning}
          position={cellAction.position}
          isLocked={cellAction.isLocked}
          onAction={handleCellAction}
          onClose={() => setCellAction(null)}
        />
      )}

      {positionModal && (
        <PositionPickerModal
          player={positionModal.player}
          inning={positionModal.inning}
          currentPosition={positionModal.currentPosition}
          lineup={game.lineup}
          totalInnings={innings}
          positions={fieldingPositions}
          requireContiguousPitching={!isSoftball}
          onSelect={handlePositionSelect}
          onClose={() => setPositionModal(null)}
        />
      )}

      {pitchCounterModal && (
        <PitchCounterModal
          player={pitchCounterModal.player}
          inning={pitchCounterModal.inning}
          pitchLog={game.pitchLog?.[pitchCounterModal.player.id] || {}}
          onUpdate={handlePitchUpdate}
          onEndInning={handleEndPitchingInning}
          onClose={() => setPitchCounterModal(null)}
        />
      )}

      {exitConfirm && (
        <PlayerExitModal
          player={exitConfirm.player}
          inning={exitConfirm.inning}
          onConfirm={handleExitConfirm}
          onClose={() => setExitConfirm(null)}
        />
      )}

      {avoidOverridePrompt && (
        <AvoidOverrideModal
          blockers={avoidOverridePrompt.blockers}
          onOverride={handleAvoidOverride}
          onClose={() => setAvoidOverridePrompt(null)}
        />
      )}

      {sitOverridePrompt && (
        <SitOverrideModal
          playersNeeded={sitOverridePrompt.players}
          maxSitsPerGame={settings.maxSitsPerGame}
          onAllow={handleSitOverride}
          onClose={() => setSitOverridePrompt(null)}
        />
      )}

      {displacementModal && (
        <DisplacementModal
          changes={displacementModal.changes}
          onAccept={() => setDisplacementModal(null)}
          onUndo={() => {
            // Revert changes
            generateLineup(displacementModal.inning);
            setDisplacementModal(null);
          }}
          onClose={() => setDisplacementModal(null)}
        />
      )}
    </div>
  );
}
