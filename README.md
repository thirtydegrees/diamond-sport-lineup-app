# Diamond Lineup ⚾🥎

A lineup-management tool for youth baseball and softball coaches in
development-oriented leagues. Built for the volunteer parent-coach who gets off
work at 5pm with a 6:30 game: set a fair lineup fast, manage pitch counts and
rest rules, keep bench time balanced, and adjust on the fly from a phone in the
dugout.

**Deliberately not** a stat-tracking / play-by-play app (that's GameChanger's
territory). This is lineup logistics only.

## Development

```bash
npm install
npm run dev        # local dev server
npm test           # unit tests (solver, eligibility, dates)
npm run build      # type-check + production build to dist/
npm run preview    # serve the production build locally
npm run test:e2e   # browser E2E suite (build + preview on :4173 first;
                   # set CHROMIUM_PATH if chromium isn't at /opt/pw-browsers)
```

The app is an installable PWA: coaches can add it to their phone's home
screen and it works offline in the dugout (all assets are precached by a
service worker; data lives locally until cloud sync arrives in Phase 2).
Settings → Backup & Restore downloads the whole season as a JSON file and
restores it on another device — the manual laptop↔phone bridge until sync.

CI (GitHub Actions) runs the type-check, build, unit tests, and the full
browser E2E suite on every push.

## Cloud sync setup (one time)

The app is local-first and fully usable without an account. Sync uses
Supabase (Settings → Account & Sync):

1. **Create the database schema**: in the Supabase dashboard open
   *SQL Editor → New query*, paste the contents of
   `supabase/migrations/0001_init.sql`, and click **Run**. This creates the
   `teams` / `team_members` / `team_data` tables with row-level security so
   each account can only read its own team's data.
2. **(Recommended for beta)** *Authentication → Sign In / Providers → Email*:
   turn **off** "Confirm email" so coaches can sign in immediately after
   creating an account.
3. The app ships with the project URL and publishable key baked in (safe:
   access control is enforced server-side by RLS). To point at a different
   Supabase project, set `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_PUBLISHABLE_KEY` at build time.

Sync model: last-write-wins per storage key. An empty account is seeded by
the first device that signs in; a device signing in for the first time
adopts the account's data; after that, whichever side changed most recently
wins. Changes push automatically (debounced) and every app launch pulls.

## Deploying (Vercel)

Import the GitHub repo in Vercel; it auto-detects Vite (build
`npm run build`, output `dist/`). No environment variables are required.
Vercel deploys the repo's production branch (`main`) on every push.

## Architecture

```
src/
  domain/          # Pure, tested TypeScript domain logic
    types.ts       #   Shared types (Player, Game, Settings, ...)
    constants.ts   #   Positions, defaults, demo roster
    solver.ts      #   Constraint solver for defensive lineups
    dates.ts       #   Local-calendar-date utilities (see note below)
  services/
    storage.ts     # Persistence layer (localStorage today; designed to be
                   # swapped for an API/sync backend)
  state/           # React context (global app state)
  components/      # Reusable UI + feature modals + lineup grid
  views/           # Screens: Roster, Game Setup, Lineup, Pitchers, History, Settings
```

### Solver rules

Hard constraints: all fielding positions filled per inning (9, or 10 with the
SC short-center in youth softball configurations); pitch/catch eligibility;
no P↔C in consecutive innings and contiguous pitching stints (baseball only —
both relaxed for softball); per-game pitcher innings caps; "avoid" positions
(unless explicitly overridden); locked cells; pitcher assignments.

Soft constraints: total sits per player capped by settings (with per-game
override prompt), sit counts spread evenly, optional fairness rules (max
consecutive sits, everyone plays infield at least once — with warnings when
they can't be met), position preferences honored.

### Pitching rules

League presets (Pitch Smart age bands used by Little League / Cal Ripken /
PONY, plus softball no-limit and innings-based schemes) live in
`src/domain/presets.ts`; editing any value switches to Custom. Three limit
types: pitch-count breakpoints, innings-pitched breakpoints, or none.
Saving a game records innings pitched from the lineup automatically, so
rest tracking works even when the pitch counter isn't used.

### Dates

Game dates are plain `YYYY-MM-DD` strings interpreted in the coach's local
timezone via `src/domain/dates.ts`. Never call `new Date(isoDateString)` on
them directly — JS parses date-only strings as UTC midnight, which displays as
the *previous day* in US timezones.

## Roadmap

- [x] **Phase 0** – Real build tooling (Vite + TypeScript), solver test suite,
      date and re-solve bug fixes
- [x] **Phase 1** – Generalized rules engine: sport config (baseball/softball,
      9 or 10 fielders), league pitch-rule presets + custom rules
      (pitch-count and innings-based), toggleable fairness rules
- [x] **Phase 2** – Accounts + cloud sync (Supabase): local-first with
      debounced push, last-write-wins pull, and a teams/members schema
      ready for assistant-coach sharing
- [x] **Phase 3** – Mobile UX overhaul (bottom tab bar, touch drag-to-reorder,
      sticky lineup columns, bottom-sheet modals, PWA install/offline) +
      print polish
- [x] **Phase 4** – Season analytics (Stats tab): position distribution,
      bench-time equity, pitcher workload with per-outing history and a
      season/30-day/7-day filter; every chart has a table view and the
      palette is CVD-validated in both themes
- [x] **Hardening** – JSON backup/restore, game history detail + delete,
      in-app dialogs and toasts (no native popups), discard-game guardrail,
      crash-safe error boundary, CI pipeline
- [ ] **Phase 5** – Hosted beta on Vercel; payments later
