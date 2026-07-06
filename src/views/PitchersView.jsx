/* ============================================
   Diamond Lineup - Pitchers Summary View
   ============================================ */

import React from 'react';
import { compareDatesDesc, formatDateDisplay, todayISO } from '../domain/dates';
import { AppContext } from '../state/AppContext';
import { Storage } from '../services/storage';
import { EmptyState, PlayerTag } from '../components/ui';

export function PitchersView() {
  const { roster, pitchHistory } = React.useContext(AppContext);
  const [expandedPitcher, setExpandedPitcher] = React.useState(null);
  const gameDate = todayISO();

  const pitchers = roster.filter(p => p.canPitch);

  const getPitcherStats = (playerId) => {
    const records = pitchHistory.filter(r => r.playerId === playerId);
    const totalPitches = records.reduce((sum, r) => sum + (r.pitches || 0), 0);
    const gamesCount = records.length;
    const avgPitchesPerGame = gamesCount > 0 ? Math.round(totalPitches / gamesCount) : 0;

    // Get recent games (last 5)
    const recentGames = [...records]
      .sort((a, b) => compareDatesDesc(a.date, b.date))
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
                          {stats.recentGames.map((record, idx) => (
                            <div
                              key={idx}
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                padding: '4px 0',
                                borderBottom: idx < stats.recentGames.length - 1 ? '1px solid var(--border-light)' : 'none'
                              }}
                            >
                              <span className="text-small">{formatDateDisplay(record.date)}</span>
                              <span className="text-small" style={{ fontWeight: 500 }}>{record.pitches} pitches</span>
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
