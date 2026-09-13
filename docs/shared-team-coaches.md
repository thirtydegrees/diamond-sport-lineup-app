# Shared teams for beta

Branch: `feat/shared-team-coaches`, based on production `ae74b06`.

## Coach workflow

The owner opens Settings > Team access, enters a coach's email, and creates an invitation. The owner shares the normal app URL directly. No invitation email is sent by the application. The recipient signs in or creates and verifies their own account using that email, opens Settings, and selects Join Team. Joining adds membership; it does not switch teams, merge datasets, or upload personal data. The shared team then appears under Your teams, with the existing Switch action. An already-open app can refresh invitations and teams in Settings.

Invitations expire after seven days. The owner can cancel pending invitations and remove coaches. Owner and Coach are the only roles. Coaches can use all normal baseball/team data operations, including renaming the team. Only the owner manages membership. Removal prevents future cloud reads/writes but cannot erase a copy already downloaded to a coach's device.

## Model and safeguards

The existing `teams` / `team_members` / `team_snapshots` relationship was already many-to-many. Snapshots remain keyed by team ID. No team payload is copied per user. Existing snapshot RLS and revision-checked `save_team_snapshot` remain authoritative. Invitations live in a private schema with no direct client table grants; public invoker RPC wrappers call narrowly scoped private functions that validate the caller. Acceptance checks the current verified email in `auth.users`, not user metadata or a client-supplied user ID. Membership edits take the same team-row lock as snapshot writes. Accepted invitations cannot be replayed after removal.

The migration preserves teams and snapshots, repairs creator memberships, limits roles to the canonical owner plus coaches, and revokes direct membership mutation/deletion APIs. Deleting the owner account no longer cascades to team data; administrative ownership reassignment would be required first. There is no ownership-transfer UI in this beta pass.

The client distinguishes a user's own personal team from someone else's shared personal team. First login still atomically provisions the caller's own personal team. Removed-team data is archived before choosing a reachable team. An inaccessible snapshot is an access error, not an empty team. Forged or stale switch targets are revalidated. Unsynced edits and conflicts remain recoverable.

The preexisting client had no Realtime subscription. This pass uses visible-app polling every 15 seconds, plus existing reconnect/focus handling and Sync Now, through the serialized CAS path. It does not introduce websockets, presence or coediting. Clean devices adopt newer snapshots; dirty devices retain their changes and enter conflict handling. This is eventual synchronization, not instant simultaneous editing. Foreground mobile/browser suspension can delay checks until the app resumes.

## Validation

241 unit/database tests and the TypeScript/Vite build passed. The complete desktop/mobile browser suite passed, including a new three-account flow. That flow uses isolated browser sessions, simulated Supabase authentication/HTTP transport, and the actual migration SQL executed under authenticated PostgreSQL roles in PGlite. It covers invitation, acceptance, separate personal-team provisioning, identical shared roster/history/live-game/lineup data, a coach's roster edit automatically reaching the owner, switching back and forth without leakage, outsider denial, and removal followed by denied sync and safe switching.

SQL tests additionally cover role forgery, direct writes, anonymous execution, wrong/unverified email, spoofed user metadata, expiration, cancellation, idempotent acceptance, stale CAS writes, accepted-invitation replay after removal, and owner deletion protection. Client tests cover unavailable snapshots, forged switches and recovery of unsent edits. These are local integration tests, not a claim that hosted Supabase email delivery or real-account sign-in was exercised.

## Release order and remaining checks

Apply `20260912203406_shared_team_coaches.sql` first, then deploy this frontend. The migration is additive for data and compatible with the current snapshot client; old clients will not expose invitation controls. It has not been applied to production as part of implementation. Do not revert the old per-key snapshot write restrictions.

Before inviting beta coaches, verify the hosted path with two real verified accounts after deployment, and rerun Supabase advisors. The read-only production advisor check during implementation reported existing public SECURITY DEFINER functions and leaked-password protection disabled. This migration removes anonymous membership-helper execution and client execution of the team-creation trigger. Existing authenticated provisioning/CAS helpers intentionally remain guarded RPC entry points. The platform-created `rls_auto_enable` trigger warning and project password policy are preexisting, outside this access feature.

Advisor references: [function execution](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
