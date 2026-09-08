# Continuous pitching default

Branch: fix/continuous-pitching

Automatic generation, Resolve and Fill and Resolve require one continuous pitching block per player, independently of the league's maximum mound returns. Locked pitching assignments obey the same constraint. Empty gaps between locks remain fillable; assigned gaps cannot be bridged, and a final validation prevents a fragmented plan from being saved.

Actual live pitching appearances, including zero-out substitutions, trigger a return confirmation even when the league permits the return. Existing league warnings still apply. The solver excludes players with this warning from future assignments. Current pitchers may continue; manual live exceptions remain recordable. Inning transitions already use this same confirmation gate, so an older saved plan cannot silently return a pitcher.

Manual planned swaps validate both affected players. The position picker uses the solver's shared contiguity check. Current live position changes remain available through explicit confirmation. Historical outs and recorded pitching counts are unchanged. No migration or new settings are required.

Regression coverage includes disallowed separated assignments despite two permitted stints, three consecutive locked innings, filling between locks, preserving played innings while excluding a retired pitcher, zero-out mid-inning returns and subsequent continuation, and excluding drafts from actual-appearance checks.
