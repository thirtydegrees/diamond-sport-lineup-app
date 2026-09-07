# Shakedown stabilization

Branch: `fix/shakedown-stabilization`, based on production commit `f8057dc`.
Scope: existing workflows only. No database migration, merge, or deployment.

## Changes and reasons

- **Build identifier:** removed the visible build label and empty update-banner space. The existing update prompt remains; the build identifier is available only as the root HTML element's `data-build` diagnostic attribute.
- **Team identity:** the header has separate app and team lines. Header, Account & Sync, and score labels consume React context populated from the committed data-owner marker. They no longer depend on reading a mutable service singleton during a render. This also fixes rename updates when the sync status string does not change.
- **Team switching:** navigation survives snapshot hydration; team-specific screens/forms still remount so stale forms cannot write into a newly loaded team. A pending transition disables interaction and names the destination. The previous identity remains until destination data is committed. A failed fetch retains the current team, data, screen, and a retryable error. Intentional hydration no longer produces the misleading generic newer-changes toast. A no-change Sync Now no longer remounts forms unnecessarily.
- **Setup layout:** consistent spacing between team-name input/action and sport, rules, and save controls. Existing setup behavior is retained.
- **Generation:** suppress browser scroll anchoring inside the changing lineup and explicitly return to the top after the initial generation choice closes. Re-solving does not deliberately navigate away from its current context.
- **Live score:** prominent team totals and + Run buttons in the live panel. The scoring inning is explicit and can be selected independently of defensive outs; earlier innings remain correctable inline. Both the grid and live panel use one immutable inning-score operation, applied to the latest game state. Scores never modify outs, pitch counts, or inning progression. The live screen no longer offers an accidental Back to Setup exit.
- **Outside workload:** reuse the existing nonempty `workloadSource` field as the discriminator, including already-saved entries. History identifies the source and pitcher, omits score/result/lineup/participation treatment, and retains pitch-count correction and deletion. These entries remain in pitching workload/rest calculations and pitching charts, where labels now say outings. They are excluded from Games Tracked and last-game lineup selection. Backup validation checks the discriminator; no SQL or stored-data migration is required.

## Verification

- Full Vitest suite: 216 tests in 12 files, including PostgreSQL/RLS/CAS and existing sync-race tests.
- Production TypeScript/Vite build.
- Desktop/mobile browser suite: generation scroll, live scoring/correction/persistence, existing game completion/history/backup flows, and single-writer tab behavior.
- Isolated mocked-account browser regression: delayed team fetch, atomic identity/data hydration, retained Settings navigation, same-status rename, failed destination fetch, retry, and outside-workload history presentation. All mock Supabase requests are intercepted; no production account or data is used.
- Visual inspection of mobile live scoring and Settings layouts.

The browser run uses Chromium. Physical-device Safari/PWA checks and real authenticated cross-device checks are still useful before beta. Existing whole-team conflict behavior is unchanged. Remote hydration still resets unsaved team-specific forms deliberately, but it no longer resets the navigation shell.

## Bounded doubleheader assessment

**Recommendation: defer the feature and make no structural change now.** There is a single current/upcoming game in the present product, but no material database-level lock-in that warrants a speculative refactor.

Evidence:

- `src/domain/games.ts` operations such as `startLiveGame`, `completeGame`, and `normalizeGamePlan` operate on an explicit `Game`, with stable IDs. The solver also receives an explicit plan rather than looking up global current-game state.
- `src/domain/types.ts` gives each game its own status, plan, score, live state, out ledger, pitching counts, and rules snapshot. Those fields are not intrinsically limited to one planned game.
- `src/state/AppContext.jsx`, `src/App.jsx`, and `src/views/GameSetupView.jsx` expose/select a singleton current game. Setup initialization, continue/new/discard behavior, and completion routing would need deliberate changes for multiple plans.
- `src/services/storage.ts` and `src/services/backup.ts` explicitly enumerate `currentGame` and `games`. Adding a planned-game collection would require updating those validated boundaries and preserving older backups. Supabase stores the whole team as JSON with revision checking; multiple plans do not require a new relational scheduling schema.

A later implementation could store planned games by stable ID and select an active ID, or add a separate planned-games collection while retaining the current-game contract. Choose only after deciding whether coaches may keep multiple *live* games, how the second game gets revalidated after the first game's actual workload, and what resuming/discarding a plan means. Same-day rest eligibility must be reassessed at game start, not frozen when a plan is generated.

Indicative lift: 3–5 engineering days for a narrowly scoped multiple-plan/doubleheader workflow, including persistence/backup compatibility and regression tests, excluding calendar scheduling or simultaneous assistant-coach editing. Extracting a selection layer now would cost roughly half to one day but would not resolve those product decisions or eliminate the later work. No such extraction was made.

## Release status

Changes are committed on a new local branch for review. They are not merged or deployed. The branch is not pushed because this repository's existing GitHub integration automatically creates Vercel deployments on branch pushes.

## Sign-out follow-up

Sign Out is now a prominent button in the Account & Sync header. Supabase logout uses `scope: 'local'` so another device remains signed in. Successful sign-out resets session-bound forms/dialogs, returns to Settings and the sign-in form, and labels retained local identity as a saved team. Team data, ownership metadata, and pending-change metadata are retained. Existing pending-edit confirmation remains; confirming does not repeat the preceding flush. Logout failures remain visible and do not falsely show a signed-out state.

Verification: 216 unit/database tests, production build, and full browser suite passed. The added mocked-Supabase browser flow verifies a failed logout, retry, local logout scope, auth-token removal, retained team data, and sign-in restoration of the selected nonpersonal team. This is an integration test against intercepted Auth responses, not a claim of testing a real production account.
