/* ============================================
   Diamond Lineup - Season Stats View

   Three questions a development-league coach asks:
   1. Who has played where? (position distribution)
   2. Who is sitting the most? (bench equity)
   3. How hard have my pitchers worked? (workload)

   Chart conventions (see chart CSS variables in styles.css):
   marks carry the validated palette; all text wears text
   tokens; every chart has a table-view twin; tooltips
   enhance but never gate a value.
   ============================================ */

import React from 'react';
import {
  computePitchingStats,
  computeSeasonStats,
  GROUP_LABELS,
  GROUP_ORDER,
  shiftISO
} from '../domain/analytics';
import { todayISO } from '../domain/dates';
import { AppContext } from '../state/AppContext';
import { EmptyState, StatCard } from '../components/ui';

const GROUP_COLORS = {
  P: 'var(--chart-p)',
  C: 'var(--chart-c)',
  IF: 'var(--chart-if)',
  OF: 'var(--chart-of)',
  SIT: 'var(--chart-sit)'
};

// ----------------------------------------
// Tooltip layer (shared by all chart cards)
// ----------------------------------------
function useTooltip() {
  const [tip, setTip] = React.useState(null);
  const containerRef = React.useRef(null);

  const show = (e, title, lines) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setTip({
      x: Math.min(e.clientX - rect.left, rect.width - 140),
      y: e.clientY - rect.top,
      title,
      lines
    });
  };
  const hide = () => setTip(null);

  const tooltipEl = tip && (
    <div className="chart-tooltip" style={{ left: tip.x, top: tip.y }}>
      <div className="chart-tooltip-title">{tip.title}</div>
      {tip.lines.map((l, i) => <div key={i}>{l}</div>)}
    </div>
  );

  return { containerRef, show, hide, tooltipEl };
}

function TableToggle({ showTable, onToggle }) {
  return (
    <button className="btn btn-secondary btn-sm" onClick={onToggle}>
      {showTable ? 'Chart' : 'Table'}
    </button>
  );
}

// ----------------------------------------
// Card 1: Playing time by position (stacked bars)
// ----------------------------------------
function PositionDistributionCard({ stats }) {
  const [showTable, setShowTable] = React.useState(false);
  const { containerRef, show, hide, tooltipEl } = useTooltip();

  const players = stats.filter(s => s.innings > 0);
  const maxInnings = Math.max(1, ...players.map(s => s.innings));

  return (
    <div className="card">
      <div className="card-header">
        <div>
          <div className="card-title">Playing Time by Position</div>
          <div className="card-subtitle">Innings per player</div>
        </div>
        <TableToggle showTable={showTable} onToggle={() => setShowTable(v => !v)} />
      </div>
      <div className="card-body">
        {players.length === 0 ? (
          <p className="text-muted text-small">No innings recorded in this period.</p>
        ) : showTable ? (
          <div style={{ overflowX: 'auto' }}>
            <table className="stats-table">
              <thead>
                <tr>
                  <th>Player</th>
                  {GROUP_ORDER.map(g => <th key={g}>{GROUP_LABELS[g]}</th>)}
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {players.map(s => (
                  <tr key={s.playerId}>
                    <td>{s.name}</td>
                    {GROUP_ORDER.map(g => <td key={g}>{s.byGroup[g] || ''}</td>)}
                    <td>{s.innings}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div ref={containerRef} className="chart-area" onPointerLeave={hide}>
            {players.map(s => (
              <div key={s.playerId} className="hbar-row">
                <span className="hbar-label">{s.name}</span>
                <div className="hbar-track">
                  {GROUP_ORDER.map(g => {
                    const count = s.byGroup[g];
                    if (!count) return null;
                    return (
                      <div
                        key={g}
                        className="hbar-seg"
                        style={{
                          width: `${(count / maxInnings) * 100}%`,
                          background: GROUP_COLORS[g]
                        }}
                        onPointerEnter={(e) => show(e, s.name, [
                          `${GROUP_LABELS[g]}: ${count} inning${count === 1 ? '' : 's'}`,
                          `${Math.round((count / s.innings) * 100)}% of ${s.innings} played`
                        ])}
                        onPointerDown={(e) => show(e, s.name, [
                          `${GROUP_LABELS[g]}: ${count} inning${count === 1 ? '' : 's'}`,
                          `${Math.round((count / s.innings) * 100)}% of ${s.innings} played`
                        ])}
                      />
                    );
                  })}
                </div>
                <span className="hbar-value">{s.innings}</span>
              </div>
            ))}
            {tooltipEl}
          </div>
        )}

        {/* Legend: the dependable identity channel */}
        {!showTable && players.length > 0 && (
          <div className="chart-legend">
            {GROUP_ORDER.map(g => (
              <span key={g} className="legend-item">
                <span className="legend-swatch" style={{ background: GROUP_COLORS[g] }} />
                {GROUP_LABELS[g]}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ----------------------------------------
// Card 2: Bench time (single-series bars, sorted)
// ----------------------------------------
function BenchTimeCard({ stats }) {
  const { containerRef, show, hide, tooltipEl } = useTooltip();

  const players = stats
    .filter(s => s.innings > 0)
    .sort((a, b) => b.sits - a.sits);
  const maxSits = Math.max(1, ...players.map(s => s.sits));

  return (
    <div className="card">
      <div className="card-header">
        <div>
          <div className="card-title">Bench Time</div>
          <div className="card-subtitle">Innings sat, most first</div>
        </div>
      </div>
      <div className="card-body">
        {players.length === 0 ? (
          <p className="text-muted text-small">No innings recorded in this period.</p>
        ) : (
          <div ref={containerRef} className="chart-area" onPointerLeave={hide}>
            {players.map(s => (
              <div key={s.playerId} className="hbar-row">
                <span className="hbar-label">{s.name}</span>
                <div className="hbar-track">
                  {s.sits > 0 && (
                    <div
                      className="hbar-seg single"
                      style={{ width: `${(s.sits / maxSits) * 100}%` }}
                      onPointerEnter={(e) => show(e, s.name, [
                        `Sat ${s.sits} of ${s.innings} innings`,
                        `${Math.round(s.sitShare * 100)}% bench time`
                      ])}
                      onPointerDown={(e) => show(e, s.name, [
                        `Sat ${s.sits} of ${s.innings} innings`,
                        `${Math.round(s.sitShare * 100)}% bench time`
                      ])}
                    />
                  )}
                </div>
                <span className="hbar-value">{s.sits}</span>
              </div>
            ))}
            {tooltipEl}
          </div>
        )}
      </div>
    </div>
  );
}

// ----------------------------------------
// Card 3: Pitcher workload (per-game columns)
// ----------------------------------------
function PitcherWorkloadCard({ pitching, pitchRules }) {
  const [showTable, setShowTable] = React.useState(false);
  const { containerRef, show, hide, tooltipEl } = useTooltip();

  const dailyMax = pitchRules.limitType === 'pitches' ? pitchRules.absoluteMax : null;
  const scaleMax = Math.max(
    dailyMax || 0,
    1,
    ...pitching.flatMap(p => p.perGame.map(g => g.pitches))
  );
  const PLOT_H = 56;

  return (
    <div className="card">
      <div className="card-header">
        <div>
          <div className="card-title">Pitcher Workload</div>
          <div className="card-subtitle">
            Pitches per outing{dailyMax ? ` - hairline marks the ${dailyMax}-pitch game max` : ''}
          </div>
        </div>
        <TableToggle showTable={showTable} onToggle={() => setShowTable(v => !v)} />
      </div>
      <div className="card-body">
        {pitching.length === 0 ? (
          <p className="text-muted text-small">
            No pitching recorded yet. Workload is logged when you save a game or use the pitch counter.
          </p>
        ) : showTable ? (
          <div style={{ overflowX: 'auto' }}>
            <table className="stats-table">
              <thead>
                <tr>
                  <th>Pitcher</th><th>Games</th><th>Pitches</th><th>Innings</th>
                  <th>Avg/Game</th><th>Last 7 Days</th>
                </tr>
              </thead>
              <tbody>
                {pitching.map(p => (
                  <tr key={p.playerId}>
                    <td>{p.name}</td>
                    <td>{p.games}</td>
                    <td>{p.totalPitches}</td>
                    <td>{p.totalInnings}</td>
                    <td>{p.avgPitches}</td>
                    <td>{p.last7Pitches}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div ref={containerRef} className="chart-area" onPointerLeave={hide}>
            {pitching.map(p => (
              <div key={p.playerId} className="workload-row">
                <div className="workload-info">
                  <div className="workload-name">{p.name}</div>
                  <div className="text-muted text-small">
                    {p.totalPitches} pitches · {p.totalInnings} inn · last 7d: {p.last7Pitches}
                  </div>
                </div>
                <div className="workload-plot" style={{ height: PLOT_H }}>
                  {dailyMax && (
                    <div
                      className="workload-maxline"
                      style={{ bottom: (dailyMax / scaleMax) * PLOT_H }}
                    />
                  )}
                  {p.perGame.map(g => (
                    <div
                      key={g.gameId}
                      className="workload-col"
                      style={{ height: Math.max(3, (g.pitches / scaleMax) * PLOT_H) }}
                      onPointerEnter={(e) => show(e, p.name, [
                        `${g.date}${g.opponent ? ` vs ${g.opponent}` : ''}`,
                        `${g.pitches} pitches, ${g.inningsPitched} inning${g.inningsPitched === 1 ? '' : 's'}`
                      ])}
                      onPointerDown={(e) => show(e, p.name, [
                        `${g.date}${g.opponent ? ` vs ${g.opponent}` : ''}`,
                        `${g.pitches} pitches, ${g.inningsPitched} inning${g.inningsPitched === 1 ? '' : 's'}`
                      ])}
                    />
                  ))}
                </div>
              </div>
            ))}
            {tooltipEl}
          </div>
        )}
      </div>
    </div>
  );
}

// ----------------------------------------
// The view
// ----------------------------------------
export function StatsView() {
  const { games, roster, pitchHistory, settings } = React.useContext(AppContext);
  const [rangeKey, setRangeKey] = React.useState('season');

  const today = todayISO();
  const range = React.useMemo(() => {
    if (rangeKey === '7') return { from: shiftISO(today, -6) };
    if (rangeKey === '30') return { from: shiftISO(today, -29) };
    return undefined;
  }, [rangeKey, today]);

  const seasonStats = React.useMemo(
    () => computeSeasonStats(games, roster, range),
    [games, roster, range]
  );
  const pitching = React.useMemo(
    () => computePitchingStats(pitchHistory, roster, games, today, range),
    [pitchHistory, roster, games, today, range]
  );

  const gamesInRange = games.filter(g =>
    (!range?.from || g.date >= range.from) && (!range?.to || g.date <= range.to)
  );
  const totalInnings = seasonStats.reduce((sum, s) => sum + s.innings, 0);
  const totalPitches = pitching.reduce((sum, p) => sum + p.totalPitches, 0);

  if (games.length === 0) {
    return (
      <div className="card">
        <div className="card-body">
          <EmptyState
            icon="📊"
            title="No Season Data Yet"
            text="Save games from the lineup screen and season stats will build up here: who has played where, bench time, and pitcher workload."
          />
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* One filter row scoping every card below */}
      <div className="card">
        <div className="card-body" style={{ padding: 'var(--space-md)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
            <span className="text-muted text-small">Showing:</span>
            {[['season', 'Full Season'], ['30', 'Last 30 Days'], ['7', 'Last 7 Days']].map(([key, label]) => (
              <button
                key={key}
                className={`btn btn-sm ${rangeKey === key ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setRangeKey(key)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* KPI row */}
      <div className="card">
        <div className="card-body" style={{ padding: 'var(--space-md)' }}>
          <div className="stats-grid">
            <StatCard value={gamesInRange.length} label="Games" />
            <StatCard value={totalInnings} label="Player Innings" />
            <StatCard value={totalPitches} label="Pitches" />
            <StatCard
              value={pitching.length}
              label="Pitchers Used"
              title="Players with recorded pitching in this period"
            />
          </div>
        </div>
      </div>

      <PositionDistributionCard stats={seasonStats} />
      <BenchTimeCard stats={seasonStats} />
      <PitcherWorkloadCard pitching={pitching} pitchRules={settings.pitchRules} />
    </div>
  );
}
