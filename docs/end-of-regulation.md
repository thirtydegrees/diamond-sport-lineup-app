# Live-game order and explicit extra innings

Branch: `fix/continuous-pitching` (includes the prior consecutive-pitching remediation).

The live workflow now presents inning/outs, defensive-out controls, pitching controls, runs, and then defensive assignments. Complete Game is a filled primary button near the bottom.

The final scheduled third out stops at that inning with three outs recorded. A modal offers Complete Game (the existing pitch-review/completion flow) or Add Inning. Dismissing the modal preserves the finished inning for score corrections or undo; completion and explicit extension remain available. No nineteenth defensive out can be recorded in a finished six-inning game until the coach extends it.

Explicit extension creates one inning with a carried defensive formation and matching planned pitcher. A persisted optional `live.preparing` flag allows the newly added inning to use the normal planning tools. Resolving hydrates its live formation. Recording an out, pitches, or current-inning runs ends preparation and restores historical-state protection. Earlier innings and actual participation remain unchanged. No database migration is required.

Validation: 230 unit/database tests, TypeScript/Vite production build, and desktop/mobile browser suite. The dedicated 390px mobile scenario plays all 18 outs twice, verifies the revised order and button styling, completes one game through pitch review, and explicitly adds/resolves inning seven in the other. It checks that recorded history survives resolving and that the first pitch protects the current inning again. Physical-device Safari testing remains a beta check.
