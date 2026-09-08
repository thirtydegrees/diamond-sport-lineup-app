# Live-game beta safety

Branch: `fix/live-game-safety`, based on production `9b18080`.

- Live order: inning/outs, record out and undo/end-inning controls, pitching, current defense/bench, quick runs, detailed plan/scoring, completion at the bottom.
- Quick + Run always uses the active inning. Historical corrections have their own selection inside Correct inning scores; that selection returns to current when the inning changes.
- Inning score headers and both team rows share a fixed-column grid and one horizontal scroll surface. Opening a score editor expands that column in all rows together.
- Add Inning requires confirmation, guarded against intervening game changes.
- Clear & Re-solve is absent and guarded during live play.
- Live Fill / Re-solve becomes Re-solve Future Innings, with confirmation. The shared solver entry point clamps every automatic solve to at least the next inning. Current defense is changed manually through existing swap controls. Planned pitcher buttons for current/previous innings are disabled during live play.
- The solver no longer introduces stale locks into historical innings. Only the existing historical plan supplies those cells, including holes and departed-player assignments.
- Solver callback dependencies now include current pitching rules and game history.

No schema or persistence migration. No multiple-game or other feature expansion.

Validation: 219 unit/database tests; TypeScript/Vite build; full desktop/mobile browser suite, including history/current-state preservation on live resolve, scoring/corrections, Add Inning cancel/confirm, phone control order and score-column alignment. Mobile live screen visually inspected. Physical-device Safari/PWA testing remains useful.

The deliberate beta limitation is that automation only rebuilds future innings, even before the first out of the current inning. Manual current-defense changes remain available with confirmation. Historical plan cells retain existing explicit manual editing; automatic solving never edits them. Recorded participation remains the out ledger.
