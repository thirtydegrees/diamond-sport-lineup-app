/* ============================================
   Diamond Lineup - Game History View

   Completed games are the authoritative record. Each entry
   shows ACTUAL participation (recorded outs) plus the plan
   grid, and every pitcher's confirmed count stays correctable
   here - fixing a count immediately re-derives eligibility and
   rest everywhere (workload is computed from games, not stored
   separately).
   ============================================ */

import React from 'react';
import { getPositionColorClass } from '../domain/constants';
import { compareDatesDesc, formatDateDisplay } from '../domain/dates';
import {
  correctConfirmedPitches,
  formatOutsAsInnings,
  getPitchCountEntry,
  participationByPlayer,
  pitchingOutsByPlayer
} from '../domain/games';
import { AppContext } from '../state/AppContext';
import { ConfirmDialog, EmptyState } from '../components/ui';

/** Read-only snapshot of a saved game's planned lineup grid. */
function GameLineupSnapshot({ game, playerName }) {
  const innings = game.innings || 6;
  const players = (game.battingOrder || []).map(id => ({ id, name: playerName(id) }));

  if (players.length === 0 || Object.keys(game.lineup || {}).length === 0) {
    return null;
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

/** Actual participation summary derived from the game's out ledger. */
function ParticipationSummary({ game, playerName }) {
  const participation = participationByPlayer(game);
  const rows = Object.entries(participation);
  if (rows.length === 0) {
    return (
      <p className="text-muted text-small">
        No defensive outs were recorded for this game (score only).
      </p>
    );
  }

  // Keep batting-order order, then anyone else in the ledger
  const ordered = [
    ...(game.battingOrder || []).filter(id => participation[id]),
    ...rows.map(([id]) => id).filter(id => !(game.battingOrder || []).includes(id))
  ];

  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="stats-table">
        <thead>
          <tr><th>Player</th><th>Played</th><th>Bench</th></tr>
        </thead>
        <tbody>
          {ordered.map(id => {
            const byPos = participation[id];
            const positions = Object.entries(byPos)
              .filter(([pos]) => pos !== 'SIT')
              .sort(([, a], [, b]) => b - a)
              .map(([pos, outs]) => `${pos} ${formatOutsAsInnings(outs)}`)
              .join(' · ');
            const sitOuts = byPos.SIT || 0;
            return (
              <tr key={id}>
                <td>{playerName(id)}</td>
                <td>{positions || '—'}</td>
                <td>{sitOuts ? formatOutsAsInnings(sitOuts) : ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** One pitcher's confirmed count with inline correction. */
function PitchCountRow({ game, playerId, playerName, onCorrect }) {
  const entry = getPitchCountEntry(game, playerId);
  const outs = pitchingOutsByPlayer(game)[playerId] || 0;
  const [editing, setEditing] = React.useState(false);
  const [value, setValue] = React.useState('');

  const commit = () => {
    const n = parseInt(value, 10);
    if (Number.isFinite(n) && n >= 0) {
      onCorrect(playerId, n);
      setEditing(false);
    }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 0', borderBottom: '1px solid var(--border-light)' }}>
      <div style={{ flex: 1 }}>
        <strong className="text-small">{playerName(playerId)}</strong>
        <span className="text-muted text-small" style={{ marginLeft: '8px' }}>
          {outs > 0 ? `${formatOutsAsInnings(outs)} inn pitched` : 'no pitching outs'}
        </span>
      </div>
      {editing ? (
        <>
          <input
            type="number"
            inputMode="numeric"
            className="form-input"
            style={{ width: '70px', textAlign: 'center', padding: '4px' }}
            value={value}
            min={0}
            autoFocus
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
            aria-label={`Corrected pitches for ${playerName(playerId)}`}
          />
          <button className="btn btn-sm btn-primary" onClick={commit}>Save</button>
          <button className="btn btn-sm btn-ghost" onClick={() => setEditing(false)}>✕</button>
        </>
      ) : (
        <>
          <span className="text-small" style={{ fontWeight: 600, color: entry.status === 'unknown' ? 'var(--warning)' : 'inherit' }}>
            {entry.status === 'unknown' ? '⚠ count needed' : `${entry.confirmed ?? entry.live} pitches`}
          </span>
          <button
            className="btn btn-sm btn-secondary"
            onClick={() => { setValue(String(entry.confirmed ?? entry.live)); setEditing(true); }}
          >
            ✏️
          </button>
        </>
      )}
    </div>
  );
}

function GameDetail({ game, playerName, onDelete, onCorrectPitches }) {
  const pitcherIds = new Set([
    ...Object.keys(pitchingOutsByPlayer(game)),
    ...Object.entries(game.pitchCounts || {})
      .filter(([, e]) => e.status === 'unknown' || (e.confirmed ?? e.live) > 0)
      .map(([pid]) => pid)
  ]);

  return (
    <div style={{
      padding: 'var(--space-md) var(--space-lg)',
      background: 'var(--bg-secondary)',
      borderBottom: '1px solid var(--border-light)'
    }}>
      {game.participationQuality === 'estimated' && (
        <p className="text-small" style={{ color: 'var(--warning)', marginBottom: 'var(--space-sm)' }}>
          Estimated participation: this game predates out-level tracking, so
          playing time was reconstructed from its inning plan.
        </p>
      )}

      <div className="text-muted text-small" style={{ marginBottom: '4px' }}>Actual playing time</div>
      <ParticipationSummary game={game} playerName={playerName} />

      {pitcherIds.size > 0 && (
        <div style={{ marginTop: 'var(--space-md)' }}>
          <div className="text-muted text-small" style={{ marginBottom: '4px' }}>
            Final pitch counts (tap ✏️ to correct - eligibility updates immediately)
          </div>
          {[...pitcherIds].map(pid => (
            <PitchCountRow
              key={pid}
              game={game}
              playerId={pid}
              playerName={playerName}
              onCorrect={onCorrectPitches}
            />
          ))}
        </div>
      )}

      <div style={{ marginTop: 'var(--space-md)' }}>
        <div className="text-muted text-small" style={{ marginBottom: '4px' }}>Planned lineup</div>
        <GameLineupSnapshot game={game} playerName={playerName} />
      </div>

      <div style={{ marginTop: 'var(--space-md)' }}>
        <button className="btn btn-sm btn-danger" onClick={onDelete}>
          🗑️ Delete Game
        </button>
      </div>
    </div>
  );
}

export function HistoryView() {
  const { games, setGames, roster, showToast } = React.useContext(AppContext);
  const [expandedId, setExpandedId] = React.useState(null);
  const [deleteTarget, setDeleteTarget] = React.useState(null);

  const sortedGames = [...games].sort((a, b) => compareDatesDesc(a.date, b.date));

  const makePlayerName = (game) => (id) =>
    roster.find(p => p.id === id)?.name || game.playerNames?.[id] || '(removed)';

  const handleDelete = () => {
    setGames(games.filter(g => g.id !== deleteTarget.id));
    setExpandedId(null);
    showToast('Game deleted - its workload and stats are gone with it');
    setDeleteTarget(null);
  };

  const handleCorrectPitches = (gameId) => (playerId, pitches) => {
    setGames(games.map(g => (g.id === gameId ? correctConfirmedPitches(g, playerId, pitches) : g)));
    showToast('Pitch count corrected - eligibility now uses the new total');
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
              text="Play a game and complete it to see it here"
            />
          ) : (
            sortedGames.map(g => {
              const usScore = Object.values(g.score?.us || {}).reduce((a, b) => a + b, 0);
              const themScore = Object.values(g.score?.them || {}).reduce((a, b) => a + b, 0);
              const result = usScore > themScore ? 'W' : usScore < themScore ? 'L' : 'T';
              const isExpanded = expandedId === g.id;
              const countsNeeded = Object.values(g.pitchCounts || {}).filter(e => e.status === 'unknown').length;

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
                        {countsNeeded > 0 && (
                          <span className="text-small" style={{ marginLeft: '8px', color: 'var(--warning)' }}>
                            ⚠ pitch count needed
                          </span>
                        )}
                      </div>
                      <div className="text-muted text-small">
                        {formatDateDisplay(g.date)}
                        {g.participationQuality === 'estimated' ? ' · estimated' : ''}
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
                      playerName={makePlayerName(g)}
                      onDelete={() => setDeleteTarget(g)}
                      onCorrectPitches={handleCorrectPitches(g.id)}
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
          message={`Delete the ${formatDateDisplay(deleteTarget.date)} game${deleteTarget.opponent ? ` vs ${deleteTarget.opponent}` : ''}? Its playing time and pitching workload disappear from season stats and rest eligibility.`}
          confirmLabel="Delete"
          danger
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
