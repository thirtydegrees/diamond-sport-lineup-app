/* ============================================
   Diamond Lineup - Game History View
   ============================================ */

import React from 'react';
import { getPositionColorClass } from '../domain/constants';
import { compareDatesDesc, formatDateDisplay } from '../domain/dates';
import { AppContext } from '../state/AppContext';
import { Storage } from '../services/storage';
import { ConfirmDialog, EmptyState } from '../components/ui';

/** Read-only snapshot of a saved game's defensive lineup. */
function GameLineupSnapshot({ game, roster }) {
  const innings = game.innings || 6;
  const players = (game.battingOrder || [])
    .map(id => roster.find(p => p.id === id) || { id, name: '(removed)' });

  if (players.length === 0 || Object.keys(game.lineup || {}).length === 0) {
    return <p className="text-muted text-small">No lineup was recorded for this game.</p>;
  }

  return (
    <div className="lineup-wrapper">
      <div
        className="lineup-grid"
        style={{ gridTemplateColumns: `minmax(90px, auto) repeat(${innings}, minmax(40px, 1fr))` }}
      >
        <div className="lineup-cell header player-col">Batting</div>
        {Array.from({ length: innings }, (_, i) => (
          <div key={i} className="lineup-cell header">{i + 1}</div>
        ))}
        {players.map((player, idx) => (
          <React.Fragment key={player.id}>
            <div className="lineup-cell player-col" style={{ cursor: 'default' }}>
              <span style={{ width: '20px', fontSize: '12px', color: 'var(--text-secondary)', textAlign: 'right', flexShrink: 0 }}>
                {idx + 1}
              </span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {player.name}
              </span>
            </div>
            {Array.from({ length: innings }, (_, i) => {
              const pos = game.lineup?.[`${player.id}-${i + 1}`];
              return (
                <div key={i} className="lineup-cell" style={{ cursor: 'default' }}>
                  {pos ? <span className={`pos-text ${getPositionColorClass(pos)}`}>{pos}</span> : ''}
                </div>
              );
            })}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

function GameDetail({ game, roster, onDelete }) {
  // Pitch totals from the in-game log
  const pitchTotals = Object.entries(game.pitchLog || {})
    .map(([playerId, log]) => ({
      name: roster.find(p => p.id === playerId)?.name || '(removed)',
      pitches: Object.values(log).reduce((a, b) => a + b, 0)
    }))
    .filter(p => p.pitches > 0);

  return (
    <div style={{
      padding: 'var(--space-md) var(--space-lg)',
      background: 'var(--bg-secondary)',
      borderBottom: '1px solid var(--border-light)'
    }}>
      <GameLineupSnapshot game={game} roster={roster} />

      {pitchTotals.length > 0 && (
        <div style={{ marginTop: 'var(--space-md)' }}>
          <div className="text-muted text-small" style={{ marginBottom: '4px' }}>Pitches thrown</div>
          {pitchTotals.map((p, i) => (
            <span key={i} className="text-small" style={{ marginRight: 'var(--space-md)' }}>
              <strong>{p.name}</strong> {p.pitches}
            </span>
          ))}
        </div>
      )}

      <div style={{ marginTop: 'var(--space-md)' }}>
        <button className="btn btn-sm btn-danger" onClick={onDelete}>
          🗑️ Delete Game
        </button>
      </div>
    </div>
  );
}

export function HistoryView() {
  const { games, setGames, roster, setPitchHistory, showToast } = React.useContext(AppContext);
  const [expandedId, setExpandedId] = React.useState(null);
  const [deleteTarget, setDeleteTarget] = React.useState(null);

  const sortedGames = [...games].sort((a, b) => compareDatesDesc(a.date, b.date));

  const handleDelete = () => {
    Storage.deleteGame(deleteTarget.id);
    setGames(Storage.getGames());
    setPitchHistory(Storage.getPitchHistory());
    setExpandedId(null);
    showToast('Game deleted');
    setDeleteTarget(null);
  };

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
              const isExpanded = expandedId === g.id;

              return (
                <div key={g.id}>
                  <div
                    className="player-item"
                    onClick={() => setExpandedId(isExpanded ? null : g.id)}
                  >
                    <div className="player-info">
                      <div className="player-name">
                        {g.opponent ? `vs ${g.opponent}` : 'Game'}
                        <span style={{ marginLeft: '8px', fontSize: '12px', color: 'var(--text-tertiary)' }}>
                          {isExpanded ? '▼' : '▶'}
                        </span>
                      </div>
                      <div className="text-muted text-small">
                        {formatDateDisplay(g.date)}
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

                  {isExpanded && (
                    <GameDetail
                      game={g}
                      roster={roster}
                      onDelete={() => setDeleteTarget(g)}
                    />
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {deleteTarget && (
        <ConfirmDialog
          title="Delete Game"
          message={`Delete the ${formatDateDisplay(deleteTarget.date)} game${deleteTarget.opponent ? ` vs ${deleteTarget.opponent}` : ''}? Season stats will no longer include it.`}
          confirmLabel="Delete"
          danger
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
