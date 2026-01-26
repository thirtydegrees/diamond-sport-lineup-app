/* ============================================
   Youth Baseball Lineup - View Components
   ============================================ */

// ============================================
// Roster View
// ============================================
function RosterView() {
  const { roster, setRoster } = React.useContext(AppContext);
  const [editingPlayer, setEditingPlayer] = React.useState(null);
  const [showEditor, setShowEditor] = React.useState(false);

  const handleSavePlayer = (player) => {
    if (editingPlayer) {
      setRoster(roster.map(p => p.id === player.id ? player : p));
    } else {
      setRoster([...roster, player]);
    }
    setShowEditor(false);
    setEditingPlayer(null);
  };

  const handleDeletePlayer = (playerId) => {
    if (confirm('Delete this player from the roster?')) {
      setRoster(roster.filter(p => p.id !== playerId));
    }
  };

  const handleLoadDemo = () => {
    if (confirm('Replace current roster with demo data? This will overwrite existing players.')) {
      setRoster(DEMO_ROSTER);
    }
  };

  return (
    <div>
      <div className="card">
        <div className="card-header">
          <div>
            <div className="card-title">Team Roster</div>
            <div className="card-subtitle">{roster.length} players</div>
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
            <button className="btn btn-secondary btn-sm" onClick={handleLoadDemo}>
              Demo
            </button>
            <button 
              className="btn btn-primary btn-sm" 
              onClick={() => { setEditingPlayer(null); setShowEditor(true); }}
            >
              + Add
            </button>
          </div>
        </div>
        <div className="card-body no-padding">
          {roster.length === 0 ? (
            <EmptyState
              icon="⚾"
              title="No Players Yet"
              text="Add players to your roster or load the demo roster to get started."
              action={
                <button className="btn btn-primary" onClick={handleLoadDemo}>
                  Load Demo Roster
                </button>
              }
            />
          ) : (
            roster.map((player, idx) => (
              <div 
                key={player.id} 
                className="player-item"
                onClick={() => { setEditingPlayer(player); setShowEditor(true); }}
              >
                <div className="player-number">{idx + 1}</div>
                <div className="player-info">
                  <div className="player-name">{player.name}</div>
                  <div className="player-tags">
                    {player.prefersPitching && (
                      <PlayerTag type="pitcher">Pitcher</PlayerTag>
                    )}
                    {player.canPitch && !player.prefersPitching && (
                      <PlayerTag type="pitcher" style={{ opacity: 0.6 }}>Can P</PlayerTag>
                    )}
                    {player.canCatch && (
                      <PlayerTag type="catcher">Catcher</PlayerTag>
                    )}
                    {player.preferredOrder?.slice(0, 3).map(pos => (
                      <span 
                        key={pos} 
                        className="player-tag"
                        style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}
                      >
                        {pos}
                      </span>
                    ))}
                  </div>
                </div>
                <button
                  className="btn-icon"
                  onClick={(e) => { e.stopPropagation(); handleDeletePlayer(player.id); }}
                  aria-label="Delete player"
                >
                  🗑️
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {showEditor && (
        <PlayerEditorModal
          player={editingPlayer}
          onSave={handleSavePlayer}
          onClose={() => { setShowEditor(false); setEditingPlayer(null); }}
        />
      )}
    </div>
  );
}

// ============================================
// Settings View
// ============================================
function SettingsView() {
  const { settings, setSettings, roster } = React.useContext(AppContext);

  const updateSetting = (key, value) => {
    setSettings({ ...settings, [key]: value });
  };

  const handleSaveDefaultOrder = () => {
    const currentOrder = roster.map(p => p.id);
    Storage.saveDefaultBattingOrder(currentOrder);
    alert('Default batting order saved!');
  };

  const handleClearDefaultOrder = () => {
    Storage.clearDefaultBattingOrder();
    alert('Default batting order cleared.');
  };

  const handleClearAllData = () => {
    if (confirm('Delete ALL data? This includes roster, games, pitch history, and settings. This cannot be undone.')) {
      Storage.clearAllData();
      window.location.reload();
    }
  };

  const defaultOrder = Storage.getDefaultBattingOrder();

  return (
    <div>
      {/* Display Settings */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">Display</div>
        </div>
        <div className="card-body">
          <Toggle
            checked={settings.darkMode}
            onChange={(v) => updateSetting('darkMode', v)}
            label="Dark Mode"
          />
        </div>
      </div>

      {/* Game Rules */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">Game Rules</div>
        </div>
        <div className="card-body">
          <div className="form-group">
            <label className="form-label">Default Innings</label>
            <select
              className="form-select"
              value={settings.innings}
              onChange={(e) => updateSetting('innings', parseInt(e.target.value))}
            >
              <option value={5}>5 innings</option>
              <option value={6}>6 innings</option>
              <option value={7}>7 innings</option>
            </select>
            <p className="form-hint">Can be adjusted per game. Use "Add Inning" during games for extras.</p>
          </div>

          <div className="form-group">
            <label className="form-label">Max Sits Per Game</label>
            <select
              className="form-select"
              value={settings.maxSitsPerGame}
              onChange={(e) => updateSetting('maxSitsPerGame', parseInt(e.target.value))}
            >
              <option value={1}>1 inning max</option>
              <option value={2}>2 innings max</option>
              <option value={3}>3 innings max</option>
              <option value={4}>4 innings max</option>
            </select>
            <p className="form-hint">Total innings a player can sit during a game. Override if unavoidable.</p>
          </div>
        </div>
      </div>

      {/* Pitch Count Rules */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">Pitch Count Rules</div>
        </div>
        <div className="card-body">
          <p className="text-muted text-small mb-md">
            Rest days required based on pitches thrown.
          </p>
          {settings.pitchRules.breakpoints.map((bp, idx) => (
            <div 
              key={idx} 
              style={{ 
                display: 'flex', 
                gap: '12px', 
                marginBottom: '12px', 
                alignItems: 'flex-end' 
              }}
            >
              <div style={{ flex: 1 }}>
                <label className="form-label">Up to pitches</label>
                <input
                  type="number"
                  className="form-input"
                  value={bp.maxPitches}
                  onChange={(e) => {
                    const newRules = { ...settings.pitchRules };
                    newRules.breakpoints[idx].maxPitches = parseInt(e.target.value) || 0;
                    updateSetting('pitchRules', newRules);
                  }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label className="form-label">Rest days</label>
                <input
                  type="number"
                  className="form-input"
                  value={bp.restDays}
                  onChange={(e) => {
                    const newRules = { ...settings.pitchRules };
                    newRules.breakpoints[idx].restDays = parseInt(e.target.value) || 0;
                    updateSetting('pitchRules', newRules);
                  }}
                />
              </div>
            </div>
          ))}

          <div style={{ 
            display: 'flex', 
            gap: '12px', 
            marginTop: '16px', 
            paddingTop: '16px', 
            borderTop: '1px solid var(--border-light)' 
          }}>
            <div style={{ flex: 1 }}>
              <label className="form-label">Absolute Max Pitches</label>
              <input
                type="number"
                className="form-input"
                value={settings.pitchRules.absoluteMax}
                onChange={(e) => {
                  const newRules = { ...settings.pitchRules };
                  newRules.absoluteMax = parseInt(e.target.value) || 0;
                  updateSetting('pitchRules', newRules);
                }}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label className="form-label">Rest at Max</label>
              <input
                type="number"
                className="form-input"
                value={settings.pitchRules.absoluteMaxRest}
                onChange={(e) => {
                  const newRules = { ...settings.pitchRules };
                  newRules.absoluteMaxRest = parseInt(e.target.value) || 0;
                  updateSetting('pitchRules', newRules);
                }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Default Batting Order */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">Default Batting Order</div>
        </div>
        <div className="card-body">
          {defaultOrder ? (
            <>
              <p className="text-small mb-md">
                Default order saved ({defaultOrder.length} players)
              </p>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button className="btn btn-secondary" onClick={handleSaveDefaultOrder}>
                  Update from Roster
                </button>
                <button className="btn btn-secondary" onClick={handleClearDefaultOrder}>
                  Clear
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-muted text-small mb-md">
                No default batting order saved. Current roster order will be used.
              </p>
              <button className="btn btn-secondary" onClick={handleSaveDefaultOrder}>
                Save Current Roster Order as Default
              </button>
            </>
          )}
        </div>
      </div>

      {/* Data Management */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">Data</div>
        </div>
        <div className="card-body">
          <button className="btn btn-danger" onClick={handleClearAllData}>
            Clear All Data
          </button>
          <p className="form-hint mt-sm">
            This will delete your roster, all games, pitch history, and settings.
          </p>
        </div>
      </div>
    </div>
  );
}

// ============================================
// Game Setup View
// ============================================
function GameSetupView({ onStartGame }) {
  const { roster, settings, game, setGame } = React.useContext(AppContext);
  
  const [showStartOptions, setShowStartOptions] = React.useState(false);
  const [battingOrder, setBattingOrder] = React.useState([]);
  const [availability, setAvailability] = React.useState({});
  const [opponent, setOpponent] = React.useState('');
  const [gameDate, setGameDate] = React.useState(new Date().toISOString().split('T')[0]);
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
      setGameDate(game.date || new Date().toISOString().split('T')[0]);
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
    let newOrder = battingOrder.filter(id => rosterIds.has(id));
    
    // Add any new roster players
    roster.forEach(p => {
      if (!newOrder.includes(p.id)) newOrder.push(p.id);
    });
    
    // Sort unavailable to bottom
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
  }, [roster, availability, initialized]);

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

// ============================================
// Lineup View (Main Game Day Screen)
// ============================================
function LineupView({ onBack }) {
  const { roster, settings, game, setGame, games, setGames, pitchHistory, setPitchHistory } = React.useContext(AppContext);

  const [currentInning, setCurrentInning] = React.useState(game?.currentInning || 1);
  const [error, setError] = React.useState(null);
  const [warnings, setWarnings] = React.useState(null);
  const [showStartChoice, setShowStartChoice] = React.useState(() => {
    // Show choice if lineup is empty (new game)
    const lineupEmpty = !game?.lineup || Object.keys(game.lineup).length === 0;
    return lineupEmpty;
  });
  
  // Modal states
  const [pitcherModal, setPitcherModal] = React.useState(null);
  const [cellAction, setCellAction] = React.useState(null);
  const [positionModal, setPositionModal] = React.useState(null);
  const [pitchCounterModal, setPitchCounterModal] = React.useState(null);
  const [exitConfirm, setExitConfirm] = React.useState(null);
  const [avoidOverride, setAvoidOverride] = React.useState(null);
  const [displacementModal, setDisplacementModal] = React.useState(null);
  const [sitOverride, setSitOverride] = React.useState(null);

  const innings = game?.innings || settings.innings;

  // Get active players
  const activePlayers = React.useMemo(() => {
    if (!game?.battingOrder) return [];
    return game.battingOrder
      .map(id => roster.find(p => p.id === id))
      .filter(p => p && !game.exitedPlayers?.[p.id]);
  }, [game, roster]);

  // Generate lineup
  const generateLineup = React.useCallback((fromInning = 1, overrides = []) => {
    if (!game) return;
    
    setError(null);
    setWarnings(null);

    // Use callback to get fresh game state
    setGame(prevGame => {
      const result = Solver.solve({
        players: activePlayers,
        innings: prevGame.innings || innings,
        startInning: fromInning,
        existingPlan: prevGame.lineup || {},
        lockedCells: prevGame.lockedCells || {},
        pitcherAssignments: prevGame.pitcherAssignments || {},
        maxSitsPerGame: settings.maxSitsPerGame,
        avoidOverrides: overrides
      });

      if (result.success) {
        if (result.warnings) {
          setWarnings(result.warnings);
        }
        // Merge: keep assignments for players not in activePlayers (exited players)
        const mergedLineup = { ...prevGame.lineup };
        // Overlay the solver's solution
        Object.entries(result.solution).forEach(([key, pos]) => {
          mergedLineup[key] = pos;
        });
        return { ...prevGame, lineup: mergedLineup };
      } else if (result.needsOverride) {
        setAvoidOverride(result.avoidBlockers);
        return prevGame;
      } else if (result.needsSitOverride) {
        setSitOverride(result.sitOverrideNeeded);
        return prevGame;
      } else {
        setError({
          message: result.error,
          conflicts: result.conflicts
        });
        return prevGame;
      }
    });
  }, [activePlayers, innings, settings.maxSitsPerGame]);

  // Track if user chose blank start
  const [startedBlank, setStartedBlank] = React.useState(false);

  // Initial generation - only if not showing start choice and didn't choose blank
  React.useEffect(() => {
    if (showStartChoice) return; // Wait for user choice
    if (startedBlank) return; // User chose blank start
    if (game && Object.keys(game.lineup || {}).length === 0) {
      generateLineup(1);
    }
  }, [showStartChoice, startedBlank]);
  
  // Handle start choice
  const handleStartChoice = (choice) => {
    if (choice === 'populated') {
      // Auto-generate lineup
      generateLineup(1);
    } else {
      // User chose blank - set flag to prevent auto-generation
      setStartedBlank(true);
    }
    setShowStartChoice(false);
  };

  // Handle pitcher assignment
  const handlePitcherAssign = (playerId) => {
    const inning = pitcherModal;
    
    setGame(prevGame => {
      const newAssignments = { ...prevGame.pitcherAssignments };
      const newLocks = { ...prevGame.lockedCells };
      const newLineup = { ...prevGame.lineup };

      // Clear old pitcher for this inning
      const oldPitcherId = newAssignments[inning];
      if (oldPitcherId) {
        delete newLocks[`${oldPitcherId}-${inning}`];
      }

      if (playerId) {
        newAssignments[inning] = playerId;
        newLocks[`${playerId}-${inning}`] = 'P';
        newLineup[`${playerId}-${inning}`] = 'P';
      } else {
        delete newAssignments[inning];
      }

      return {
        ...prevGame,
        pitcherAssignments: newAssignments,
        lockedCells: newLocks,
        lineup: newLineup
      };
    });

    setPitcherModal(null);
    // Re-solve after state update
    setTimeout(() => generateLineup(inning), 100);
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
    const { player, inning, currentPosition } = positionModal;
    
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

    setGame(prevGame => ({
      ...prevGame,
      lineup: newLineup,
      lockedCells: newLocks,
      pitcherAssignments: newPitchers
    }));

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

    setGame(prevGame => {
      const newExited = { ...prevGame.exitedPlayers, [player.id]: exitInning };
      const newLineup = { ...prevGame.lineup };
      const newLocks = { ...prevGame.lockedCells };
      const newPitchers = { ...prevGame.pitcherAssignments };

      // Only clear assignments from exit inning forward
      for (let i = exitInning; i <= (prevGame.innings || innings); i++) {
        delete newLineup[`${player.id}-${i}`];
        delete newLocks[`${player.id}-${i}`];
        if (newPitchers[i] === player.id) {
          delete newPitchers[i];
        }
      }

      return {
        ...prevGame,
        exitedPlayers: newExited,
        lineup: newLineup,
        lockedCells: newLocks,
        pitcherAssignments: newPitchers
      };
    });

    setExitConfirm(null);

    if (action === 'resolve') {
      // Re-solve only from the exit inning forward
      setTimeout(() => generateLineup(exitInning), 100);
    }
  };

  // Handle pitch count update
  const handlePitchUpdate = (inning, count) => {
    const { player } = pitchCounterModal;
    const newPitchLog = { ...game.pitchLog };
    
    if (!newPitchLog[player.id]) {
      newPitchLog[player.id] = {};
    }
    newPitchLog[player.id][inning] = count;

    setGame({ ...game, pitchLog: newPitchLog });
  };

  // End pitching inning
  const handleEndPitchingInning = () => {
    const { player, inning } = pitchCounterModal;
    const pitcherLog = game.pitchLog?.[player.id] || {};
    const totalPitches = Object.values(pitcherLog).reduce((a, b) => a + b, 0);

    // Save to pitch history
    Storage.addPitchRecord({
      playerId: player.id,
      gameId: game.id,
      date: game.date,
      pitches: totalPitches,
      innings: pitcherLog
    });

    // Update local state
    const existingRecord = pitchHistory.find(r => 
      r.playerId === player.id && r.gameId === game.id
    );
    
    if (existingRecord) {
      setPitchHistory(pitchHistory.map(r =>
        r.id === existingRecord.id
          ? { ...r, pitches: totalPitches, innings: pitcherLog }
          : r
      ));
    } else {
      setPitchHistory([...pitchHistory, {
        id: Date.now().toString(),
        playerId: player.id,
        gameId: game.id,
        date: game.date,
        pitches: totalPitches,
        innings: pitcherLog
      }]);
    }

    setPitchCounterModal(null);
  };

  // Handle score update
  const handleScoreChange = (team, inning, value) => {
    const newScore = { ...game.score };
    if (!newScore[team]) newScore[team] = {};
    newScore[team][inning] = value;
    setGame({ ...game, score: newScore });
  };

  // Add inning
  const handleAddInning = () => {
    const newInnings = (game?.innings || settings.innings) + 1;
    const updatedGame = { ...game, innings: newInnings };
    setGame(updatedGame);
    
    // Generate lineup for new inning after state update
    setTimeout(() => {
      const result = Solver.solve({
        players: activePlayers,
        innings: newInnings,
        startInning: newInnings,
        existingPlan: updatedGame.lineup,
        lockedCells: updatedGame.lockedCells,
        pitcherAssignments: updatedGame.pitcherAssignments,
        maxSitsPerGame: settings.maxSitsPerGame
      });
      if (result.success) {
        setGame(prev => ({ ...prev, lineup: result.solution }));
      }
    }, 50);
  };

  // Save game
  const handleSaveGame = () => {
    Storage.addGame(game);
    setGames(Storage.getGames());
    alert('Game saved!');
  };

  // Handle avoid override
  const handleAvoidOverride = (override) => {
    setAvoidOverride(null);
    generateLineup(1, [override]);
  };

  // Print
  const handlePrint = () => window.print();

  if (!game) return <Alert type="error">No active game</Alert>;

  return (
    <div>
      {/* Print Header */}
      <div className="print-header">
        <h1>⚾ {game.opponent ? `vs ${game.opponent}` : 'Game Lineup'}</h1>
        <p>{new Date(game.date).toLocaleDateString()}</p>
      </div>

      {/* Errors & Warnings */}
      {error && (
        <Alert type="error">
          <strong>{error.message}</strong>
          {error.conflicts && (
            <ul style={{ marginTop: '8px', marginLeft: '16px' }}>
              {error.conflicts.map((c, i) => <li key={i}>{c}</li>)}
            </ul>
          )}
        </Alert>
      )}
      {warnings && warnings.length > 0 && (
        <Alert type="warning">
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
              setGame(prevGame => ({ ...prevGame, currentInning: inn }));
            }}
            onAddInning={handleAddInning}
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
            players={activePlayers}
            roster={roster}
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
            <button className="btn btn-secondary" onClick={() => {
              // Clear unlocked cells but preserve exited players' prior innings
              setGame(prevGame => {
                const newLineup = {};
                const lockedCells = prevGame.lockedCells || {};
                const exitedPlayers = prevGame.exitedPlayers || {};
                
                // Keep locked positions
                Object.keys(lockedCells).forEach(key => {
                  newLineup[key] = lockedCells[key];
                });
                
                // Keep exited players' positions from before they exited
                Object.entries(exitedPlayers).forEach(([playerId, exitInning]) => {
                  for (let i = 1; i < exitInning; i++) {
                    const key = `${playerId}-${i}`;
                    if (prevGame.lineup?.[key]) {
                      newLineup[key] = prevGame.lineup[key];
                    }
                  }
                });
                
                return { ...prevGame, lineup: newLineup };
              });
              setTimeout(() => generateLineup(1), 50);
            }}>
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
          totalInnings={innings}
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

      {avoidOverride && (
        <AvoidOverrideModal
          blockers={avoidOverride}
          onOverride={handleAvoidOverride}
          onClose={() => setAvoidOverride(null)}
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

// ============================================
// Pitchers Summary View
// ============================================
function PitchersView() {
  const { roster, pitchHistory, settings } = React.useContext(AppContext);
  const [expandedPitcher, setExpandedPitcher] = React.useState(null);
  const gameDate = new Date().toISOString().split('T')[0];

  const pitchers = roster.filter(p => p.canPitch);

  const getPitcherStats = (playerId) => {
    const records = pitchHistory.filter(r => r.playerId === playerId);
    const totalPitches = records.reduce((sum, r) => sum + (r.pitches || 0), 0);
    const gamesCount = records.length;
    const avgPitchesPerGame = gamesCount > 0 ? Math.round(totalPitches / gamesCount) : 0;
    
    // Get recent games (last 5)
    const recentGames = [...records]
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 5);
    
    return { totalPitches, gamesCount, avgPitchesPerGame, recentGames };
  };

  const getRestInfo = (playerId) => {
    const eligibility = Storage.getPitcherEligibility(playerId, gameDate);
    if (eligibility.eligible) {
      return { status: 'Ready', days: eligibility.daysRest, color: 'var(--success)' };
    } else {
      return { status: `${eligibility.daysNeeded}d rest needed`, days: eligibility.daysRest, color: 'var(--warning)' };
    }
  };

  return (
    <div>
      <div className="card">
        <div className="card-header">
          <div className="card-title">Pitcher Summary</div>
        </div>
        <div className="card-body no-padding">
          {pitchers.length === 0 ? (
            <EmptyState
              icon="⚾"
              title="No Pitchers"
              text="Add players who can pitch in the Roster tab"
            />
          ) : (
            pitchers.map(pitcher => {
              const stats = getPitcherStats(pitcher.id);
              const eligibility = Storage.getPitcherEligibility(pitcher.id, gameDate);
              const restInfo = getRestInfo(pitcher.id);
              const isExpanded = expandedPitcher === pitcher.id;

              return (
                <div key={pitcher.id}>
                  <div 
                    className="player-item"
                    onClick={() => setExpandedPitcher(isExpanded ? null : pitcher.id)}
                    style={{ cursor: 'pointer' }}
                  >
                    <div className="player-info">
                      <div className="player-name">
                        {pitcher.name}
                        <span style={{ marginLeft: '8px', fontSize: '12px', color: 'var(--text-tertiary)' }}>
                          {isExpanded ? '▼' : '▶'}
                        </span>
                      </div>
                      <div className="player-tags">
                        {pitcher.prefersPitching && (
                          <PlayerTag type="pitcher">Primary</PlayerTag>
                        )}
                        <PlayerTag type={eligibility.eligible ? 'eligible' : 'ineligible'}>
                          {eligibility.reason}
                        </PlayerTag>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontWeight: 600 }}>{stats.totalPitches} pitches</div>
                      <div className="text-muted text-small">{stats.gamesCount} games</div>
                    </div>
                  </div>
                  
                  {isExpanded && (
                    <div style={{ 
                      padding: '12px 16px', 
                      background: 'var(--bg-secondary)',
                      borderBottom: '1px solid var(--border-light)'
                    }}>
                      {/* Stats Grid */}
                      <div style={{ 
                        display: 'grid', 
                        gridTemplateColumns: 'repeat(3, 1fr)', 
                        gap: '12px',
                        marginBottom: '12px'
                      }}>
                        <div style={{ textAlign: 'center' }}>
                          <div style={{ fontSize: '20px', fontWeight: 600 }}>{stats.totalPitches}</div>
                          <div className="text-muted text-small">Total Pitches</div>
                        </div>
                        <div style={{ textAlign: 'center' }}>
                          <div style={{ fontSize: '20px', fontWeight: 600 }}>{stats.avgPitchesPerGame}</div>
                          <div className="text-muted text-small">Avg/Game</div>
                        </div>
                        <div style={{ textAlign: 'center' }}>
                          <div style={{ fontSize: '20px', fontWeight: 600, color: restInfo.color }}>
                            {eligibility.eligible ? '✓' : restInfo.status}
                          </div>
                          <div className="text-muted text-small">
                            {restInfo.days !== null ? `${restInfo.days}d since last` : 'No history'}
                          </div>
                        </div>
                      </div>
                      
                      {/* Recent Games */}
                      {stats.recentGames.length > 0 && (
                        <div>
                          <div className="text-muted text-small" style={{ marginBottom: '8px' }}>Recent Games</div>
                          {stats.recentGames.map((game, idx) => (
                            <div 
                              key={idx}
                              style={{ 
                                display: 'flex', 
                                justifyContent: 'space-between',
                                padding: '4px 0',
                                borderBottom: idx < stats.recentGames.length - 1 ? '1px solid var(--border-light)' : 'none'
                              }}
                            >
                              <span className="text-small">{new Date(game.date).toLocaleDateString()}</span>
                              <span className="text-small" style={{ fontWeight: 500 }}>{game.pitches} pitches</span>
                            </div>
                          ))}
                        </div>
                      )}
                      
                      {stats.recentGames.length === 0 && (
                        <div className="text-muted text-small">No pitching history recorded</div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================
// Game History View
// ============================================
function HistoryView() {
  const { games } = React.useContext(AppContext);

  const sortedGames = [...games].sort((a, b) => new Date(b.date) - new Date(a.date));

  return (
    <div>
      <div className="card">
        <div className="card-header">
          <div className="card-title">Past Games</div>
        </div>
        <div className="card-body no-padding">
          {sortedGames.length === 0 ? (
            <EmptyState
              icon="📋"
              title="No Games Yet"
              text="Start a game and save it to see it here"
            />
          ) : (
            sortedGames.map(g => {
              const usScore = Object.values(g.score?.us || {}).reduce((a, b) => a + b, 0);
              const themScore = Object.values(g.score?.them || {}).reduce((a, b) => a + b, 0);
              const result = usScore > themScore ? 'W' : usScore < themScore ? 'L' : 'T';

              return (
                <div key={g.id} className="player-item" style={{ cursor: 'default' }}>
                  <div className="player-info">
                    <div className="player-name">
                      {g.opponent ? `vs ${g.opponent}` : 'Game'}
                    </div>
                    <div className="text-muted text-small">
                      {new Date(g.date).toLocaleDateString()}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: 600 }}>{usScore} - {themScore}</div>
                    <div 
                      className="text-small"
                      style={{ 
                        color: result === 'W' ? 'var(--success)' : 
                               result === 'L' ? 'var(--danger)' : 
                               'var(--text-secondary)'
                      }}
                    >
                      {result}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
