/* ============================================
   Diamond Lineup - Pitchers Summary View

   Workload and rest eligibility come from completed games only
   (derived outings), through the central pitching policy.
   An outing with an unconfirmed pitch count is flagged - it is
   never treated as zero.
   ============================================ */

import React from 'react';
import { compareDatesDesc, formatDateDisplay, todayISO } from '../domain/dates';
import { formatOutsAsInnings } from '../domain/games';
import { assessPitcherRest, deriveOutings } from '../domain/pitching';
import { AppContext } from '../state/AppContext';
import { EmptyState, PlayerTag } from '../components/ui';

export function PitchersView() {
  const { roster, games, settings } = React.useContext(AppContext);
  const [expandedPitcher, setExpandedPitcher] = React.useState(null);
  const gameDate = todayISO();

  const pitchers = roster.filter(p => p.canPitch);
  const outings = React.useMemo(() => deriveOutings(games), [games]);

  const getPitcherStats = (playerId) => {
    const records = outings.filter(o => o.playerId === playerId);
    const confirmed = records.filter(o => o.pitches !== null);
    const totalPitches = confirmed.reduce((sum, o) => sum + o.pitches, 0);
    const unknownGames = records.length - confirmed.length;
    const gamesCount = records.length;
    const avgPitchesPerGame = confirmed.length > 0 ? Math.round(totalPitches / confirmed.length) : 0;

    const recentGames = [...records]
      .sort((a, b) => compareDatesDesc(a.date, b.date))
      .slice(0, 5);

    return { totalPitches, gamesCount, unknownGames, avgPitchesPerGame, recentGames };
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
              const eligibility = assessPitcherRest(pitcher.id, gameDate, games, settings.pitchRules);
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
                        {stats.unknownGames > 0 && (
                          <PlayerTag type="ineligible">
                            {stats.unknownGames} count{stats.unknownGames === 1 ? '' : 's'} needed
                          </PlayerTag>
                        )}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontWeight: 600 }}>
                        {stats.totalPitches}{stats.unknownGames > 0 ? '+?' : ''} pitches
                      </div>
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
                          <div style={{ fontSize: '20px', fontWeight: 600 }}>
                            {stats.totalPitches}{stats.unknownGames > 0 ? '+?' : ''}
                          </div>
                          <div className="text-muted text-small">Total Pitches</div>
                        </div>
                        <div style={{ textAlign: 'center' }}>
                          <div style={{ fontSize: '20px', fontWeight: 600 }}>{stats.avgPitchesPerGame}</div>
                          <div className="text-muted text-small">Avg/Game</div>
                        </div>
                        <div style={{ textAlign: 'center' }}>
                          <div style={{
                            fontSize: '20px',
                            fontWeight: 600,
                            color: eligibility.eligible ? 'var(--success)' : 'var(--warning)'
                          }}>
                            {eligibility.eligible ? '✓' : eligibility.reason}
                          </div>
                          <div className="text-muted text-small">
                            {eligibility.daysRest !== null ? `${eligibility.daysRest}d since last` : 'No history'}
                          </div>
                        </div>
                      </div>

                      {/* Recent outings */}
                      {stats.recentGames.length > 0 ? (
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
                              <span className="text-small">
                                {formatDateDisplay(record.date)}
                                {record.estimated ? ' (est.)' : ''}
                              </span>
                              <span className="text-small" style={{ fontWeight: 500 }}>
                                {record.pitches === null
                                  ? 'count needed'
                                  : `${record.pitches} pitches`}
                                {record.pitchingOuts > 0 ? ` · ${formatOutsAsInnings(record.pitchingOuts)} inn` : ''}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
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
