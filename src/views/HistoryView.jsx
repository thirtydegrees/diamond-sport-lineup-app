/* ============================================
   Diamond Lineup - Game History View
   ============================================ */

import React from 'react';
import { compareDatesDesc, formatDateDisplay } from '../domain/dates';
import { AppContext } from '../state/AppContext';
import { EmptyState } from '../components/ui';

export function HistoryView() {
  const { games } = React.useContext(AppContext);

  const sortedGames = [...games].sort((a, b) => compareDatesDesc(a.date, b.date));

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
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
