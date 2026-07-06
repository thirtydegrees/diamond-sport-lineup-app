/* ============================================
   Diamond Lineup - Settings View
   ============================================ */

import React from 'react';
import { AppContext } from '../state/AppContext';
import { Storage } from '../services/storage';
import { Toggle } from '../components/ui';

export function SettingsView() {
  const { settings, setSettings, roster } = React.useContext(AppContext);
  // Bump to re-read Storage-backed values (default batting order) after changes
  const [, setRefresh] = React.useState(0);

  const updateSetting = (key, value) => {
    setSettings({ ...settings, [key]: value });
  };

  const updatePitchRules = (mutate) => {
    const newRules = {
      ...settings.pitchRules,
      breakpoints: settings.pitchRules.breakpoints.map(bp => ({ ...bp }))
    };
    mutate(newRules);
    updateSetting('pitchRules', newRules);
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

  return (
    <div>
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

      {/* Game Rules */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">Game Rules</div>
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
        </div>
      </div>

      {/* Pitch Count Rules */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">Pitch Count Rules</div>
        </div>
        <div className="card-body">
          <p className="text-muted text-small mb-md">
            Rest days required based on pitches thrown.
          </p>
          {settings.pitchRules.breakpoints.map((bp, idx) => (
            <div
              key={idx}
              style={{
                display: 'flex',
                gap: '12px',
                marginBottom: '12px',
                alignItems: 'flex-end'
              }}
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
                value={settings.pitchRules.absoluteMax}
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
                value={settings.pitchRules.absoluteMaxRest}
                onChange={(e) => {
                  const val = parseInt(e.target.value) || 0;
                  updatePitchRules(rules => { rules.absoluteMaxRest = val; });
                }}
              />
            </div>
          </div>
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
