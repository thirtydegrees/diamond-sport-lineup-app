/* ============================================
   Diamond Lineup - Feature Modals
   ============================================ */

import React from 'react';
import { POSITIONS, POSITION_LABELS, POSITION_TIERS } from '../domain/constants';
import { Solver } from '../domain/solver';
import { Storage } from '../services/storage';
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
      id: player?.id || Date.now().toString(),
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
export function PitcherPickerModal({ inning, players, currentPitcherId, gameDate, onSelect, onClose }) {
  // Group pitchers
  const primaryPitchers = [];
  const backupPitchers = [];

  players.forEach(player => {
    if (!player.canPitch) return;

    const eligibility = Storage.getPitcherEligibility(player.id, gameDate);
    const pitcherData = { player, eligibility };

    if (player.prefersPitching) {
      primaryPitchers.push(pitcherData);
    } else {
      backupPitchers.push(pitcherData);
    }
  });

  const renderPitcherOption = ({ player, eligibility }) => {
    const isSelected = player.id === currentPitcherId;

    return (
      <div
        key={player.id}
        className={`pitcher-option ${!eligibility.eligible ? 'disabled' : ''} ${isSelected ? 'selected' : ''}`}
        onClick={() => eligibility.eligible && onSelect(player.id)}
      >
        <span style={{ fontWeight: isSelected ? 600 : 400 }}>
          {player.name}
          {isSelected && ' ✓'}
        </span>
        <span className={`pitcher-status ${eligibility.eligible ? 'eligible' : 'ineligible'}`}>
          {eligibility.reason}
        </span>
      </div>
    );
  };

  return (
    <Modal title={`Pitcher - Inning ${inning}`} onClose={onClose}>
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

      <div style={{ marginTop: '16px' }}>
        <button className="btn btn-secondary btn-block" onClick={() => onSelect(null)}>
          Clear Assignment
        </button>
      </div>
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

    // Find all innings where this player is already pitching
    const pitchingInnings = [];
    for (let i = 1; i <= totalInnings; i++) {
      if (i !== inning && lineup?.[`${player.id}-${i}`] === 'P') {
        pitchingInnings.push(i);
      }
    }

    if (pitchingInnings.length === 0) return true;

    // Check if adding this inning would keep it contiguous
    const allInnings = [...pitchingInnings, inning].sort((a, b) => a - b);
    for (let i = 1; i < allInnings.length; i++) {
      if (allInnings[i] - allInnings[i - 1] !== 1) return false;
    }
    return true;
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

        {position === 'P' && (
          <OptionItem
            title="⚾ Pitch Counter"
            description="Track pitches thrown"
            onClick={() => onAction('pitchCount')}
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
// ============================================
export function PitchCounterModal({ player, inning, pitchLog, onUpdate, onEndInning, onClose }) {
  const currentInningPitches = pitchLog[inning] || 0;
  const totalPitches = Object.values(pitchLog).reduce((sum, count) => sum + count, 0);

  const handleIncrement = () => {
    onUpdate(inning, currentInningPitches + 1);
  };

  const handleDecrement = () => {
    if (currentInningPitches > 0) {
      onUpdate(inning, currentInningPitches - 1);
    }
  };

  return (
    <Modal title="Pitch Counter" onClose={onClose}>
      <div className="pitch-counter">
        <div className="pitch-counter-title">Current Pitcher</div>
        <div className="pitch-counter-name">{player.name}</div>

        <div className="pitch-counter-display">{totalPitches}</div>
        <div className="pitch-counter-inning">
          {currentInningPitches} this inning
        </div>

        <div className="pitch-counter-buttons">
          <button
            className="pitch-btn-minus"
            onClick={handleDecrement}
            disabled={currentInningPitches === 0}
            aria-label="Subtract one pitch"
          >
            −
          </button>
          <button
            className="pitch-btn-plus"
            onClick={handleIncrement}
            aria-label="Add one pitch"
          >
            +1
          </button>
        </div>

        <div className="pitch-counter-actions">
          <button className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
          <button className="btn btn-primary" onClick={onEndInning}>
            End Inning
          </button>
        </div>
      </div>
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
