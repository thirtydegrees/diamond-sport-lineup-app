/* ============================================
   Diamond Lineup - Roster View
   ============================================ */

import React from 'react';
import { DEMO_ROSTER, getFieldingPositions } from '../domain/constants';
import { AppContext } from '../state/AppContext';
import { PlayerEditorModal } from '../components/modals';
import { ConfirmDialog, EmptyState, PlayerTag } from '../components/ui';

export function RosterView() {
  const { roster, setRoster, settings, showToast } = React.useContext(AppContext);
  const [editingPlayer, setEditingPlayer] = React.useState(null);
  const [showEditor, setShowEditor] = React.useState(false);
  const [deleteTarget, setDeleteTarget] = React.useState(null);
  const [confirmDemo, setConfirmDemo] = React.useState(false);

  const handleSavePlayer = (player) => {
    if (editingPlayer) {
      setRoster(roster.map(p => p.id === player.id ? player : p));
    } else {
      setRoster([...roster, player]);
    }
    setShowEditor(false);
    setEditingPlayer(null);
  };

  const handleDeletePlayer = () => {
    setRoster(roster.filter(p => p.id !== deleteTarget.id));
    showToast(`${deleteTarget.name} removed from roster`);
    setDeleteTarget(null);
  };

  const handleLoadDemo = () => {
    if (roster.length === 0) {
      setRoster(DEMO_ROSTER);
    } else {
      setConfirmDemo(true);
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
                      <PlayerTag type="pitcher">Can P</PlayerTag>
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
                  onClick={(e) => { e.stopPropagation(); setDeleteTarget(player); }}
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
          positions={getFieldingPositions(settings.fielderCount)}
          onSave={handleSavePlayer}
          onClose={() => { setShowEditor(false); setEditingPlayer(null); }}
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          title="Remove Player"
          message={`Remove ${deleteTarget.name} from the roster? Their game history stays in saved games.`}
          confirmLabel="Remove"
          danger
          onConfirm={handleDeletePlayer}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {confirmDemo && (
        <ConfirmDialog
          title="Load Demo Roster"
          message={`Replace your ${roster.length} current players with the 12-player demo roster?`}
          confirmLabel="Replace"
          danger
          onConfirm={() => { setRoster(DEMO_ROSTER); setConfirmDemo(false); }}
          onCancel={() => setConfirmDemo(false)}
        />
      )}
    </div>
  );
}
