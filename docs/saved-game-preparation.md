# Saved game preparation

Branch: `fix/saved-game-preparation`, based on production `f2d57b8`.

## Changes

The existing draft/live/completed lifecycle remains the model. The defect was that Game Info lived in component state until Continue to Lineup, while blank-lineup choices and generator overrides were lost on unmount.

- Setup fields now update the persisted current draft directly. Date, opponent, batting order and availability survive navigation/reload before lineup generation.
- Optional setupOrder retains unavailable-player ordering separately from the active batting order. Existing plan normalization removes unavailable players and out-of-range innings from the plan.
- Optional preparationStage, lineupInitialized, avoidOverrides and sitOverrides retain preparation progress and generator choices. Existing drafts without these fields fall back to their existing lineup. Backup validation and round-trip coverage include the new fields.
- Returning to Game opens the saved draft setup/lineup directly. Draft labels, scheduled date and automatic-saving copy distinguish preparation from live activity. Edit Draft / Game Info remains available before starting; replacing a draft requires confirmation.
- Pitchers has an eligibility-date selector defaulting to today, calling the same assessPitcherRest function used in Game Info. Game Info now honors the game's rules snapshot consistently with the lineup.
- Native mobile date input sizing follows other form inputs.
- Draft score editing is disabled. Starting a draft initializes actual outs, pitches and scores empty. Historical eligibility continues to derive only completed outings and exclude future-dated outings relative to the selected date.
- Removed an extra Complete Game button left in the actions row by the previous pass; the bottom action remains.

One draft/current game per team; no calendar, scheduling service, multiple drafts, or database migration. These fields travel through the existing atomic team snapshot and local persistence.

## Validation

222 unit/database tests passed. TypeScript/Vite build passed. Full desktop/mobile browser suite passed.

Focused mobile test covers: tomorrow's date; immediate setup persistence; leaving/returning; blank choice persistence; generation; reload and exact plan preservation; editing draft info; date selector; explicit start; outs/pitches/runs; navigation/reload and exact live-state preservation; completion into history; future-dated completed workload excluded from today's eligibility and included for the selected game date.

Regression tests cover draft workload exclusion, actual activity initialization at start, full-day-rest dates, and backup round-trip of preparation metadata. Existing authenticated sync and account-transition browser checks also pass with intercepted Supabase responses.

Native iOS Safari date-picker presentation still merits a physical-device check; browser automation used Chromium at phone dimensions. No production data was modified during validation. The snapshot conflict model is unchanged.
