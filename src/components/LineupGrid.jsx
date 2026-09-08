import { AppContext } from '../state/AppContext';
/* ============================================
   Diamond Lineup - Lineup Grid Component
   ============================================ */

import React from 'react';
import { getPositionColorClass } from '../domain/constants';
import { StatCard } from './ui';

export function LineupGrid({
  game,
  roster,
  currentInning,
  onCellClick,
  onScoreChange
}) {
  const { activeTeam } = React.useContext(AppContext);
  const [scoreEdit, setScoreEdit] = React.useState(null);

  const innings = Math.max(game?.innings || 7, game?.live?.inning || 1, ...Object.keys(game?.score?.us || {}).map(Number), ...Object.keys(game?.score?.them || {}).map(Number));

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

  const renderScoreRow = (team, label, total) => (
    <div className="score-row">
      <span className="score-label">{label}</span>
      <div className="score-cells">
        {Array.from({ length: innings }, (_, i) => {
          const inning = i + 1;
          const value = game.score?.[team]?.[inning];
          const isEditing = scoreEdit?.team === team && scoreEdit?.inning === inning;

          return (
            <div
              key={inning}
              className={`score-cell ${isEditing ? 'editing' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                if (isEditing) {
                  setScoreEdit(null);
                } else {
                  setScoreEdit({ team, inning });
                }
              }}
              style={{ position: 'relative' }}
            >
              {isEditing ? (
                <div className="score-edit">
                  <button
                    className="score-step-btn"
                    onClick={(e) => { e.stopPropagation(); onScoreChange(team, inning, Math.max(0, (value || 0) - 1)); }}
                    aria-label="Minus one run"
                  >−</button>
                  <span className="score-edit-value">{value || 0}</span>
                  <button
                    className="score-step-btn"
                    onClick={(e) => { e.stopPropagation(); onScoreChange(team, inning, (value || 0) + 1); }}
                    aria-label="Plus one run"
                  >+</button>
                </div>
              ) : (
                <span className="score-value">{value !== undefined ? value : ''}</span>
              )}
            </div>
          );
        })}
        <div className="score-cell total"><span className="score-value">{total}</span></div>
      </div>
    </div>
  );

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
            <div key={i} className={`lineup-cell header ${currentInning === i + 1 ? 'current' : ''}`}>
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
                      className={`lineup-cell ${isLocked ? 'locked' : ''} ${isEmpty ? 'empty-cell' : ''} ${currentInning === inning ? 'current-col' : ''}`}
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
                        <span className="empty-plus">+</span>
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
      <div className="score-section" role="region" aria-label="Score by inning" tabIndex={0}>
        <div className="score-table" style={{gridTemplateColumns: `120px ${Array.from({length: innings}, (_, i) => scoreEdit?.inning === i + 1 ? '120px' : '52px').join(' ')} 56px`}}>
        <strong className="score-heading">Team / Inning</strong>
        {Array.from({length: innings}, (_, i) => <strong className="score-heading" key={i}>{i + 1}</strong>)}
        <strong className="score-heading">Total</strong>
        {renderScoreRow('us', activeTeam?.teamName || 'Our Team', usTotal)}
        {renderScoreRow('them', game.opponent || 'Opponent', themTotal)}
        </div>
      </div>
    </div>
  );
}

// ============================================
// Lineup Stats Component
// ============================================
export function LineupStats({ game, players }) {
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
