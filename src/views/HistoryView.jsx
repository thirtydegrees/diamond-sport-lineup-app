import { isOutsideWorkload } from '../domain/games';
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
import { getFieldingPositions, getPositionColorClass } from '../domain/constants';
import { compareDatesDesc, formatDateDisplay } from '../domain/dates';
import {
  correctConfirmedPitches,
  deleteOutAt,
  editOutAssignments,
  formatOutsAsInnings,
  getPitchCountEntry,
  insertOutAfter,
  participationByPlayer,
  pitchingOutsByPlayer,
  validateFormation
} from '../domain/games';
import { AppContext } from '../state/AppContext';
import { ConfirmDialog, EmptyState, Modal } from '../components/ui';

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
  const [ack, setAck] = React.useState(false);

  const commit = () => {
    const n = Number(value);
    if (value.trim() && Number.isInteger(n) && n >= 0 && (n > 0 || ack)) {
      onCorrect(playerId, n);
      setEditing(false);
    }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 0', borderBottom: '1px solid var(--border-light)' }}>
      <div style={{ flex: 1 }}>
        <strong className="text-small">{playerName(playerId)}</strong>
        <span className="text-muted text-small" style={{ marginLeft: '8px' }}>
          {isOutsideWorkload(game) ? 'Outside pitching' : outs > 0 ? `${formatOutsAsInnings(outs)} inn pitched` : 'no pitching outs'}
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
          {value === '0' && <label className="text-small"><input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)}/>I verified exactly zero pitches</label>}
          <button className="btn btn-sm btn-primary" onClick={commit}>Save</button>
          <button className="btn btn-sm btn-secondary" onClick={()=>{onCorrect(playerId,null);setEditing(false);}}>Count Unknown</button>
          <button className="btn btn-sm btn-ghost" onClick={() => setEditing(false)}>✕</button>
        </>
      ) : (
        <>
          <span className="text-small" style={{ fontWeight: 600, color: entry.status === 'unknown' ? 'var(--warning)' : 'inherit' }}>
            {entry.status === 'unknown' ? '⚠ count needed' : `${entry.confirmed ?? entry.live} pitches`}
          </span>
          <button
            className="btn btn-sm btn-secondary"
            onClick={() => { setValue(String(entry.confirmed ?? entry.live)); setAck(false); setEditing(true); }}
          >
            ✏️
          </button>
        </>
      )}
    </div>
  );
}

/* ============================================
   Participation editor

   Game-day entry mistakes are expected: a missed out, a wrong
   formation, a substitution recorded late. The out ledger stays
   the single source of truth, so corrections replace snapshots
   directly and every derived number (fairness, innings pitched,
   eligibility) recomputes automatically.
   ============================================ */

function OutFormationEditor({ game, out, playerName, onSave, onClose }) {
  const positions = getFieldingPositions(game.fielderCount);
  const playerIds = [...new Set([
    ...(game.battingOrder || []),
    ...Object.keys(out.assignments)
  ])];
  const [assignments, setAssignments] = React.useState({ ...out.assignments });

  const issues = validateFormation(assignments, Object.keys(assignments), game.fielderCount)
    .filter(i => i.type === 'duplicate' || i.type === 'vacant');

  return (
    <Modal
      title={`Inning ${out.inning} · Out ${out.outInInning}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => onSave(assignments)}>
            Save Correction
          </button>
        </>
      }
    >
      <p className="text-muted text-small mb-md">
        Set where each player actually was when this out was recorded.
      </p>
      {playerIds.map(pid => (
        <div key={pid} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 0' }}>
          <span className="text-small" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {playerName(pid)}
          </span>
          <select
            className="form-select"
            style={{ width: '110px', padding: '4px 8px' }}
            value={assignments[pid] || 'OUT'}
            onChange={(e) => {
              const val = e.target.value;
              setAssignments(prev => {
                const next = { ...prev };
                if (val === 'OUT') delete next[pid];
                else next[pid] = val;
                return next;
              });
            }}
            aria-label={`Position for ${playerName(pid)}`}
          >
            {positions.map(pos => <option key={pos} value={pos}>{pos}</option>)}
            <option value="SIT">Bench</option>
            <option value="OUT">Not present</option>
          </select>
        </div>
      ))}
      {issues.length > 0 && (
        <p className="text-small" style={{ color: 'var(--warning)', marginTop: '8px' }}>
          {issues.map(i => i.message).join(' · ')}
        </p>
      )}
    </Modal>
  );
}

function ParticipationEditor({ game, playerName, onChange }) {
  const [editSeq, setEditSeq] = React.useState(null);
  const [deleteSeq, setDeleteSeq] = React.useState(null);

  const editingOut = editSeq != null ? game.outs.find(o => o.seq === editSeq) : null;

  const summarize = (out) => {
    const p = Object.entries(out.assignments).find(([, pos]) => pos === 'P');
    const sits = Object.values(out.assignments).filter(pos => pos === 'SIT').length;
    return `P: ${p ? playerName(p[0]).split(' ')[0] : '—'} · bench ${sits}`;
  };

  return (
    <div style={{ marginTop: 'var(--space-sm)' }}>
      {game.outs.length === 0 && <button className="btn btn-secondary" onClick={()=>{onChange(insertOutAfter(game,0));setEditSeq(1);}}>Add First Out</button>}
      {game.outs.map(out => (
        <div
          key={out.seq}
          style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 0', borderBottom: '1px solid var(--border-light)' }}
        >
          <span className="text-small" style={{ flex: 1 }}>
            <strong>Inn {out.inning} · out {out.outInInning}</strong>
            <span className="text-muted"> {summarize(out)}{out.estimated ? ' (est.)' : ''}</span>
          </span>
          <button className="btn btn-sm btn-secondary" onClick={() => setEditSeq(out.seq)} title="Correct this out's formation">
            ✏️
          </button>
          <button
            className="btn btn-sm btn-secondary"
            onClick={() => onChange(insertOutAfter(game, out.seq))}
            title="Insert a missed out after this one (same defense; edit it after)"
          >
            +
          </button>
          <button className="btn btn-sm btn-ghost" onClick={() => setDeleteSeq(out.seq)} title="Delete this out">
            🗑
          </button>
        </div>
      ))}
      <p className="form-hint" style={{ marginTop: '6px' }}>
        Outs stay in order, three per inning - inserting or deleting renumbers
        the rest. All stats and eligibility recompute from the corrected ledger.
      </p>

      {editingOut && (
        <OutFormationEditor
          game={game}
          out={editingOut}
          playerName={playerName}
          onSave={(assignments) => {
            onChange(editOutAssignments(game, editingOut.seq, assignments));
            setEditSeq(null);
          }}
          onClose={() => setEditSeq(null)}
        />
      )}

      {deleteSeq != null && (
        <ConfirmDialog
          title="Delete This Out"
          message="Remove this recorded out? Later outs shift up to fill the gap, and all participation and pitching numbers recompute."
          confirmLabel="Delete Out"
          danger
          onConfirm={() => { onChange(deleteOutAt(game, deleteSeq)); setDeleteSeq(null); }}
          onCancel={() => setDeleteSeq(null)}
        />
      )}
    </div>
  );
}

function GameDetail({ game, playerName, onDelete, onCorrectPitches, onUpdateGame }) {
  const [editParticipation, setEditParticipation] = React.useState(false);
  const pitcherIds = new Set([
    ...(game.pitchingAppearances || []),
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

      {!isOutsideWorkload(game) && <>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
        <span className="text-muted text-small" style={{ flex: 1 }}>Actual playing time</span>
        {(
          <button className="btn btn-sm btn-secondary" onClick={() => setEditParticipation(v => !v)}>
            {editParticipation ? 'Done Editing' : '✏️ Fix Participation'}
          </button>
        )}
      </div>
      {editParticipation ? (
        <ParticipationEditor game={game} playerName={playerName} onChange={onUpdateGame} />
      ) : (
        <ParticipationSummary game={game} playerName={playerName} />
      )}

      </>}
      {isOutsideWorkload(game) && <p className="text-small">Outside pitching · {game.workloadSource}. Counts toward pitching workload and rest, without recording a team game or defensive participation.</p>}
      {!isOutsideWorkload(game) && <label className="text-small">Add a missed pitcher (including zero outs)<select className="form-select" value="" onChange={e=>{if(e.target.value)onCorrectPitches(e.target.value,null);}}><option value="">Choose player</option>{game.battingOrder.filter(id=>!pitcherIds.has(id)).map(id=><option key={id} value={id}>{playerName(id)}</option>)}</select></label>}
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

      {!isOutsideWorkload(game) && <div style={{ marginTop: 'var(--space-md)' }}>
        <div className="text-muted text-small" style={{ marginBottom: '4px' }}>Planned lineup</div>
        <GameLineupSnapshot game={game} playerName={playerName} />
      </div>}

      <div style={{ marginTop: 'var(--space-md)' }}>
        <button className="btn btn-sm btn-danger" onClick={onDelete}>
          🗑️ {isOutsideWorkload(game) ? 'Delete Workload' : 'Delete Game'}
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
    if (!setGames(current => current.filter(g => g.id !== deleteTarget.id))) return;
    setExpandedId(null);
    showToast(isOutsideWorkload(deleteTarget) ? 'Outside workload deleted' : 'Game deleted - its workload and stats are gone with it');
    setDeleteTarget(null);
  };

  const handleCorrectPitches = (gameId) => (playerId, pitches) => {
    if (!setGames(current => current.map(g => (g.id === gameId ? correctConfirmedPitches(g, playerId, pitches) : g)))) return;
    showToast('Pitch count corrected - eligibility now uses the new total');
  };

  const handleUpdateGame = (updated) => {
    setGames(games.map(g => (g.id === updated.id ? updated : g)));
  };

  return (
    <div>
      <div className="card">
        <div className="card-header">
          <div className="card-title">Game & Workload History</div>
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
                        {isOutsideWorkload(g) ? `Outside pitching · ${g.workloadSource}` : g.opponent ? `vs ${g.opponent}` : 'Game'}
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
                        {isOutsideWorkload(g) && ` · ${(g.pitchingAppearances || g.battingOrder).map(makePlayerName(g)).join(', ')}`}
                        {g.participationQuality === 'estimated' ? ' · estimated' : ''}
                      </div>
                    </div>
                    {!isOutsideWorkload(g) && <div style={{ textAlign: 'right' }}>
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
                    </div>}
                  </div>

                  {isExpanded && (
                    <GameDetail
                      game={g}
                      playerName={makePlayerName(g)}
                      onDelete={() => setDeleteTarget(g)}
                      onCorrectPitches={handleCorrectPitches(g.id)}
                      onUpdateGame={handleUpdateGame}
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
          title={isOutsideWorkload(deleteTarget) ? 'Delete Outside Workload' : 'Delete Game'}
          message={isOutsideWorkload(deleteTarget) ? `Delete the outside pitching workload from ${formatDateDisplay(deleteTarget.date)}? It will no longer count toward pitching workload or rest eligibility.` : `Delete the ${formatDateDisplay(deleteTarget.date)} game${deleteTarget.opponent ? ` vs ${deleteTarget.opponent}` : ''}? Its playing time and pitching workload disappear from season stats and rest eligibility.`}
          confirmLabel="Delete"
          danger
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
