/* ============================================
   Diamond Lineup - Feature Modals
   ============================================ */

import React from 'react';
import { POSITIONS, POSITION_LABELS, POSITION_TIERS } from '../domain/constants';
import { formatOutsAsInnings } from '../domain/games';
import { newId } from '../domain/ids';
import { Solver } from '../domain/solver';
import { Alert, Checkbox, EmptyState, Modal, OptionItem, OptionList, PositionBadge } from './ui';

// ============================================
// Player Editor Modal
// ============================================
export function PlayerEditorModal({ player, positions = POSITIONS, onSave, onClose }) {
  const [name, setName] = React.useState(player?.name || '');
  const [canPitch, setCanPitch] = React.useState(player?.canPitch || false);
  const [prefersPitching, setPrefersPitching] = React.useState(player?.prefersPitching || false);
  const [canCatch, setCanCatch] = React.useState(player?.canCatch || false);
  const [positionTiers, setPositionTiers] = React.useState(() => {
    const initial = {};
    positions.forEach(pos => {
      initial[pos] = player?.positions?.[pos] ?? POSITION_TIERS.CAN_PLAY;
    });
    return { ...player?.positions, ...initial };
  });
  const [preferredOrder, setPreferredOrder] = React.useState(player?.preferredOrder || []);

  // Cycle position tier on tap
  const cyclePositionTier = (pos) => {
    // Check if position is disabled
    if ((pos === 'P' && !canPitch) || (pos === 'C' && !canCatch)) {
      return;
    }

    const currentTier = positionTiers[pos] || POSITION_TIERS.CAN_PLAY;
    let newTier;

    if (currentTier === POSITION_TIERS.CAN_PLAY) {
      newTier = POSITION_TIERS.PREFERRED;
    } else if (currentTier === POSITION_TIERS.PREFERRED) {
      newTier = POSITION_TIERS.AVOID;
    } else {
      newTier = POSITION_TIERS.CAN_PLAY;
    }

    setPositionTiers({ ...positionTiers, [pos]: newTier });

    // Update preferred order
    if (newTier === POSITION_TIERS.PREFERRED && !preferredOrder.includes(pos)) {
      if (preferredOrder.length < 3) {
        setPreferredOrder([...preferredOrder, pos]);
      }
    } else if (newTier !== POSITION_TIERS.PREFERRED) {
      setPreferredOrder(preferredOrder.filter(p => p !== pos));
    }
  };

  // Handle can pitch toggle
  const handleCanPitchChange = (checked) => {
    setCanPitch(checked);
    if (!checked) {
      setPrefersPitching(false);
      // Set P to avoid if they can't pitch
      setPositionTiers({ ...positionTiers, P: POSITION_TIERS.AVOID });
      setPreferredOrder(preferredOrder.filter(p => p !== 'P'));
    } else {
      // Reset P to canPlay
      setPositionTiers({ ...positionTiers, P: POSITION_TIERS.CAN_PLAY });
    }
  };

  // Handle can catch toggle
  const handleCanCatchChange = (checked) => {
    setCanCatch(checked);
    if (!checked) {
      // Set C to avoid if they can't catch
      setPositionTiers({ ...positionTiers, C: POSITION_TIERS.AVOID });
      setPreferredOrder(preferredOrder.filter(p => p !== 'C'));
    } else {
      // Reset C to canPlay
      setPositionTiers({ ...positionTiers, C: POSITION_TIERS.CAN_PLAY });
    }
  };

  const handleSave = () => {
    if (!name.trim()) return;

    onSave({
      id: player?.id || newId(),
      name: name.trim(),
      canPitch,
      prefersPitching: canPitch && prefersPitching,
      canCatch,
      positions: positionTiers,
      preferredOrder
    });
  };

  return (
    <Modal
      title={player ? 'Edit Player' : 'Add Player'}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={!name.trim()}>
            Save
          </button>
        </>
      }
    >
      {/* Name */}
      <div className="form-group">
        <label className="form-label">Name</label>
        <input
          type="text"
          className="form-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g., Joe B."
          autoFocus
        />
      </div>

      {/* Abilities */}
      <div className="form-group">
        <label className="form-label">Abilities</label>
        <Checkbox
          checked={canPitch}
          onChange={handleCanPitchChange}
          label="Can Pitch"
        />
        {canPitch && (
          <div style={{ marginLeft: '32px' }}>
            <Checkbox
              checked={prefersPitching}
              onChange={setPrefersPitching}
              label="Primary Pitcher"
            />
          </div>
        )}
        <Checkbox
          checked={canCatch}
          onChange={handleCanCatchChange}
          label="Can Catch"
        />
      </div>

      {/* Position Preferences */}
      <div className="form-group">
        <label className="form-label">Position Ratings</label>
        <p className="form-hint" style={{ marginBottom: '12px' }}>
          Tap to cycle: Can Play → Preferred → Avoid
        </p>
        <div className="position-grid">
          {positions.map(pos => {
            const tier = positionTiers[pos] || POSITION_TIERS.CAN_PLAY;
            const isDisabled = (pos === 'P' && !canPitch) || (pos === 'C' && !canCatch);
            const prefIndex = preferredOrder.indexOf(pos);

            return (
              <div
                key={pos}
                className={`position-option ${tier} ${isDisabled ? 'disabled' : ''}`}
                onClick={() => cyclePositionTier(pos)}
                title={POSITION_LABELS[pos]}
              >
                {pos}
                {prefIndex >= 0 && (
                  <span className="tier-indicator">#{prefIndex + 1}</span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}

// ============================================
// Pitcher Picker Modal
// ============================================
/**
 * Pitcher picker. `assess(player)` comes from the central pitching policy
 * (rest from completed games, per-game caps, daily max). A pitcher with
 * warnings is selectable only through an explicit override confirmation -
 * real events stay recordable, but never silently (H6).
 */
export function PitcherPickerModal({ title, players, currentPitcherId, assess, onSelect, onClose, allowClear = true }) {
  const [overridePrompt, setOverridePrompt] = React.useState(null);

  // Group pitchers
  const primaryPitchers = [];
  const backupPitchers = [];

  players.forEach(player => {
    if (!player.canPitch) return;
    const decision = assess(player);
    const pitcherData = { player, decision };
    if (player.prefersPitching) {
      primaryPitchers.push(pitcherData);
    } else {
      backupPitchers.push(pitcherData);
    }
  });

  const pick = ({ player, decision }) => {
    if (!decision.allowed) return;
    if (decision.warnings.length > 0) {
      setOverridePrompt({ player, decision });
    } else {
      onSelect(player.id);
    }
  };

  const renderPitcherOption = (data) => {
    const { player, decision } = data;
    const isSelected = player.id === currentPitcherId;
    const warned = decision.warnings.length > 0;

    return (
      <div
        key={player.id}
        className={`pitcher-option ${!decision.allowed ? 'disabled' : ''} ${isSelected ? 'selected' : ''}`}
        onClick={() => pick(data)}
      >
        <span style={{ fontWeight: isSelected ? 600 : 400 }}>
          {player.name}
          {isSelected && ' ✓'}
        </span>
        <span className={`pitcher-status ${warned || !decision.allowed ? 'ineligible' : 'eligible'}`}>
          {!decision.allowed
            ? decision.warnings[0]?.short || 'Cannot pitch'
            : warned
              ? `⚠ ${decision.warnings[0].short}`
              : 'Eligible'}
        </span>
      </div>
    );
  };

  return (
    <Modal title={title} onClose={onClose}>
      {primaryPitchers.length > 0 && (
        <div className="pitcher-group">
          <div className="pitcher-group-title">Primary Pitchers</div>
          {primaryPitchers.map(renderPitcherOption)}
        </div>
      )}

      {backupPitchers.length > 0 && (
        <div className="pitcher-group">
          <div className="pitcher-group-title">Can Pitch if Needed</div>
          {backupPitchers.map(renderPitcherOption)}
        </div>
      )}

      {primaryPitchers.length === 0 && backupPitchers.length === 0 && (
        <EmptyState
          icon="⚾"
          title="No Pitchers Available"
          text="Add players who can pitch in the Roster tab"
        />
      )}

      {allowClear && (
        <div style={{ marginTop: '16px' }}>
          <button className="btn btn-secondary btn-block" onClick={() => onSelect(null)}>
            Clear Assignment
          </button>
        </div>
      )}

      {overridePrompt && (
        <Modal title="Pitching Rule Warning" onClose={() => setOverridePrompt(null)}>
          <Alert type="warning">
            {overridePrompt.decision.warnings.map((w, i) => (
              <div key={i}>{w.message}</div>
            ))}
          </Alert>
          <p className="text-small text-muted" style={{ margin: '12px 0' }}>
            Overriding records your choice but does not change your league's rules.
            Only continue for a league-approved exception or to record what actually
            happened.
          </p>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setOverridePrompt(null)}>
              Cancel
            </button>
            <button
              className="btn btn-danger"
              style={{ flex: 1 }}
              onClick={() => {
                onSelect(overridePrompt.player.id);
                setOverridePrompt(null);
              }}
            >
              Override & Assign
            </button>
          </div>
        </Modal>
      )}
    </Modal>
  );
}

// ============================================
// Position Picker Modal
// ============================================
export function PositionPickerModal({ player, inning, currentPosition, lineup, totalInnings, positions = POSITIONS, requireContiguousPitching = true, onSelect, onClose }) {
  // Check if assigning pitcher would violate contiguity
  const checkPitchingContiguity = (pos) => {
    if (pos !== 'P' || !requireContiguousPitching) return true;

    return Solver.checkPitchingContiguity(player, inning, lineup || {}, totalInnings);
  };

  return (
    <Modal title={`${player.name} - Inning ${inning}`} onClose={onClose}>
      <p className="text-muted text-small mb-md">
        Select a new position:
      </p>
      <div className="position-grid">
        {positions.map(pos => {
          const canPlay = Solver.canPlayerPlayPosition(player, pos);
          const pitchingOk = checkPitchingContiguity(pos);
          const isDisabled = !canPlay || !pitchingOk;
          const tier = player.positions?.[pos] || POSITION_TIERS.CAN_PLAY;
          const isCurrentPosition = pos === currentPosition;

          return (
            <div
              key={pos}
              className={`position-option ${tier} ${isDisabled ? 'disabled' : ''} ${isCurrentPosition ? 'selected' : ''}`}
              onClick={() => !isDisabled && onSelect(pos)}
              style={isCurrentPosition ? { borderColor: 'var(--accent)', borderWidth: '3px' } : {}}
              title={!pitchingOk ? 'Would create non-consecutive pitching' : POSITION_LABELS[pos]}
            >
              {pos}
              {pos === 'P' && !pitchingOk && <span style={{ fontSize: '10px', display: 'block' }}>gap</span>}
            </div>
          );
        })}
        {/* SIT option */}
        <div
          className={`position-option ${currentPosition === 'SIT' ? 'selected' : ''}`}
          onClick={() => onSelect('SIT')}
          style={{
            background: 'var(--pos-sit)',
            ...(currentPosition === 'SIT' ? { borderColor: 'var(--accent)', borderWidth: '3px' } : {})
          }}
        >
          SIT
        </div>
      </div>
    </Modal>
  );
}

// ============================================
// Cell Action Modal
// ============================================
export function CellActionModal({ player, inning, position, isLocked, onAction, onClose }) {
  return (
    <Modal title={`${player.name} - Inning ${inning}`} onClose={onClose}>
      <div style={{ marginBottom: '16px' }}>
        <strong>Current Position: </strong>
        <PositionBadge position={position} />
        {isLocked && (
          <span style={{ marginLeft: '8px', color: 'var(--warning)' }}>🔒 Locked</span>
        )}
      </div>

      <OptionList>
        {isLocked ? (
          <OptionItem
            title="🔓 Unlock Position"
            description="Allow solver to change this assignment"
            onClick={() => onAction('unlock')}
          />
        ) : (
          <OptionItem
            title="🔒 Lock Position"
            description="Keep this assignment fixed"
            onClick={() => onAction('lock')}
          />
        )}

        <OptionItem
          title="📍 Change Position"
          description="Manually assign a different position"
          onClick={() => onAction('changePosition')}
        />

        <OptionItem
          title="❌ Mark Exited"
          description="Player left the game"
          onClick={() => onAction('exit')}
          danger
        />
      </OptionList>
    </Modal>
  );
}

// ============================================
// Pitch Counter Modal
//
// The WORKING count: taps accumulate per inning, and the total
// can be corrected directly (coach reconciles against an
// official scorer mid-game). Nothing here becomes authoritative
// workload - that happens at game completion, where every
// pitcher's final count is reviewed and confirmed.
// ============================================
export function PitchCounterModal({ player, inning, entry, dailyMax, dailyTotal, onCount, onSetTotal, onClose }) {
  const currentInningPitches = entry.byInning[inning] || 0;
  const totalPitches = entry.live;
  const [editing, setEditing] = React.useState(false);
  const [editValue, setEditValue] = React.useState('');

  const overMax = dailyMax != null && dailyMax > 0 && dailyTotal >= dailyMax;

  const commitEdit = () => {
    const n = Number(editValue);
    if (editValue.trim() && Number.isInteger(n) && n >= 0) onSetTotal(n);
    setEditing(false);
  };

  return (
    <Modal title="Pitch Counter" onClose={onClose}>
      <div className="pitch-counter">
        <div className="pitch-counter-title">Current Pitcher</div>
        <div className="pitch-counter-name">{player.name}</div>

        {editing ? (
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', justifyContent: 'center', margin: '12px 0' }}>
            <input
              type="number"
              inputMode="numeric"
              className="form-input"
              style={{ width: '110px', fontSize: '24px', textAlign: 'center' }}
              value={editValue}
              min={0}
              autoFocus
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(); }}
              aria-label="Corrected total pitches"
            />
            <button className="btn btn-primary" onClick={commitEdit}>Set</button>
          </div>
        ) : (
          <>
            <div className="pitch-counter-display">{totalPitches}</div>
            <div className="pitch-counter-inning">
              {currentInningPitches} this inning{entry.adjustment ? ` · ${entry.adjustment > 0 ? '+' : ''}${entry.adjustment} unallocated correction` : ''}
            </div>
          </>
        )}

        {overMax && (
          <Alert type="warning">
            {dailyTotal} pitches today - at or over the configured max of {dailyMax}.
            Keep counting what actually happens; the overage is flagged, not hidden.
          </Alert>
        )}

        <div className="pitch-counter-buttons">
          <button
            className="pitch-btn-minus"
            onClick={() => currentInningPitches > 0 && onCount(inning, currentInningPitches - 1)}
            disabled={currentInningPitches === 0 || totalPitches === 0}
            aria-label="Subtract one pitch"
          >
            −
          </button>
          <button
            className="pitch-btn-plus"
            onClick={() => onCount(inning, currentInningPitches + 1)}
            aria-label="Add one pitch"
          >
            +1
          </button>
        </div>

        <div className="pitch-counter-actions">
          <button
            className="btn btn-secondary"
            onClick={() => { setEditValue(String(totalPitches)); setEditing(true); }}
          >
            ✏️ Correct Total
          </button>
          <button className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
        <p className="form-hint" style={{ textAlign: 'center', marginTop: '8px' }}>
          Counts save as you tap. You'll confirm final totals when you complete the game.
        </p>
      </div>
    </Modal>
  );
}

// ============================================
// Complete Game - pitch confirmation
//
// Every pitcher must be EXPLICITLY reviewed: the coach either
// confirms a number (the working count is offered, but an
// untouched prefill is never accepted as confirmation) or
// declares - through a second acknowledgment - that no
// trustworthy count can be established. A zero for a player who
// actually pitched also requires the second acknowledgment,
// because an accidental confirmed zero looks authoritative and
// unlocks eligibility a real count might not.
// ============================================
export function CompleteGameModal({ rows, hasOuts, onComplete, onClose, extraPlayers = [], onAddPitcher }) {
  // rows: [{ playerId, name, pitchingOuts, workingCount }]
  const [values, setValues] = React.useState(() => {
    const v = {};
    rows.forEach(r => {
      v[r.playerId] = { text: String(r.workingCount), resolved: null }; // resolved: null | 'confirmed' | 'unknown'
    });
    return v;
  });
  const [ackPrompt, setAckPrompt] = React.useState(null); // { row, kind: 'zero' | 'unknown' }

  const setRow = (id, patch) => setValues(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  const parseCount = (v) => {
    const n = parseInt(v.text, 10);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };

  const handleConfirmRow = (row) => {
    const v = values[row.playerId];
    const n = parseCount(v);
    if (n === null) return;
    if (n === 0 && row.pitchingOuts > 0) {
      // Confirming 0 for a player who actually pitched is unusual - make
      // sure it is a decision, not an untouched default
      setAckPrompt({ row, kind: 'zero' });
      return;
    }
    setRow(row.playerId, { resolved: 'confirmed' });
  };

  const allResolved = rows.every(r => values[r.playerId].resolved !== null);

  const handleComplete = () => {
    if (!allResolved) return;
    onComplete(rows.map(r => {
      const v = values[r.playerId];
      return {
        playerId: r.playerId,
        pitches: v.resolved === 'unknown' ? null : parseCount(v)
      };
    }));
  };

  return (
    <Modal
      title="Complete Game"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Not Yet</button>
          <button className="btn btn-primary" onClick={handleComplete} disabled={!allResolved}>
            {allResolved
              ? '✓ Complete Game'
              : `Review ${rows.filter(r => values[r.playerId].resolved === null).length} pitch count${rows.filter(r => values[r.playerId].resolved === null).length === 1 ? '' : 's'} first`}
          </button>
        </>
      }
    >
      {extraPlayers.length > 0 && <label className="text-small">Missing a pitcher? Add any appearance, even with zero outs.<select className="form-select" value="" onChange={e=>{if(e.target.value)onAddPitcher?.(e.target.value);}}><option value="">Choose player</option>{extraPlayers.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
      {!hasOuts && (
        <Alert type="warning">
          No defensive outs were recorded, so this game will save with no
          participation history (score only). Use Record Out during the game
          to track actual playing time.
        </Alert>
      )}

      {rows.length > 0 ? (
        <>
          <p className="text-small" style={{ marginBottom: '12px' }}>
            Set the final pitch count for everyone who pitched - check it
            against the official book if you have one. Each pitcher needs an
            explicit ✓ before the game can complete.
          </p>
          {rows.map(r => {
            const v = values[r.playerId];
            const n = parseCount(v);
            return (
              <div
                key={r.playerId}
                className="pitch-review-row"
                style={{
                  display: 'flex', alignItems: 'center', gap: '8px',
                  padding: '10px 0', borderBottom: '1px solid var(--border-light)'
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>
                    {r.name}
                    {v.resolved === 'confirmed' && <span style={{ color: 'var(--success)', marginLeft: '6px' }}>✓ {n}</span>}
                    {v.resolved === 'unknown' && <span style={{ color: 'var(--warning)', marginLeft: '6px' }}>⚠ no count</span>}
                  </div>
                  <div className="text-muted text-small">
                    {r.pitchingOuts > 0
                      ? `Pitched ${formatOutsAsInnings(r.pitchingOuts)} inning${r.pitchingOuts === 3 ? '' : 's'}`
                      : 'Counter used, no pitching outs recorded'}
                    {r.workingCount === 0 && r.pitchingOuts > 0 && v.resolved === null && (
                      <span style={{ color: 'var(--warning)' }}> · no pitches were counted</span>
                    )}
                  </div>
                </div>
                {v.resolved === null ? (
                  <>
                    <input
                      type="number"
                      inputMode="numeric"
                      className="form-input"
                      style={{ width: '70px', textAlign: 'center' }}
                      value={v.text}
                      min={0}
                      onChange={(e) => setRow(r.playerId, { text: e.target.value })}
                      aria-label={`Final pitches for ${r.name}`}
                    />
                    <button
                      className="btn btn-sm btn-primary"
                      disabled={n === null}
                      onClick={() => handleConfirmRow(r)}
                    >
                      Confirm
                    </button>
                    <button
                      className="btn btn-sm btn-ghost"
                      title="No trustworthy count can be established"
                      onClick={() => setAckPrompt({ row: r, kind: 'unknown' })}
                    >
                      ?
                    </button>
                  </>
                ) : (
                  <button
                    className="btn btn-sm btn-secondary"
                    onClick={() => setRow(r.playerId, { resolved: null })}
                  >
                    Edit
                  </button>
                )}
              </div>
            );
          })}
        </>
      ) : (
        <p className="text-small">No pitching was recorded in this game.</p>
      )}

      {ackPrompt && (
        <Modal title={ackPrompt.kind === 'zero' ? 'Confirm Zero Pitches?' : 'No Count Available?'} onClose={() => setAckPrompt(null)}>
          {ackPrompt.kind === 'zero' ? (
            <p className="text-small" style={{ marginBottom: '16px' }}>
              {ackPrompt.row.name} pitched {formatOutsAsInnings(ackPrompt.row.pitchingOuts)} inning
              {ackPrompt.row.pitchingOuts === 3 ? '' : 's'} but the count is 0. Confirm only if
              they truly threw no pitches. If you just didn't count, use
              "no count" instead - a wrong zero makes them look fully rested.
            </p>
          ) : (
            <p className="text-small" style={{ marginBottom: '16px' }}>
              Use this only when no trustworthy total exists (no counter, no
              book, no scorer). {ackPrompt.row.name} will be treated as needing
              the <strong>maximum rest</strong> your rules allow until you enter
              a real count in History.
            </p>
          )}
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setAckPrompt(null)}>
              Back
            </button>
            <button
              className={`btn ${ackPrompt.kind === 'zero' ? 'btn-primary' : 'btn-danger'}`}
              style={{ flex: 1 }}
              onClick={() => {
                setRow(ackPrompt.row.playerId, {
                  resolved: ackPrompt.kind === 'zero' ? 'confirmed' : 'unknown'
                });
                setAckPrompt(null);
              }}
            >
              {ackPrompt.kind === 'zero' ? 'Yes, exactly 0 pitches' : 'I understand - no count'}
            </button>
          </div>
        </Modal>
      )}
    </Modal>
  );
}

// ============================================
// Live formation change - pick a player for a spot
// ============================================
export function LiveSpotPickerModal({ position, players, currentHolderId, warningsFor, onSelect, onClose }) {
  const [overridePrompt, setOverridePrompt] = React.useState(null);

  const pick = (player) => {
    const warnings = warningsFor ? warningsFor(player) : [];
    const blocked = warnings.some(w => w.severity === 'block');
    if (blocked) return;
    if (warnings.length > 0) {
      setOverridePrompt({ player, warnings });
    } else {
      onSelect(player.id);
    }
  };

  return (
    <Modal title={position === 'SIT' ? 'Send to Bench' : `Who takes ${POSITION_LABELS[position] || position}?`} onClose={onClose}>
      <p className="text-muted text-small mb-md">
        The player currently there swaps into this player's old spot.
      </p>
      <OptionList>
        {players.map(player => {
          const warnings = warningsFor ? warningsFor(player) : [];
          const blocked = warnings.some(w => w.severity === 'block');
          return (
            <OptionItem
              key={player.id}
              title={`${player.name}${player.id === currentHolderId ? ' (current)' : ''}${blocked ? ' - cannot' : warnings.length ? ' ⚠' : ''}`}
              description={warnings[0]?.short}
              onClick={() => pick(player)}
            />
          );
        })}
      </OptionList>

      {overridePrompt && (
        <Modal title="Rule Warning" onClose={() => setOverridePrompt(null)}>
          <Alert type="warning">
            {overridePrompt.warnings.map((w, i) => <div key={i}>{w.message}</div>)}
          </Alert>
          <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
            <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setOverridePrompt(null)}>
              Cancel
            </button>
            <button
              className="btn btn-danger"
              style={{ flex: 1 }}
              onClick={() => {
                onSelect(overridePrompt.player.id);
                setOverridePrompt(null);
              }}
            >
              Override & Assign
            </button>
          </div>
        </Modal>
      )}
    </Modal>
  );
}

// ============================================
// Player Exit Modal
// ============================================
export function PlayerExitModal({ player, inning, onConfirm, onClose }) {
  return (
    <Modal title={`${player.name} Exiting`} onClose={onClose}>
      <p style={{ marginBottom: '16px' }}>
        Mark <strong>{player.name}</strong> as exited from inning {inning}?
      </p>
      <p className="text-muted text-small" style={{ marginBottom: '16px' }}>
        Their batting slot will be skipped. Previous innings stay as-is.
      </p>

      <OptionList>
        <OptionItem
          title="Re-solve Lineup"
          description="Automatically adjust remaining innings"
          onClick={() => onConfirm('resolve')}
        />
        <OptionItem
          title="Manual Adjust"
          description="I'll reassign positions myself"
          onClick={() => onConfirm('manual')}
        />
      </OptionList>

      <div style={{ marginTop: '16px' }}>
        <button className="btn btn-secondary btn-block" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

// ============================================
// Displacement Resolution Modal
// ============================================
export function DisplacementModal({ changes, onAccept, onUndo, onClose }) {
  return (
    <Modal title="Position Changes" onClose={onClose}>
      <p style={{ marginBottom: '16px' }}>
        The following changes will be made:
      </p>

      <div style={{
        background: 'var(--bg-secondary)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--space-md)',
        marginBottom: '16px'
      }}>
        {changes.map((change, idx) => (
          <div key={idx} style={{
            padding: '8px 0',
            borderBottom: idx < changes.length - 1 ? '1px solid var(--border-light)' : 'none'
          }}>
            <strong>{change.player}</strong>
            <span style={{ color: 'var(--text-secondary)', margin: '0 8px' }}>→</span>
            <PositionBadge position={change.to} />
            {change.from && (
              <span className="text-muted text-small" style={{ marginLeft: '8px' }}>
                (was {change.from})
              </span>
            )}
            {change.type === 'manual' && (
              <span className="text-small" style={{ marginLeft: '8px', color: 'var(--accent)' }}>
                your choice
              </span>
            )}
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: '8px' }}>
        <button className="btn btn-secondary" onClick={onUndo} style={{ flex: 1 }}>
          Undo
        </button>
        <button className="btn btn-primary" onClick={onAccept} style={{ flex: 1 }}>
          Accept
        </button>
      </div>
    </Modal>
  );
}

// ============================================
// Avoid Override Modal
// ============================================
export function AvoidOverrideModal({ blockers, onOverride, onClose }) {
  return (
    <Modal title="Cannot Create Lineup" onClose={onClose}>
      <Alert type="warning">
        Cannot create lineup without using avoided positions.
      </Alert>

      <p style={{ marginBottom: '16px' }}>
        Select one to allow for this game:
      </p>

      <OptionList>
        {blockers.map((blocker) => (
          blocker.players.map(player => (
            <OptionItem
              key={`${player.id}-${blocker.position}`}
              title={`${player.name} at ${blocker.position}`}
              description={`${player.name} has ${blocker.position} marked as "Avoid"`}
              onClick={() => onOverride({ playerId: player.id, position: blocker.position })}
            />
          ))
        ))}
      </OptionList>

      <div style={{ marginTop: '16px' }}>
        <button className="btn btn-secondary btn-block" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

// ============================================
// Sit Override Modal
//
// Shown when the solver can't keep everyone within the
// max-sits-per-game setting (e.g., a big roster or a low
// max). The coach explicitly allows extra bench innings
// for this game. Previously this failure was silent - the
// Fill button appeared to do nothing.
// ============================================
export function SitOverrideModal({ playersNeeded, maxSitsPerGame, onAllow, onClose }) {
  return (
    <Modal title="Sit Limit Reached" onClose={onClose}>
      <Alert type="warning">
        The lineup can't be completed without someone sitting more than{' '}
        {maxSitsPerGame} {maxSitsPerGame === 1 ? 'inning' : 'innings'} this game.
      </Alert>

      <p style={{ margin: '16px 0' }}>
        These players are at the limit. Allow extra sit innings to finish the lineup
        (sits will still be spread as evenly as possible):
      </p>

      <div style={{
        background: 'var(--bg-secondary)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--space-md)',
        marginBottom: '16px'
      }}>
        {playersNeeded.map(p => (
          <div key={p.id} style={{ padding: '4px 0' }}>
            <strong>{p.name}</strong>
            <span className="text-muted text-small" style={{ marginLeft: '8px' }}>
              {p.currentSits} {p.currentSits === 1 ? 'sit' : 'sits'} so far
            </span>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: '8px' }}>
        <button className="btn btn-secondary" onClick={onClose} style={{ flex: 1 }}>
          Cancel
        </button>
        <button
          className="btn btn-primary"
          onClick={() => onAllow(playersNeeded.map(p => p.id))}
          style={{ flex: 1 }}
        >
          Allow Extra Sits
        </button>
      </div>
    </Modal>
  );
}

// ============================================
// Game Start Options Modal
// ============================================
export function GameStartOptionsModal({ hasDefaultOrder, hasLastGame, onSelect, onClose }) {
  return (
    <Modal title="Set Batting Order" onClose={onClose}>
      <OptionList>
        {hasDefaultOrder && (
          <OptionItem
            title="Use Default Lineup"
            description="Load your saved batting order template"
            onClick={() => onSelect('default')}
          />
        )}
        {hasLastGame && (
          <OptionItem
            title="Use Last Game's Lineup"
            description="Start with previous game's batting order"
            onClick={() => onSelect('lastGame')}
          />
        )}
        <OptionItem
          title="Start Blank"
          description="Players in roster order"
          onClick={() => onSelect('blank')}
        />
      </OptionList>
    </Modal>
  );
}
