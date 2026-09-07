# Post-audit remediation

Branch: `fix/post-audit-beta-remediation`. This branch prepares a coordinated frontend/database release. It does not deploy production changes.

## Changes and behavior

- Local edits and pending-sync metadata commit in one localStorage write. React changes only after that write succeeds. Completing a game moves it into history and clears the active game in the same transaction.
- Cloud persistence uses one revision-checked team snapshot. The database serializes writes per team, validates membership, and rejects stale revisions. Device clocks never choose a winner. A request UUID makes retries idempotent. There is no unconditional upsert fallback.
- Concurrent changes are deliberately treated as a conflict, even when they touch different fields. The local edits remain available. Download a backup, load the cloud version, and reapply the intended changes. Recovery copies can be downloaded in Account & Sync. Automatic merging is outside this change.
- Sync runs after edits, when connectivity returns, and when visibility changes. Sync Now both fetches and sends; it is not a special persistence action. Pending/error/conflict status and last-checked time are visible. This is pull-based sync, not Realtime; two idle visible devices are not promised instantaneous updates.
- Signout invalidates in-flight operations. Team/account transitions fetch and validate before replacing local data. Account replacement archives the old dataset. Team switches and clears cannot proceed past unresolved edits. Clear Team Data preserves team identity and settings and clears only that team's roster, games and lineup. Legacy clients lose cloud-write permission at cutover.
- A browser Web Lock permits one editing tab per origin. Another tab waits for the first to close. This intentionally favors integrity over concurrent same-browser editing; separate devices use server revision checks. Older browsers without Web Locks cannot edit this build.
- Incoming snapshots pass the same validation/migration boundary as backups. Hydration does not dirty data. Downloaded data remounts the workspace so old forms cannot write a pre-download snapshot.
- Rest days are full calendar days: Sept. 6 plus one rest day permits Sept. 8. Presets include appearance/day limits, consecutive pitching-day limits and age-specific mound returns. Pitch Smart 7–8 has rest tiers only through 50 pitches; its unknown-count assumption uses its highest listed tier. Over-limit outings still require coach review; these presets are not a complete league rulebook.
- Pitch totals obey `live = sum(byInning) + adjustment`. Direct correction preserves inning tallies. Subsequent taps change the total from the corrected baseline. Negative/fractional domain inputs are rejected.
- Solver inputs include structured pitcher exclusions; fixed assignments are checked too. Baseball plans prohibit pitcher/catcher changes across the entire game. Game start, next-inning formation changes, and manual swaps share the pitching policy. Unsafe actual events remain recordable with an explicit override.
- Live position changes from the plan's current inning change the live defense. Future plan edits remain plan-only. Swaps show their effects before confirmation. Delayed confirmations reject a changed game snapshot. End Inning requires confirmation; Undo Outs reverses the last bulk out action without rolling back pitch counts.
- Pitchers placed on the mound remain on the completion review list even without recorded outs or counter taps. A coach can add a missed pitcher and explicitly confirm zero or mark the count unknown. The first missing defensive out can be added in History. History supports unknown counts and requires acknowledgment of zero.
- New games snapshot rules, sport and rule version. Existing games lacking a snapshot use current team rules; no historical rules are invented. Outside workload can be entered from Pitchers, with date and source, and corrected in History. Legacy orphan pitch records are retained in backups for review, not silently converted into actual participation.
- Signup accepts an optional display name. Account & Sync supports team renaming and initial sport/rules setup. Active team identity appears in navigation and the scoreboard uses team/opponent names. Planning supports nine innings; live extra innings preserve scores and carry a defense if no additional plan exists. Planned Pitchers reflects the generated lineup rather than only explicit constraints.
- PWA updates are checked while visible, on reconnect and on a one-minute timer. A visible build identifier and update prompt replace silent automatic activation. The prompt reminds users to finish open forms.

Rule references: [Pitch Smart 8 and under](https://www.mlb.com/pitch-smart/pitching-guidelines/ages-8-and-under), [ages 9–12](https://www.mlb.com/pitch-smart/pitching-guidelines/ages-9-12), [ages 13–14](https://www.mlb.com/pitch-smart/pitching-guidelines/ages-13-14). League-specific exceptions and annual/off-season workload limits still require league/coach oversight.

## Deployment procedure

1. Export production `teams`, `team_members`, and `team_data`, plus backups from devices with pending changes. Verify these backups are readable. Schedule the cutover when coaches are not entering games.
2. The audit found the first two SQL migrations installed manually while the migration ledger was empty. Compare the installed schema/functions/policies/index against `0001_init.sql` and `0002_atomic_team_provisioning.sql`. Only after verifying equivalence, mark versions `0001` and `0002` applied with `supabase migration repair --status applied 0001 0002 --linked`. Do not rerun migration 0001 against existing tables, and do not reset production.
3. Rehearse `20260906234641_atomic_team_snapshots.sql` against a staging copy, including existing teams and legacy null values. Verify each populated legacy team received one snapshot, anonymous RPC execution is denied, authenticated nonmembers cannot access it, and stale revisions fail.
4. Apply the new migration and deploy this frontend together. The migration retains `team_data` but revokes client writes. Old cached builds must be refreshed; their pending local data should be exported before refresh when possible. The new build preserves divergent local data and surfaces a conflict. Do not restore legacy write privileges as a quick rollback: two independent stores would fork.
5. Set frontend `VITE_APP_URL` to the exact canonical HTTPS app root. In Supabase Auth URL Configuration set Site URL to that same root and add the exact root to allowed Redirect URLs. Add explicit preview origins only when needed. Signup, resend and reset now request that root explicitly. The root is served by the app and requires no `/auth/callback` route.
6. Complete a real signup, resend and password-reset email round trip in staging and then production, including a different device. Live Auth URL configuration was not exposed by the connected tools, so the actual currently configured destination could not be verified or changed here. Previously generated links retain their old destination; issue a new email after configuration changes.
7. Inspect the new build ID on both devices, test offline edit/reconnect, deliberate two-device conflict, account switching, failed team switching, team-scoped clear, and game completion. Existing installed PWAs must receive this first update before they can display its update banner.

Generic email branding is a Supabase Auth template/SMTP configuration change. It was Low severity and is not part of the High/Medium code remediation. Neither email templates nor production Auth configuration were modified by this branch.

## Verification and limitations

Run `npm ci`, `npm test`, `npm run build`, then install the matching Playwright Chromium and run `E2E_START_SERVER=1 npm run test:e2e`. `CHROMIUM_PATH` can point to an existing compatible Chromium binary. CI runs the same suites.

Tests include production browser flows on desktop/mobile, an isolated PostgreSQL engine applying all migration files, RPC permissions/CAS/idempotency, sync-service race and failure cases, all supported Pitch Smart age-band rest boundaries, pitch corrections and zero-out appearances. PostgreSQL tests use PGlite; they do not claim to test hosted Supabase Auth, network loss during a real database commit, or two separate live Postgres connections. Production rollout and real emailed-link smoke tests remain release gates.

## Architecture decisions

The solver remains a pure domain function over typed `SolveParams`. UI and storage do not belong in a future natural-language translator. Such a translator should produce validated structured constraints, show them for coach approval, and call the same solver. It must never generate database writes or bypass pitching safety checks. No LLM integration is included.

Whole-team snapshot CAS is conservative and beta-sized. Before assistant-coach simultaneous editing becomes a product promise, choose game-level commands/events and explicit conflict resolution with immutable player/team identities. Additions to cross-team player identity must not weaken team data isolation; the current outside-workload entry is explicit and team scoped. Keep rule-version snapshots and sources when extending pitching history.
