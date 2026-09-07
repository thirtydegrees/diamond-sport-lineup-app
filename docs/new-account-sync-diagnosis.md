# New-account sync and verification diagnosis

Branch: `fix/shakedown-stabilization`. No merge, push, deployment, or production database mutation in this investigation.

## Root cause of the reported error

**High, release blocker: legacy frontend against the migrated database.** The screenshot includes `permission denied for table team_data`. The pre-migration client at commit `20f2276`, `src/services/sync.ts:425–433`, upserts that table. Its catch at lines 446–450 reduces a Supabase error object to the generic `Push failed` message and retains dirty keys for retry. This exactly explains why Sync Now repeatedly fails.

Migration `supabase/migrations/20260906234641_atomic_team_snapshots.sql:76` intentionally revokes authenticated legacy writes. Production read-only verification confirmed legacy writes are false, snapshot reads are available, and authenticated execution of `save_team_snapshot` is allowed. A fresh HTTP fetch of the public app served `/assets/index-B0Sl6GnF.js`, containing the snapshot RPC and build `f8057dc`, with no `team_data` reference.

The frontend/database mismatch is established. A stale PWA/browser build is the likely delivery cause; the screenshot alone cannot exclude an older deployment URL. This is not evidence that the new provisioning RPC needs broader permissions. Restoring legacy writes would create two divergent stores and is not a safe fix.

**Recovery for the affected device:** export its local backup first, close all open app tabs and the installed app, then open the canonical production URL and perform a full reload. Do not clear site data or restore a backup into another account. If unsynced data differs from the cloud snapshot, preserve the backup and resolve the explicit conflict. Existing older installed clients cannot gain the new update banner until they receive a new build. Before external beta, exercise this first upgrade on the actual Safari/PWA installation.

The old client's account adoption (`20f2276`, `src/services/sync.ts:256–261`) removed local keys before loading the new account. Therefore, it is not possible to promise that earlier unsynced edits discarded through that old flow still exist. The current snapshot client archives before replacement. Previously saved cloud data remains separate; do not use the generic screenshot wording as proof that every historical local edit was retained.

## Current first-login and first-write trace

| Stage | Code | Behavior |
|---|---|---|
| Verification/session | `src/services/supabaseClient.ts`; `src/state/AppContext.jsx:131–169` | Supabase processes the callback and emits the session. A changed user invalidates previous sync operations before initializing the new identity. A late completion is checked against the active session. |
| Local ownership | `src/state/AppContext.jsx:100–120`; `src/services/sync.ts:347–364` | A different local owner enters a blocking account transition. Same-owner login selects its existing team rather than silently reverting to the personal team. |
| First team | `src/services/sync.ts:365–373`; snapshot migration lines 82–98 | An account with no visible personal team calls `get_or_create_personal_team()`. The SQL binds ownership to `auth.uid()`; the unique personal-team index handles concurrent provisioning. |
| Membership/RLS | `supabase/migrations/0001_init.sql:41–65,90–105`; snapshot migration lines 10–14,27–32 | The team-insert trigger creates owner membership. RLS scopes visible teams/snapshots. The write RPC authenticates and checks membership after locking the team row. |
| Initial hydration | `src/services/sync.ts:374–413,321–345,546–574` | A snapshot is validated before adoption. A new team's missing snapshot is normal. Fresh unowned local data is bound and marked pending for initial save. Explicit cross-account adoption starts from the new account's data/defaults, retaining an owner-bound recovery copy first; its empty snapshot is created on the first local edit. |
| Local persistence | `src/state/AppContext.jsx:55–72`; `src/services/sync.ts:151–170` | Data and dirty metadata are written atomically before React is updated. Local changes do not depend on a successful cloud request. |
| First cloud write | `src/services/sync.ts:458–494`; snapshot migration lines 23–54 | The RPC gets `expected_revision: null`, a validated full-team snapshot, and a locally persisted request UUID. No row plus expected null produces revision 1. The next save expects 1 and produces 2. |
| CAS/conflicts | snapshot migration lines 39–50 | Same latest request ID is idempotent. A stale expected revision raises `40001`; the client preserves local changes and asks for conflict resolution. |
| Failed first push | `src/services/sync.ts:413–420,463–481,498–518` | Local roster/game/settings, owner/team marker, dirty flag, local revision, and request UUID remain. Revision stays null until acknowledged. Initial failure leaves sync unready; Sync Now reinitializes. Later push failures retry without discarding local data. |

## Deterministic account transition implemented

1. The verified callback determines which account is authenticated. Stop the previous account's sync immediately.
2. If local data belongs to another account, block the workspace and explicitly show the new account email and the previous team's name. Do not describe the action as using or merging existing data.
3. **Open This Account** validates/provisions the destination and archives the previous owner's local state before adoption. Failure keeps the same transition screen and original data, with a retryable error.
4. **Sign Out** signs out the newly authenticated session on this device and returns to sign-in, retaining the previous saved data. It explicitly does not restore the previous login.
5. Escape or clicking outside the transition cannot silently choose an account action. Controls are disabled while a transition is running.

The local stabilization branch also contained an update-notice cleanup regression introduced during removal of the visible build label: an early null return bypassed timer/listener cleanup. This investigation removes that early return. It was not the cause of the legacy-table screenshot error and was not deployed.

## Regression evidence

- **217 tests pass**, including a new test in `src/services/database.test.ts` using the real SyncService against the actual migration SQL in PGlite. It inserts a brand-new auth user, assumes the authenticated role/UID, proves zero visible teams and snapshots, provisions membership, fails the first transport write, checks retained local data/request identity, retries to revision 1, edits to revision 2, rejects stale CAS, and rejects direct legacy writes.
- This is a genuinely unprovisioned authenticated database state, not an existing team with a cleared browser cache. PGlite's auth schema/UID and transport are adapters; it is not a hosted Supabase signup or an email-delivery test.
- The desktop/mobile browser suite passes, including `scripts/verification-e2e.mjs`: actual Supabase client callback/session handling with intercepted Auth/database responses; previous account with dirty data; verification into a new account with no team/snapshot; Sign Out; retry after provisioning failure; owner-bound recovery copy; first-write failure/retry; and no cross-account upload.
- Production TypeScript/Vite/PWA build passes. No migration or RPC permission change was necessary.

## Verification limit

Automatic approval review blocked the targeted read-only lookup of verification status, personal-team count, owner membership, and snapshot existence for the email in the screenshot, saying explicit authorization was required for that account. No account-specific query result was obtained. Schema/privilege checks and public frontend verification succeeded. Confirming that specific hosted account's provisioning metadata remains outstanding; no team payloads need to be read for that check.
