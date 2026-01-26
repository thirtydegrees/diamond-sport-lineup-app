/* ============================================
   Youth Baseball Lineup - Lineup Grid Component
   ============================================ */

function LineupGrid({ 
  game, 
  players, 
  roster,
  onCellClick,
  onScoreChange
}) {
  const [scoreEdit, setScoreEdit] = React.useState(null);
  
  const innings = game?.innings || 7;
  
  // Get all players in batting order (including exited - they show grayed out)
  const allPlayers = React.useMemo(() => {
    if (!game?.battingOrder) return [];
    return game.battingOrder
      .map(id => roster.find(p => p.id === id))
      .filter(Boolean);
  }, [game?.battingOrder, roster]);
  
  const exitedPlayers = game?.exitedPlayers || {};

  // Calculate which batting position each active player has
  const getBattingPosition = (playerId) => {
    const activeIds = game.battingOrder.filter(id => !exitedPlayers[id]);
    const idx = activeIds.indexOf(playerId);
    return idx >= 0 ? idx + 1 : '-';
  };

  // Calculate totals for score
  const usTotal = Object.values(game?.score?.us || {}).reduce((a, b) => a + b, 0);
  const themTotal = Object.values(game?.score?.them || {}).reduce((a, b) => a + b, 0);

  const handleScoreClick = (team, inning) => {
    setScoreEdit({ team, inning });
  };

  const handleScoreUpdate = (value) => {
    if (scoreEdit) {
      onScoreChange(scoreEdit.team, scoreEdit.inning, value);
    }
  };

  return (
    <div>
      {/* Lineup Grid */}
      <div className="lineup-wrapper">
        <div 
          className="lineup-grid"
          style={{ 
            gridTemplateColumns: `minmax(100px, auto) repeat(${innings}, minmax(52px, 1fr))` 
          }}
        >
          {/* Header Row */}
          <div className="lineup-cell header player-col">Batting</div>
          {Array.from({ length: innings }, (_, i) => (
            <div key={i} className="lineup-cell header">
              {i + 1}
            </div>
          ))}

          {/* Player Rows */}
          {allPlayers.map((player) => {
            if (!player) return null;
            
            const playerId = player.id;
            const isExited = !!exitedPlayers[playerId];
            const exitedInning = exitedPlayers[playerId];
            const battingPos = getBattingPosition(playerId);

            return (
              <React.Fragment key={playerId}>
                {/* Player Name Cell */}
                <div className={`lineup-cell player-col ${isExited ? 'exited' : ''}`}>
                  <span style={{ 
                    width: '24px', 
                    fontSize: '12px', 
                    color: 'var(--text-secondary)',
                    textAlign: 'right',
                    flexShrink: 0
                  }}>
                    {battingPos}
                  </span>
                  <span style={{ 
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    textDecoration: isExited ? 'line-through' : 'none'
                  }}>
                    {player.name}
                  </span>
                </div>

                {/* Inning Cells */}
                {Array.from({ length: innings }, (_, i) => {
                  const inning = i + 1;
                  const key = `${playerId}-${inning}`;
                  const position = game.lineup?.[key];
                  const isLocked = !!game.lockedCells?.[key];
                  const isAfterExit = isExited && inning >= exitedInning;
                  const colorClass = position ? getPositionColorClass(position) : '';
                  const isEmpty = !position && !isAfterExit;

                  return (
                    <div
                      key={key}
                      className={`lineup-cell ${isLocked ? 'locked' : ''} ${isEmpty ? 'empty-cell' : ''}`}
                      style={isAfterExit ? { background: 'var(--bg-tertiary)', color: 'var(--text-tertiary)' } : {}}
                      onClick={() => {
                        if (!isAfterExit) {
                          onCellClick(player, inning, position || null, isLocked);
                        }
                      }}
                    >
                      {isAfterExit ? (
                        <span style={{ color: 'var(--text-tertiary)', fontWeight: 500 }}>OUT</span>
                      ) : position ? (
                        <span className={`pos-text ${colorClass}`}>
                          {position}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-tertiary)', fontSize: '18px' }}>+</span>
                      )}
                    </div>
                  );
                })}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* Score Section */}
      <div className="score-section">
        {/* Us Row */}
        <div className="score-row">
          <span className="score-label">Us</span>
          <div className="score-cells">
            {Array.from({ length: innings }, (_, i) => {
              const inning = i + 1;
              const value = game.score?.us?.[inning];
              const isEditing = scoreEdit?.team === 'us' && scoreEdit?.inning === inning;

              return (
                <div
                  key={inning}
                  className={`score-cell ${isEditing ? 'editing' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (isEditing) {
                      setScoreEdit(null);
                    } else {
                      setScoreEdit({ team: 'us', inning });
                    }
                  }}
                  style={{ position: 'relative' }}
                >
                  {isEditing ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                      <button
                        onClick={(e) => { e.stopPropagation(); onScoreChange('us', inning, Math.max(0, (value || 0) - 1)); }}
                        style={{ width: '20px', height: '24px', border: 'none', background: 'var(--bg-secondary)', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
                      >−</button>
                      <span style={{ minWidth: '20px', textAlign: 'center' }}>{value || 0}</span>
                      <button
                        onClick={(e) => { e.stopPropagation(); onScoreChange('us', inning, (value || 0) + 1); }}
                        style={{ width: '20px', height: '24px', border: 'none', background: 'var(--bg-secondary)', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
                      >+</button>
                    </div>
                  ) : (
                    value !== undefined ? value : ''
                  )}
                </div>
              );
            })}
            <div className="score-cell total">{usTotal}</div>
          </div>
        </div>

        {/* Them Row */}
        <div className="score-row">
          <span className="score-label">Them</span>
          <div className="score-cells">
            {Array.from({ length: innings }, (_, i) => {
              const inning = i + 1;
              const value = game.score?.them?.[inning];
              const isEditing = scoreEdit?.team === 'them' && scoreEdit?.inning === inning;

              return (
                <div
                  key={inning}
                  className={`score-cell ${isEditing ? 'editing' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (isEditing) {
                      setScoreEdit(null);
                    } else {
                      setScoreEdit({ team: 'them', inning });
                    }
                  }}
                  style={{ position: 'relative' }}
                >
                  {isEditing ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                      <button
                        onClick={(e) => { e.stopPropagation(); onScoreChange('them', inning, Math.max(0, (value || 0) - 1)); }}
                        style={{ width: '20px', height: '24px', border: 'none', background: 'var(--bg-secondary)', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
                      >−</button>
                      <span style={{ minWidth: '20px', textAlign: 'center' }}>{value || 0}</span>
                      <button
                        onClick={(e) => { e.stopPropagation(); onScoreChange('them', inning, (value || 0) + 1); }}
                        style={{ width: '20px', height: '24px', border: 'none', background: 'var(--bg-secondary)', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
                      >+</button>
                    </div>
                  ) : (
                    value !== undefined ? value : ''
                  )}
                </div>
              );
            })}
            <div className="score-cell total">{themTotal}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================
// Lineup Stats Component
// ============================================
function LineupStats({ game, players }) {
  const stats = React.useMemo(() => {
    if (!game?.lineup) return { playerCount: 0, innings: 0, maxSits: 0, sitGap: 0 };

    const innings = game.innings || 7;
    const activePlayers = game.battingOrder
      .filter(id => !game.exitedPlayers?.[id])
      .map(id => players.find(p => p.id === id))
      .filter(Boolean);

    // Calculate sit counts
    const sitCounts = {};
    activePlayers.forEach(player => {
      sitCounts[player.id] = 0;
      for (let i = 1; i <= innings; i++) {
        if (game.lineup[`${player.id}-${i}`] === 'SIT') {
          sitCounts[player.id]++;
        }
      }
    });

    const sitValues = Object.values(sitCounts);
    const maxSits = sitValues.length ? Math.max(...sitValues) : 0;
    const minSits = sitValues.length ? Math.min(...sitValues) : 0;

    return {
      playerCount: activePlayers.length,
      innings,
      maxSits,
      sitGap: maxSits - minSits
    };
  }, [game, players]);

  return (
    <div className="stats-grid">
      <StatCard value={stats.playerCount} label="Players" />
      <StatCard value={stats.innings} label="Innings" />
      <StatCard value={stats.maxSits} label="Most Sits" title="Most innings sat by any player" />
      <StatCard value={stats.sitGap} label="Sit Spread" title="Difference between most and fewest sits" />
    </div>
  );
}

// ============================================
// Pitcher Assignments Row
// ============================================
function PitcherAssignments({ game, roster, onAssignClick }) {
  const innings = game?.innings || 7;

  return (
    <div style={{ display: 'flex', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
      {Array.from({ length: innings }, (_, i) => {
        const inning = i + 1;
        const pitcherId = game.pitcherAssignments?.[inning];
        const pitcher = roster.find(p => p.id === pitcherId);

        return (
          <button
            key={inning}
            className={`btn ${pitcher ? 'btn-primary' : 'btn-secondary'}`}
            style={{ 
              minWidth: '75px', 
              flexDirection: 'column', 
              height: 'auto', 
              padding: 'var(--space-sm)',
              gap: '2px'
            }}
            onClick={() => onAssignClick(inning)}
          >
            <span style={{ fontSize: '11px', opacity: 0.8 }}>Inn {inning}</span>
            <span style={{ fontSize: '13px', fontWeight: 600 }}>
              {pitcher ? pitcher.name.split(' ')[0] : '+ Assign'}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ============================================
// Inning Selector
// ============================================
function InningSelector({ currentInning, totalInnings, onChange, onAddInning }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)', flexWrap: 'wrap' }}>
      <span style={{ fontWeight: 500 }}>Current Inning:</span>
      <div style={{ display: 'flex', gap: 'var(--space-xs)', flexWrap: 'wrap' }}>
        {Array.from({ length: totalInnings }, (_, i) => (
          <button
            key={i}
            className={`btn btn-sm ${currentInning === i + 1 ? 'btn-primary' : 'btn-secondary'}`}
            style={{ minWidth: '40px' }}
            onClick={() => onChange(i + 1)}
          >
            {i + 1}
          </button>
        ))}
        <button
          className="btn btn-sm btn-ghost"
          onClick={onAddInning}
          title="Add inning"
        >
          +
        </button>
      </div>
    </div>
  );
}
