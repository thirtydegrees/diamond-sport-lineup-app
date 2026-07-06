/* ============================================
   Diamond Lineup - Settings View
   ============================================ */

import React from 'react';
import { AppContext } from '../state/AppContext';
import { Storage } from '../services/storage';
import { CUSTOM_PRESET_ID, getPreset, getPresetsForSport } from '../domain/presets';
import { Toggle } from '../components/ui';

export function SettingsView() {
  const { settings, setSettings, roster } = React.useContext(AppContext);
  // Bump to re-read Storage-backed values (default batting order) after changes
  const [, setRefresh] = React.useState(0);

  const updateSetting = (key, value) => {
    setSettings({ ...settings, [key]: value });
  };

  const updateFairness = (key, value) => {
    setSettings({ ...settings, fairness: { ...settings.fairness, [key]: value } });
  };

  /** Any manual edit to the pitch rules switches the preset to Custom. */
  const updatePitchRules = (mutate) => {
    const newRules = {
      ...settings.pitchRules,
      breakpoints: settings.pitchRules.breakpoints.map(bp => ({ ...bp })),
      inningsBreakpoints: settings.pitchRules.inningsBreakpoints.map(bp => ({ ...bp }))
    };
    mutate(newRules);
    setSettings({ ...settings, pitchRules: newRules, pitchRulePreset: CUSTOM_PRESET_ID });
  };

  const applyPreset = (presetId) => {
    if (presetId === CUSTOM_PRESET_ID) {
      updateSetting('pitchRulePreset', CUSTOM_PRESET_ID);
      return;
    }
    const preset = getPreset(presetId);
    if (!preset) return;
    setSettings({
      ...settings,
      pitchRulePreset: preset.id,
      pitchRules: {
        ...preset.rules,
        breakpoints: preset.rules.breakpoints.map(bp => ({ ...bp })),
        inningsBreakpoints: preset.rules.inningsBreakpoints.map(bp => ({ ...bp }))
      }
    });
  };

  const handleSportChange = (sport) => {
    // Keep the pitch rules; just switch sport (and pick a sensible preset if
    // the current one belongs to the other sport).
    const currentPreset = getPreset(settings.pitchRulePreset);
    if (currentPreset && currentPreset.sport !== sport) {
      const fallback = getPresetsForSport(sport)[0];
      setSettings({
        ...settings,
        sport,
        pitchRulePreset: fallback.id,
        pitchRules: {
          ...fallback.rules,
          breakpoints: fallback.rules.breakpoints.map(bp => ({ ...bp })),
          inningsBreakpoints: fallback.rules.inningsBreakpoints.map(bp => ({ ...bp }))
        }
      });
    } else {
      updateSetting('sport', sport);
    }
  };

  const handleSaveDefaultOrder = () => {
    const currentOrder = roster.map(p => p.id);
    Storage.saveDefaultBattingOrder(currentOrder);
    setRefresh(n => n + 1);
    alert('Default batting order saved!');
  };

  const handleClearDefaultOrder = () => {
    Storage.clearDefaultBattingOrder();
    setRefresh(n => n + 1);
    alert('Default batting order cleared.');
  };

  const handleClearAllData = () => {
    if (confirm('Delete ALL data? This includes roster, games, pitch history, and settings. This cannot be undone.')) {
      Storage.clearAllData();
      window.location.reload();
    }
  };

  const defaultOrder = Storage.getDefaultBattingOrder();
  const presets = getPresetsForSport(settings.sport);
  const { pitchRules } = settings;

  return (
    <div>
      {/* Sport & Field */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">Sport & Field</div>
        </div>
        <div className="card-body">
          <div className="form-group">
            <label className="form-label">Sport</label>
            <select
              className="form-select"
              value={settings.sport}
              onChange={(e) => handleSportChange(e.target.value)}
            >
              <option value="baseball">⚾ Baseball</option>
              <option value="softball">🥎 Softball</option>
            </select>
            <p className="form-hint">
              Softball turns off the baseball-specific pitcher/catcher rest rule and
              allows split pitching stints.
            </p>
          </div>

          <div className="form-group">
            <label className="form-label">Fielders</label>
            <select
              className="form-select"
              value={settings.fielderCount}
              onChange={(e) => updateSetting('fielderCount', parseInt(e.target.value))}
            >
              <option value={9}>9 fielders (standard)</option>
              <option value={10}>10 fielders (4 outfielders)</option>
            </select>
            <p className="form-hint">
              10 fielders adds SC (short center / rover), common in youth softball and
              some 8-10U divisions. Applies to new games.
            </p>
          </div>
        </div>
      </div>

      {/* Display Settings */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">Display</div>
        </div>
        <div className="card-body">
          <Toggle
            checked={settings.darkMode}
            onChange={(v) => updateSetting('darkMode', v)}
            label="Dark Mode"
          />
        </div>
      </div>

      {/* Game & Fairness Rules */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">Game & Fairness Rules</div>
        </div>
        <div className="card-body">
          <div className="form-group">
            <label className="form-label">Default Innings</label>
            <select
              className="form-select"
              value={settings.innings}
              onChange={(e) => updateSetting('innings', parseInt(e.target.value))}
            >
              <option value={5}>5 innings</option>
              <option value={6}>6 innings</option>
              <option value={7}>7 innings</option>
            </select>
            <p className="form-hint">Can be adjusted per game. Use "Add Inning" during games for extras.</p>
          </div>

          <div className="form-group">
            <label className="form-label">Max Sits Per Game</label>
            <select
              className="form-select"
              value={settings.maxSitsPerGame}
              onChange={(e) => updateSetting('maxSitsPerGame', parseInt(e.target.value))}
            >
              <option value={1}>1 inning max</option>
              <option value={2}>2 innings max</option>
              <option value={3}>3 innings max</option>
              <option value={4}>4 innings max</option>
            </select>
            <p className="form-hint">Total innings a player can sit during a game. Override if unavoidable.</p>
          </div>

          <div className="form-group">
            <label className="form-label">Max Consecutive Sits</label>
            <select
              className="form-select"
              value={settings.fairness.maxConsecutiveSits ?? 'off'}
              onChange={(e) => updateFairness(
                'maxConsecutiveSits',
                e.target.value === 'off' ? null : parseInt(e.target.value)
              )}
            >
              <option value="off">Off</option>
              <option value={1}>1 inning (never twice in a row)</option>
              <option value={2}>2 innings in a row</option>
            </select>
            <p className="form-hint">Prevents players from sitting too many innings back-to-back.</p>
          </div>

          <div className="form-group">
            <Toggle
              checked={settings.fairness.everyoneInfield}
              onChange={(v) => updateFairness('everyoneInfield', v)}
              label="Everyone plays infield at least once per game"
            />
            <p className="form-hint">
              The solver gives every player at least one non-outfield inning and warns
              when it can't.
            </p>
          </div>
        </div>
      </div>

      {/* Pitching Rules */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">Pitching Rules</div>
        </div>
        <div className="card-body">
          <div className="form-group">
            <label className="form-label">League Preset</label>
            <select
              className="form-select"
              value={settings.pitchRulePreset}
              onChange={(e) => applyPreset(e.target.value)}
            >
              {presets.map(p => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
              <option value={CUSTOM_PRESET_ID}>Custom</option>
            </select>
            <p className="form-hint">
              {getPreset(settings.pitchRulePreset)?.description ??
                'Custom rules. Editing any value below switches to Custom.'}
              {' '}Always verify against your league's current rules.
            </p>
          </div>

          <div className="form-group">
            <label className="form-label">Limit Type</label>
            <select
              className="form-select"
              value={pitchRules.limitType}
              onChange={(e) => updatePitchRules(rules => { rules.limitType = e.target.value; })}
            >
              <option value="pitches">Pitch counts (baseball style)</option>
              <option value="innings">Innings pitched (softball style)</option>
              <option value="none">No pitching limits</option>
            </select>
          </div>

          {pitchRules.limitType === 'pitches' && (
            <>
              <p className="text-muted text-small mb-md">
                Rest days required based on pitches thrown.
              </p>
              {pitchRules.breakpoints.map((bp, idx) => (
                <div
                  key={idx}
                  style={{ display: 'flex', gap: '12px', marginBottom: '12px', alignItems: 'flex-end' }}
                >
                  <div style={{ flex: 1 }}>
                    <label className="form-label">Up to pitches</label>
                    <input
                      type="number"
                      className="form-input"
                      value={bp.maxPitches}
                      onChange={(e) => {
                        const val = parseInt(e.target.value) || 0;
                        updatePitchRules(rules => { rules.breakpoints[idx].maxPitches = val; });
                      }}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label className="form-label">Rest days</label>
                    <input
                      type="number"
                      className="form-input"
                      value={bp.restDays}
                      onChange={(e) => {
                        const val = parseInt(e.target.value) || 0;
                        updatePitchRules(rules => { rules.breakpoints[idx].restDays = val; });
                      }}
                    />
                  </div>
                </div>
              ))}

              <div style={{
                display: 'flex',
                gap: '12px',
                marginTop: '16px',
                paddingTop: '16px',
                borderTop: '1px solid var(--border-light)'
              }}>
                <div style={{ flex: 1 }}>
                  <label className="form-label">Absolute Max Pitches</label>
                  <input
                    type="number"
                    className="form-input"
                    value={pitchRules.absoluteMax}
                    onChange={(e) => {
                      const val = parseInt(e.target.value) || 0;
                      updatePitchRules(rules => { rules.absoluteMax = val; });
                    }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label className="form-label">Rest at Max</label>
                  <input
                    type="number"
                    className="form-input"
                    value={pitchRules.absoluteMaxRest}
                    onChange={(e) => {
                      const val = parseInt(e.target.value) || 0;
                      updatePitchRules(rules => { rules.absoluteMaxRest = val; });
                    }}
                  />
                </div>
              </div>
            </>
          )}

          {pitchRules.limitType === 'innings' && (
            <>
              <p className="text-muted text-small mb-md">
                Rest days required based on innings pitched.
              </p>
              {pitchRules.inningsBreakpoints.map((bp, idx) => (
                <div
                  key={idx}
                  style={{ display: 'flex', gap: '12px', marginBottom: '12px', alignItems: 'flex-end' }}
                >
                  <div style={{ flex: 1 }}>
                    <label className="form-label">Up to innings</label>
                    <input
                      type="number"
                      className="form-input"
                      value={bp.maxInnings}
                      onChange={(e) => {
                        const val = parseInt(e.target.value) || 0;
                        updatePitchRules(rules => { rules.inningsBreakpoints[idx].maxInnings = val; });
                      }}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label className="form-label">Rest days</label>
                    <input
                      type="number"
                      className="form-input"
                      value={bp.restDays}
                      onChange={(e) => {
                        const val = parseInt(e.target.value) || 0;
                        updatePitchRules(rules => { rules.inningsBreakpoints[idx].restDays = val; });
                      }}
                    />
                  </div>
                </div>
              ))}

              <div className="form-group" style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--border-light)' }}>
                <label className="form-label">Max Innings Per Game (per pitcher)</label>
                <input
                  type="number"
                  className="form-input"
                  value={pitchRules.maxInningsPerGame ?? ''}
                  placeholder="No cap"
                  onChange={(e) => {
                    const val = e.target.value === '' ? null : (parseInt(e.target.value) || 0);
                    updatePitchRules(rules => { rules.maxInningsPerGame = val; });
                  }}
                />
                <p className="form-hint">Leave empty for no per-game cap. The solver won't schedule a pitcher past this.</p>
              </div>
            </>
          )}

          {pitchRules.limitType === 'none' && (
            <p className="text-muted text-small">
              No workload restrictions. All pitchers always show as eligible.
            </p>
          )}
        </div>
      </div>

      {/* Default Batting Order */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">Default Batting Order</div>
        </div>
        <div className="card-body">
          {defaultOrder ? (
            <>
              <p className="text-small mb-md">
                Default order saved ({defaultOrder.length} players)
              </p>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button className="btn btn-secondary" onClick={handleSaveDefaultOrder}>
                  Update from Roster
                </button>
                <button className="btn btn-secondary" onClick={handleClearDefaultOrder}>
                  Clear
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-muted text-small mb-md">
                No default batting order saved. Current roster order will be used.
              </p>
              <button className="btn btn-secondary" onClick={handleSaveDefaultOrder}>
                Save Current Roster Order as Default
              </button>
            </>
          )}
        </div>
      </div>

      {/* Data Management */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">Data</div>
        </div>
        <div className="card-body">
          <button className="btn btn-danger" onClick={handleClearAllData}>
            Clear All Data
          </button>
          <p className="form-hint mt-sm">
            This will delete your roster, all games, pitch history, and settings.
          </p>
        </div>
      </div>
    </div>
  );
}
