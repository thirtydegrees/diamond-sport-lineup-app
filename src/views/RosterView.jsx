/* ============================================
   Diamond Lineup - Roster View
   ============================================ */

import React from 'react';
import { DEMO_ROSTER, getFieldingPositions } from '../domain/constants';
import { AppContext } from '../state/AppContext';
import { PlayerEditorModal } from '../components/modals';
import { EmptyState, PlayerTag } from '../components/ui';

export function RosterView() {
  const { roster, setRoster, settings } = React.useContext(AppContext);
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
    if (roster.length === 0 || confirm('Replace current roster with demo data? This will overwrite existing players.')) {
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
          positions={getFieldingPositions(settings.fielderCount)}
          onSave={handleSavePlayer}
          onClose={() => { setShowEditor(false); setEditingPlayer(null); }}
        />
      )}
    </div>
  );
}
