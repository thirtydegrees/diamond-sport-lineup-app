/* ============================================
   Diamond Lineup - Lineup View (Game Day)

   The lineup grid is a PLAN. Actual participation is recorded
   live, one defensive out at a time:

   draft -> [Start Game] -> live -> [Complete Game] -> completed

   While live, "Record Out" snapshots the current defense into
   the game's out ledger (one tap per out; "End Inning" records
   the remainder in one tap when nothing changed). Mid-inning
   position changes edit only the live formation - previously
   recorded outs never change. Completing the game requires
   confirming every pitcher's final pitch count; only then does
   the game feed history, stats, and rest eligibility.
   ============================================ */

import React from 'react';
import { getFieldingPositions } from '../domain/constants';
import { formatDateLong } from '../domain/dates';
import {
  applyLiveSwap,
  applyPlanSwap,
  completeGame,
  endInningOuts,
  formatOutsAsInnings,
  getPitchCountEntry,
  pitchingOutsByPlayer,
  playersNeedingPitchConfirmation,
  recordOut,
  setInningPitches,
  setLivePitchTotal,
  startLiveGame,
  undoOut,
  validateFormation,
  validateGamePlan,
  activePlayerIdsAt,
  OUTS_PER_INNING
} from '../domain/games';
import {
  assessPitcherAssignment,
  assessPositionChange,
  capCrossingWarnings,
  dailyPitchTotal
} from '../domain/pitching';
import { Solver } from '../domain/solver';
import { AppContext } from '../state/AppContext';
import {
  AvoidOverrideModal,
  CellActionModal,
  CompleteGameModal,
  DisplacementModal,
  LiveSpotPickerModal,
  PitchCounterModal,
  PitcherPickerModal,
  PlayerExitModal,
  PositionPickerModal,
  SitOverrideModal
} from '../components/modals';
import { LineupGrid, LineupStats } from '../components/LineupGrid';
import { Alert, ConfirmDialog, Modal, OptionItem, OptionList } from '../components/ui';

export function LineupView({ onBack, onGameCompleted }) {
  const { roster, settings, game, setGame, games, setGames, showToast } = React.useContext(AppContext);

  const [error, setError] = React.useState(null);
  const [warnings, setWarnings] = React.useState(null);
  const [showStartChoice, setShowStartChoice] = React.useState(() => {
    const lineupEmpty = !game?.lineup || Object.keys(game.lineup).length === 0;
    return lineupEmpty && game?.status === 'draft';
  });

  // Overrides granted for this game (kept for every subsequent re-solve)
  const [avoidOverrides, setAvoidOverrides] = React.useState([]);
  const [sitOverrides, setSitOverrides] = React.useState([]);

  // Modal states
  const [pitcherModal, setPitcherModal] = React.useState(null); // inning (plan)
  const [cellAction, setCellAction] = React.useState(null);
  const [positionModal, setPositionModal] = React.useState(null);
  const [pitchCounterFor, setPitchCounterFor] = React.useState(null); // playerId
  const [exitConfirm, setExitConfirm] = React.useState(null);
  const [avoidOverridePrompt, setAvoidOverridePrompt] = React.useState(null);
  const [sitOverridePrompt, setSitOverridePrompt] = React.useState(null);
  const [displacementModal, setDisplacementModal] = React.useState(null);
  const [liveSpotModal, setLiveSpotModal] = React.useState(null); // { position }
  const [benchMoveModal, setBenchMoveModal] = React.useState(null); // { playerId }
  const [outIssuesPrompt, setOutIssuesPrompt] = React.useState(null); // { issues, bulk }
  const [completeModal, setCompleteModal] = React.useState(false);
  const [startIssuesPrompt, setStartIssuesPrompt] = React.useState(null);
  const [capPrompt, setCapPrompt] = React.useState(null); // { warnings, bulk, pitcherId }
  const [liveOverridePrompt, setLiveOverridePrompt] = React.useState(null); // { warnings, apply }
  const [planOverridePrompt, setPlanOverridePrompt] = React.useState(null); // { warnings, proceed }

  const isLive = game?.status === 'live';
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

  const playerName = React.useCallback(
    (id) => roster.find(p => p.id === id)?.name || game?.playerNames?.[id] || '(removed)',
    [roster, game]
  );

  /** Central policy check for putting a player on the mound in THIS game. */
  const assessPitcher = React.useCallback(
    (player) => assessPitcherAssignment(player, game, games, settings.pitchRules),
    [game, games, settings.pitchRules]
  );

  /**
   * Run the solver against an explicit game snapshot and commit the result.
   * Solves the PLAN only; recorded outs are never touched.
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
      const mergedLineup = { ...baseGame.lineup, ...result.solution };
      const nextGame = { ...baseGame, lineup: mergedLineup };
      // Invariant check so a bad lock/swap can't hide in the plan (H10)
      const planIssues = validateGamePlan(nextGame);
      const allWarnings = [...(result.warnings || []), ...planIssues];
      if (allWarnings.length > 0) setWarnings(allWarnings);
      setGame(nextGame);
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

  const [startedBlank, setStartedBlank] = React.useState(false);

  React.useEffect(() => {
    if (showStartChoice) return;
    if (startedBlank) return;
    if (game && game.status === 'draft' && Object.keys(game.lineup || {}).length === 0) {
      generateLineup(1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showStartChoice, startedBlank]);

  const handleStartChoice = (choice) => {
    setShowStartChoice(false);
    if (choice === 'populated') {
      generateLineup(1);
    } else {
      setStartedBlank(true);
    }
  };

  // ----------------------------------------
  // Live game: start, outs, formation
  // ----------------------------------------

  const handleStartGame = () => {
    const issues = validateGamePlan(game);
    if (issues.length > 0) {
      setStartIssuesPrompt(issues);
      return;
    }
    doStartGame();
  };

  const doStartGame = () => {
    setStartIssuesPrompt(null);
    setGame(startLiveGame(game));
    showToast('Game started - record each defensive out as it happens');
  };

  const doRecordOut = (bulk) => {
    setOutIssuesPrompt(null);
    const next = bulk ? endInningOuts(game) : recordOut(game);
    setGame(next);
    const done = next.live;
    if (done && done.outsRecorded === 0 && done.inning > game.live.inning) {
      if (done.inning > next.innings) {
        showToast('Final scheduled inning done - Complete Game when you\'re finished');
      } else {
        showToast(`Inning ${game.live.inning} done - defense set from inning ${done.inning} plan`);
      }
    }
  };

  // One acknowledgment per pitcher per game: after the coach knowingly
  // continues past a workload boundary, don't nag on every subsequent out
  const capAcks = React.useRef(new Set());

  const proceedRecordOut = (bulk) => {
    const issues = validateFormation(
      game.live.assignments,
      activePlayerIdsAt(game, game.live.inning),
      game.fielderCount || settings.fielderCount
    );
    // Duplicates must be fixed; vacancies/unassigned can be recorded
    // knowingly (short-handed teams are real)
    if (issues.length > 0) {
      setOutIssuesPrompt({ issues, bulk });
      return;
    }
    doRecordOut(bulk);
  };

  const handleRecordOut = (bulk = false) => {
    // Continuation checkpoint: leaving the same pitcher on the mound is a
    // decision too - warn once when this out crosses a workload boundary
    const livePitcher = Object.keys(game.live.assignments).find(
      id => game.live.assignments[id] === 'P'
    );
    if (livePitcher && !capAcks.current.has(livePitcher)) {
      const remaining = bulk ? OUTS_PER_INNING - game.live.outsRecorded : 1;
      const capWarnings = capCrossingWarnings(game, games, settings.pitchRules, remaining);
      if (capWarnings.length > 0) {
        setCapPrompt({ warnings: capWarnings, bulk, pitcherId: livePitcher });
        return;
      }
    }
    proceedRecordOut(bulk);
  };

  const handleUndoOut = () => {
    if ((game.outs || []).length === 0) return;
    setGame(undoOut(game));
  };

  /** Warnings for putting `player` at `position` in the LIVE formation -
      the same central policy as every other assignment path (H6). */
  const liveWarningsFor = React.useCallback((position) => (player) =>
    assessPositionChange(player, position, game, games, settings.pitchRules, {
      enforcePitcherCatcherRule: !isSoftball,
      live: true
    }), [game, games, settings.pitchRules, isSoftball]);

  /** Apply a live swap, checking the DISPLACED player's new spot too. */
  const attemptLiveSwap = (playerId, position) => {
    const holderId = position !== 'SIT'
      ? Object.keys(game.live.assignments).find(
          id => id !== playerId && game.live.assignments[id] === position
        )
      : null;
    if (holderId) {
      const holder = roster.find(p => p.id === holderId);
      const holderNewPos = game.live.assignments[playerId] ?? 'SIT';
      const displacedWarnings = holder
        ? assessPositionChange(holder, holderNewPos, game, games, settings.pitchRules, {
            enforcePitcherCatcherRule: !isSoftball,
            live: true
          })
        : [];
      if (displacedWarnings.length > 0) {
        setLiveOverridePrompt({
          warnings: displacedWarnings,
          apply: () => setGame(applyLiveSwap(game, playerId, position))
        });
        return;
      }
    }
    setGame(applyLiveSwap(game, playerId, position));
  };

  const handleLiveSpotSelect = (playerId) => {
    const { position } = liveSpotModal;
    setLiveSpotModal(null);
    attemptLiveSwap(playerId, position);
  };

  // Bench player coming in: same policy gate as every other path
  const handleBenchMove = (position) => {
    const { playerId } = benchMoveModal;
    const player = roster.find(p => p.id === playerId);
    setBenchMoveModal(null);
    if (!player) return;
    const warnings = assessPositionChange(player, position, game, games, settings.pitchRules, {
      enforcePitcherCatcherRule: !isSoftball,
      live: true
    });
    if (warnings.length > 0) {
      setLiveOverridePrompt({
        warnings,
        apply: () => attemptLiveSwap(playerId, position)
      });
      return;
    }
    attemptLiveSwap(playerId, position);
  };

  // ----------------------------------------
  // Pitch counting (working count only)
  // ----------------------------------------

  const counterPlayer = pitchCounterFor ? roster.find(p => p.id === pitchCounterFor) : null;

  const handleCount = (inning, count) => {
    setGame(setInningPitches(game, pitchCounterFor, inning, count));
  };

  const handleSetTotal = (total) => {
    setGame(setLivePitchTotal(game, pitchCounterFor, total));
  };

  // ----------------------------------------
  // Completion
  // ----------------------------------------

  const confirmationRows = React.useMemo(() => {
    if (!game) return [];
    const outsByPlayer = pitchingOutsByPlayer(game);
    return playersNeedingPitchConfirmation(game).map(pid => ({
      playerId: pid,
      name: playerName(pid),
      pitchingOuts: outsByPlayer[pid] || 0,
      workingCount: getPitchCountEntry(game, pid).live
    }));
  }, [game, playerName]);

  const handleComplete = (confirmations) => {
    let completed;
    try {
      // The domain enforces the confirmation contract independently of the
      // UI - an unreviewed pitcher can never slip through
      completed = completeGame(game, confirmations, roster);
    } catch (e) {
      showToast(e.message, 'error');
      return;
    }
    setGames([...games.filter(g => g.id !== completed.id), completed]);
    setGame(null);
    setCompleteModal(false);
    showToast('Game completed and saved to history');
    onGameCompleted?.();
  };

  // ----------------------------------------
  // Plan editing (pitchers, cells, swaps)
  // ----------------------------------------

  const handlePitcherAssign = (playerId) => {
    const inning = pitcherModal;

    const newAssignments = { ...game.pitcherAssignments };
    const newLocks = { ...game.lockedCells };
    const newLineup = { ...game.lineup };

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
  };

  const handleCellClick = (player, inning, position, isLocked) => {
    if (position === null) {
      setPositionModal({ player, inning, currentPosition: null });
    } else {
      setCellAction({ player, inning, position, isLocked });
    }
  };

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

  // Manual plan change: one validated transaction across lineup, locks,
  // and pitcher assignments (H10), gated by the same pitching policy as
  // every other path - for the mover AND for whoever gets displaced (H6)
  const handlePositionSelect = (newPosition) => {
    const { player, inning } = positionModal;
    setPositionModal(null);

    const ctx = { enforcePitcherCatcherRule: !isSoftball, live: false };
    const moverWarnings = assessPositionChange(player, newPosition, game, games, settings.pitchRules, ctx);

    // Who would be displaced, and where would they land?
    const holder = newPosition !== 'SIT'
      ? activePlayers.find(p => p.id !== player.id && game.lineup?.[`${p.id}-${inning}`] === newPosition)
      : null;
    const oldPosition = game.lineup?.[`${player.id}-${inning}`] || null;
    const displacedWarnings = holder && oldPosition
      ? assessPositionChange(holder, oldPosition, game, games, settings.pitchRules, ctx)
      : [];

    const allWarnings = [...moverWarnings, ...displacedWarnings];
    const proceed = () => applyPositionSwap(player, inning, newPosition);

    if (allWarnings.some(w => w.severity === 'block')) {
      setWarnings(allWarnings.map(w => w.message));
      return; // planning blocks what live reality would only warn about
    }
    if (allWarnings.length > 0) {
      setPlanOverridePrompt({ warnings: allWarnings, proceed });
      return;
    }
    proceed();
  };

  const applyPositionSwap = (player, inning, newPosition) => {
    const prevGame = game; // real undo: restore this exact snapshot
    const { game: swapped, changes } = applyPlanSwap(game, player, inning, newPosition, activePlayers);
    const planIssues = validateGamePlan(swapped);
    if (planIssues.length > 0) setWarnings(planIssues);
    setGame(swapped);

    const displacements = changes.filter(c => c.type === 'displaced');
    if (displacements.length > 0) {
      setDisplacementModal({ changes: changes.map(c => ({ ...c, player: c.playerName })), inning, prevGame });
    }
  };

  const handleExitConfirm = (action) => {
    const { player, inning } = exitConfirm;
    const exitInning = isLive ? game.live.inning : inning;

    const newExited = { ...game.exitedPlayers, [player.id]: exitInning };
    const newLineup = { ...game.lineup };
    const newLocks = { ...game.lockedCells };
    const newPitchers = { ...game.pitcherAssignments };

    for (let i = exitInning; i <= (game.innings || innings); i++) {
      delete newLineup[`${player.id}-${i}`];
      delete newLocks[`${player.id}-${i}`];
      if (newPitchers[i] === player.id) {
        delete newPitchers[i];
      }
    }

    let nextGame = {
      ...game,
      exitedPlayers: newExited,
      lineup: newLineup,
      lockedCells: newLocks,
      pitcherAssignments: newPitchers
    };

    // Exited players leave the live formation (absent, not sitting)
    if (isLive && nextGame.live?.assignments[player.id]) {
      const assignments = { ...nextGame.live.assignments };
      delete assignments[player.id];
      nextGame = { ...nextGame, live: { ...nextGame.live, assignments } };
    }

    setExitConfirm(null);

    if (action === 'resolve') {
      runSolver(nextGame, exitInning);
    } else {
      setGame(nextGame);
    }
  };

  const handleScoreChange = (team, inning, value) => {
    const newScore = { ...game.score };
    newScore[team] = { ...(newScore[team] || {}), [inning]: value };
    setGame({ ...game, score: newScore });
  };

  const handleAddInning = () => {
    const newInnings = (game?.innings || settings.innings) + 1;
    runSolver({ ...game, innings: newInnings }, newInnings);
  };

  const handleAvoidOverride = (override) => {
    const { fromInning } = avoidOverridePrompt;
    const newOverrides = [...avoidOverrides, override];
    setAvoidOverrides(newOverrides);
    setAvoidOverridePrompt(null);
    runSolver(game, fromInning, { avoidOverrides: newOverrides });
  };

  const handleSitOverride = (playerIds) => {
    const { fromInning } = sitOverridePrompt;
    const newOverrides = [...new Set([...sitOverrides, ...playerIds])];
    setSitOverrides(newOverrides);
    setSitOverridePrompt(null);
    runSolver(game, fromInning, { sitOverrides: newOverrides });
  };

  const handleClearAndResolve = () => {
    const newLineup = {};
    const lockedCells = game.lockedCells || {};
    const exitedPlayers = game.exitedPlayers || {};

    Object.keys(lockedCells).forEach(key => {
      newLineup[key] = lockedCells[key];
    });

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

  const handlePrint = () => window.print();

  if (!game) return <Alert type="error">No active game</Alert>;

  // ----------------------------------------
  // Live panel data
  // ----------------------------------------
  const live = game.live;
  const outsThisInning = live?.outsRecorded || 0;
  const totalOuts = (game.outs || []).length;
  const livePitcherId = live
    ? Object.keys(live.assignments).find(id => live.assignments[id] === 'P')
    : null;
  const benchIds = live
    ? activePlayerIdsAt(game, live.inning).filter(id => (live.assignments[id] ?? 'SIT') === 'SIT')
    : [];
  const remainingOuts = OUTS_PER_INNING - outsThisInning;
  const pastLastInning = live && live.inning > game.innings;

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

      {/* Live game panel */}
      {isLive && (
        <div className="card no-print live-panel" data-testid="live-panel">
          <div className="card-header">
            <div>
              <div className="card-title">
                {pastLastInning ? 'Extra Innings' : `Inning ${live.inning} of ${game.innings}`}
              </div>
              <div className="card-subtitle">
                {totalOuts} out{totalOuts === 1 ? '' : 's'} recorded · {formatOutsAsInnings(totalOuts)} innings
              </div>
            </div>
            <div className="out-dots" aria-label={`${outsThisInning} outs this inning`}>
              {[1, 2, 3].map(n => (
                <span key={n} className={`out-dot ${n <= outsThisInning ? 'filled' : ''}`} />
              ))}
            </div>
          </div>
          <div className="card-body">
            {/* Current defense */}
            <div className="live-formation">
              {fieldingPositions.map(pos => {
                const holderId = Object.keys(live.assignments).find(id => live.assignments[id] === pos);
                return (
                  <button
                    key={pos}
                    className={`live-chip ${holderId ? '' : 'vacant'}`}
                    onClick={() => setLiveSpotModal({ position: pos })}
                  >
                    <span className={`pos-text ${pos === 'P' ? 'P' : pos === 'C' ? 'C' : ''}`}>{pos}</span>
                    <span className="live-chip-name">
                      {holderId ? playerName(holderId).split(' ')[0] : '—'}
                    </span>
                  </button>
                );
              })}
            </div>
            {benchIds.length > 0 && (
              <div className="live-bench">
                <span className="text-muted text-small">Bench:</span>
                {benchIds.map(id => (
                  <button key={id} className="live-chip bench" onClick={() => setBenchMoveModal({ playerId: id })}>
                    {playerName(id).split(' ')[0]}
                  </button>
                ))}
              </div>
            )}

            <button
              className="btn btn-primary btn-block btn-lg"
              style={{ marginTop: 'var(--space-md)' }}
              onClick={() => handleRecordOut(false)}
            >
              ⬤ Record Defensive Out
            </button>
            <div style={{ display: 'flex', gap: 'var(--space-sm)', marginTop: 'var(--space-sm)' }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => handleRecordOut(true)}>
                End Inning ({remainingOuts} out{remainingOuts === 1 ? '' : 's'})
              </button>
              <button
                className="btn btn-secondary"
                disabled={totalOuts === 0}
                onClick={handleUndoOut}
              >
                ↩ Undo Out
              </button>
            </div>

            <div style={{ display: 'flex', gap: 'var(--space-sm)', marginTop: 'var(--space-sm)' }}>
              <button
                className="btn btn-secondary"
                style={{ flex: 1 }}
                onClick={() => {
                  if (livePitcherId) setPitchCounterFor(livePitcherId);
                  else setLiveSpotModal({ position: 'P' });
                }}
              >
                ⚾ Pitches{livePitcherId ? ` - ${playerName(livePitcherId).split(' ')[0]} (${getPitchCountEntry(game, livePitcherId).live})` : ''}
              </button>
              <button
                className={`btn ${pastLastInning ? 'btn-primary' : 'btn-secondary'}`}
                style={{ flex: 1 }}
                onClick={() => setCompleteModal(true)}
              >
                🏁 Complete Game
              </button>
            </div>
            <p className="form-hint" style={{ textAlign: 'center' }}>
              Tap a position to make a mid-inning change - recorded outs are never rewritten.
              A shortened game can be completed at any point.
            </p>
          </div>
        </div>
      )}

      {/* Draft: start the game */}
      {game.status === 'draft' && (
        <div className="card no-print">
          <div className="card-body" style={{ padding: 'var(--space-md)' }}>
            <button className="btn btn-primary btn-block btn-lg" onClick={handleStartGame}>
              ▶ Start Game
            </button>
            <p className="form-hint" style={{ textAlign: 'center' }}>
              Starts live out tracking from this plan. Planning alone never counts
              as playing time - only recorded outs do.
            </p>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="card no-print">
        <div className="card-body" style={{ padding: 'var(--space-md)' }}>
          <LineupStats game={game} players={roster} />
        </div>
      </div>

      {/* Pitcher plan */}
      <div className="card no-print">
        <div className="card-header">
          <div>
            <div className="card-title">Planned Pitchers</div>
            <div className="card-subtitle">Tap an inning to assign</div>
          </div>
        </div>
        <div className="card-body" style={{ padding: 'var(--space-md)' }}>
          <div style={{ display: 'flex', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
            {Array.from({ length: game.innings }, (_, i) => {
              const inning = i + 1;
              const pitcherId = game.pitcherAssignments?.[inning];
              return (
                <button
                  key={inning}
                  className={`btn ${pitcherId ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ minWidth: '75px', flexDirection: 'column', height: 'auto', padding: 'var(--space-sm)', gap: '2px' }}
                  onClick={() => setPitcherModal(inning)}
                >
                  <span style={{ fontSize: '11px', opacity: 0.8 }}>Inn {inning}</span>
                  <span style={{ fontSize: '13px', fontWeight: 600 }}>
                    {pitcherId ? playerName(pitcherId).split(' ')[0] : '+ Assign'}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Lineup Grid (the plan) */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">Lineup Plan</div>
          <button className="btn btn-secondary btn-sm no-print" onClick={handlePrint}>
            🖨️ Print
          </button>
        </div>
        <div className="card-body no-padding">
          <LineupGrid
            game={game}
            roster={roster}
            currentInning={isLive ? live.inning : 0}
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
            <button className="btn btn-secondary" onClick={handleAddInning}>
              + Add Inning
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
          title={`Pitcher - Inning ${pitcherModal}`}
          players={activePlayers}
          currentPitcherId={game.pitcherAssignments?.[pitcherModal]}
          assess={assessPitcher}
          onSelect={handlePitcherAssign}
          onClose={() => setPitcherModal(null)}
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
          totalInnings={game.innings}
          positions={fieldingPositions}
          requireContiguousPitching={!isSoftball}
          onSelect={handlePositionSelect}
          onClose={() => setPositionModal(null)}
        />
      )}

      {counterPlayer && (
        <PitchCounterModal
          player={counterPlayer}
          inning={isLive ? live.inning : 1}
          entry={getPitchCountEntry(game, counterPlayer.id)}
          dailyMax={settings.pitchRules.limitType === 'pitches' ? settings.pitchRules.absoluteMax : null}
          dailyTotal={dailyPitchTotal(counterPlayer.id, game, games).total}
          onCount={handleCount}
          onSetTotal={handleSetTotal}
          onClose={() => setPitchCounterFor(null)}
        />
      )}

      {exitConfirm && (
        <PlayerExitModal
          player={exitConfirm.player}
          inning={isLive ? live.inning : exitConfirm.inning}
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
            // Real rollback: restore the exact pre-swap snapshot rather
            // than re-solving into a different lineup
            setGame(displacementModal.prevGame);
            setDisplacementModal(null);
          }}
          onClose={() => setDisplacementModal(null)}
        />
      )}

      {planOverridePrompt && (
        <Modal title="Pitching Rule Warning" onClose={() => setPlanOverridePrompt(null)}>
          <Alert type="warning">
            {planOverridePrompt.warnings.map((w, i) => <div key={i}>{w.message}</div>)}
          </Alert>
          <p className="text-small text-muted" style={{ margin: '12px 0' }}>
            Overriding records your choice but does not change your league's rules.
          </p>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setPlanOverridePrompt(null)}>
              Cancel
            </button>
            <button
              className="btn btn-danger"
              style={{ flex: 1 }}
              onClick={() => {
                planOverridePrompt.proceed();
                setPlanOverridePrompt(null);
              }}
            >
              Override & Apply
            </button>
          </div>
        </Modal>
      )}

      {liveOverridePrompt && (
        <Modal title="Rule Warning" onClose={() => setLiveOverridePrompt(null)}>
          <Alert type="warning">
            {liveOverridePrompt.warnings.map((w, i) => <div key={i}>{w.message}</div>)}
          </Alert>
          <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
            <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setLiveOverridePrompt(null)}>
              Cancel
            </button>
            <button
              className="btn btn-danger"
              style={{ flex: 1 }}
              onClick={() => {
                liveOverridePrompt.apply();
                setLiveOverridePrompt(null);
              }}
            >
              Override & Apply
            </button>
          </div>
        </Modal>
      )}

      {capPrompt && (
        <ConfirmDialog
          title="Pitching Workload Check"
          message={
            capPrompt.warnings.map(w => w.message).join('. ') +
            '. Recording keeps what actually happened; make a pitching change first if this was unintended.'
          }
          confirmLabel="Record Anyway"
          danger
          onConfirm={() => {
            capAcks.current.add(capPrompt.pitcherId);
            setCapPrompt(null);
            proceedRecordOut(capPrompt.bulk);
          }}
          onCancel={() => setCapPrompt(null)}
        />
      )}

      {liveSpotModal && (
        <LiveSpotPickerModal
          position={liveSpotModal.position}
          players={activePlayers}
          currentHolderId={Object.keys(live?.assignments || {}).find(
            id => live.assignments[id] === liveSpotModal.position
          )}
          warningsFor={liveWarningsFor(liveSpotModal.position)}
          onSelect={handleLiveSpotSelect}
          onClose={() => setLiveSpotModal(null)}
        />
      )}

      {benchMoveModal && (
        <Modal title={`${playerName(benchMoveModal.playerId)} comes in at…`} onClose={() => setBenchMoveModal(null)}>
          <div className="position-grid">
            {fieldingPositions.map(pos => (
              <div key={pos} className="position-option" onClick={() => handleBenchMove(pos)}>
                {pos}
              </div>
            ))}
          </div>
          <p className="form-hint">Whoever is there now swaps to the bench spot.</p>
        </Modal>
      )}

      {outIssuesPrompt && (
        <ConfirmDialog
          title="Formation Check"
          message={
            `Before recording: ${outIssuesPrompt.issues.map(i => i.message).join('; ')}. ` +
            'Record anyway only if this is what actually happened on the field.'
          }
          confirmLabel="Record Anyway"
          danger
          onConfirm={() => doRecordOut(outIssuesPrompt.bulk)}
          onCancel={() => setOutIssuesPrompt(null)}
        />
      )}

      {startIssuesPrompt && (
        <ConfirmDialog
          title="Plan Check"
          message={`The plan has issues: ${startIssuesPrompt.join('; ')}. Start anyway? (You can fix the live defense as you go.)`}
          confirmLabel="Start Anyway"
          onConfirm={doStartGame}
          onCancel={() => setStartIssuesPrompt(null)}
        />
      )}

      {completeModal && (
        <CompleteGameModal
          rows={confirmationRows}
          hasOuts={totalOuts > 0}
          onComplete={handleComplete}
          onClose={() => setCompleteModal(false)}
        />
      )}
    </div>
  );
}
