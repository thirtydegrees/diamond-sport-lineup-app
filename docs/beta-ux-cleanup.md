# Beta UX cleanup

Branch: `fix/beta-ux-cleanup`, based on production `515b225`.

## Changes

- Inline pitcher identity, game pitch total, +1 Pitch, detailed counter access and guarded Undo last pitch. The counter uses existing pitch-count operations; detail edits invalidate inline undo. The daily-limit notice remains available inline.
- Quick scoring has a named Undo last run. Undo checks the relevant current score and changes only that inning's run count, without restoring old game snapshots.
- Startup waits for the initial account/snapshot path before choosing a saved live game or draft. Deliberate tab navigation prevents later automatic redirection. Duplicate auth events cannot mark startup ready while the first hydration is pending.
- Current outs replace cumulative participation totals in the live header. Opponent/date remain visible. Finish Defense explicitly describes recording the remaining defensive outs; undo labels identify whether the previous action recorded one or several outs.
- Live planning/statistics/game options collapse by default. Draft planning remains expanded. Printing expands the sections temporarily. Completion remains a separate bottom action.
- Compact names use full names when first names collide, and live position titles expose the full name. Bench button size and styling remain unchanged.
- Swap confirmations put each changed player on a separate line.
- Assigned planned-pitcher buttons use quieter styling, and completion pitch-review rows stack on phones.
- Compact save status distinguishes local saving, syncing, synced and attention-needed states. Local write errors have a persistent message. Routine game-start/inning-advance success toasts were removed so they do not cover live scoring controls; counters and inning changes provide feedback directly.

No schema migration, new scheduling functionality or production data changes.

## Validation

222 unit/database tests pass. Production TypeScript/Vite build and full desktop/mobile browser suite pass. Targeted checks cover inline pitch/run undo, invalidating pitch undo after detailed-counter edits, draft/live reload opening, collapsed live sections, startup into a cloud-hydrated draft, preserved Settings navigation during team switches, auth transitions and completion/history. Mobile screenshot inspected.

Physical-device Safari and outdoor legibility remain useful beta checks. Cloud-auth browser scenarios use intercepted Supabase responses. Only the most recent inline pitch/run has an undo control; detailed correction remains available. Undo is deliberately unavailable after incompatible edits or hydration.
