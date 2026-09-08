import React from "react";

/** Scores remain inning totals; defensive outs never determine batting runs. */
export function LiveScore({ game, teamName, onChange }) {
  const [lastRun, setLastRun] = React.useState(null);
  const context = `${game.id}:${game.live.inning}`;
  const [selection, setSelection] = React.useState({ context, inning: null });
  // Reset in the same render as the inning transition, before controls commit.
  // An effect leaves a render where a newly displayed inning has an old target.
  if (selection.context !== context) setSelection({ context, inning: null });
  const selectedInning = selection.context === context ? selection.inning : null;
  const inning = selectedInning ?? game.live.inning;
  const innings = Math.max(
    game.innings,
    game.live.inning,
    ...Object.keys(game.score.us || {}).map(Number),
    ...Object.keys(game.score.them || {}).map(Number),
  );
  return (
    <section className="live-score" aria-label="Live score">
      <strong>Runs · Inning {game.live.inning}</strong>
      {[
        ["us", teamName],
        ["them", game.opponent || "Opponent"],
      ].map(([side, name]) => (
        <div className="live-score-row" key={side}>
          <strong>{name}</strong>
          <span className="live-score-total" aria-label={`${name} total runs`}>
            {Object.values(game.score[side] || {}).reduce((a, b) => a + b, 0)}
          </span>
          <button
            className="btn btn-primary"
            aria-label={`Add run for ${name}`}
            onClick={() => {
              const prior = game.score[side]?.[game.live.inning] || 0;
              if (onChange(side, game.live.inning, 1, true, prior)) setLastRun({gameId:game.id, side, inning:game.live.inning, total:prior+1, name});
            }}
          >
            + Run
          </button>
        </div>
      ))}
      {lastRun && <button className="btn btn-ghost" disabled={lastRun.gameId !== game.id || lastRun.inning !== game.live.inning || game.score[lastRun.side]?.[lastRun.inning] !== lastRun.total} onClick={() => {
        onChange(lastRun.side,lastRun.inning,-1,true,lastRun.total); setLastRun(null);
      }}>Undo last run · {lastRun.name}</button>}
      <details>
        <summary>Correct inning scores</summary>
        <div className="score-correction">
          <label className="form-label">
            Correct scores in inning
            <select
              className="form-select"
              aria-label="Scoring inning"
              value={selectedInning ?? "current"}
              onChange={(e) =>
                setSelection({ context, inning: e.target.value === "current" ? null : Number(e.target.value) })
              }
            >
              <option value="current">Current inning ({game.live.inning})</option>
              {Array.from({ length: innings }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  Inning {i + 1}
                </option>
              ))}
            </select>
          </label>

          <p className="text-small">
            Inning {inning}. Runs are saved immediately. Choose an inning here to correct an earlier score. Quick + Run always records in the current inning.
          </p>
          {[
            ["us", teamName],
            ["them", game.opponent || "Opponent"],
          ].map(([side, name]) => (
            <div className="live-score-row" key={side}>
              <strong>{name}</strong>
              <button
                className="btn btn-secondary"
                aria-label={`Remove run for ${name}`}
                disabled={!(game.score[side]?.[inning] > 0)}
                onClick={() => onChange(side, inning, -1, true)}
              >
                − Run
              </button>
              <button className="btn btn-secondary" aria-label={`Add correction run for ${name}`} onClick={() => onChange(side, inning, 1, true)}>+ Run</button>
              <span aria-label={`${name} inning runs`}>
                {game.score[side]?.[inning] || 0}
              </span>
            </div>
          ))}
        </div>
      </details>
    </section>
  );
}
