import React from "react";

/** Scores remain inning totals; defensive outs never determine batting runs. */
export function LiveScore({ game, teamName, onChange }) {
  const [selectedInning, setSelectedInning] = React.useState(null);
  const inning = selectedInning ?? game.live.inning;
  const innings = Math.max(
    game.innings,
    game.live.inning,
    ...Object.keys(game.score.us || {}).map(Number),
    ...Object.keys(game.score.them || {}).map(Number),
  );
  return (
    <section className="live-score" aria-label="Live score">
      <label className="form-label">
        Record runs in inning
        <select
          className="form-select"
          aria-label="Scoring inning"
          value={selectedInning ?? "current"}
          onChange={(e) =>
            setSelectedInning(
              e.target.value === "current" ? null : Number(e.target.value),
            )
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
            onClick={() => onChange(side, inning, 1, true)}
          >
            + Run
          </button>
        </div>
      ))}
      <details>
        <summary>Correct inning scores</summary>
        <div className="score-correction">
          <p className="text-small">
            Inning {inning}. Runs are saved immediately. Choose another inning
            above to correct an earlier score.
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
