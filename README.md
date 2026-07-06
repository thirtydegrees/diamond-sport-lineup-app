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
```

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

Hard constraints: 9 positions filled per inning; pitch/catch eligibility;
no P↔C in consecutive innings; contiguous pitching stints; "avoid" positions
(unless explicitly overridden); locked cells; pitcher assignments.

Soft constraints: total sits per player capped by settings (with per-game
override prompt), sit counts spread evenly, position preferences honored.

### Dates

Game dates are plain `YYYY-MM-DD` strings interpreted in the coach's local
timezone via `src/domain/dates.ts`. Never call `new Date(isoDateString)` on
them directly — JS parses date-only strings as UTC midnight, which displays as
the *previous day* in US timezones.

## Roadmap

- [x] **Phase 0** – Real build tooling (Vite + TypeScript), solver test suite,
      date and re-solve bug fixes
- [ ] **Phase 1** – Generalized rules engine: sport config (baseball/softball,
      9 or 10 fielders), league pitch-rule presets + custom rules
      (pitch-count and innings-based), toggleable fairness rules
- [ ] **Phase 2** – Accounts + cloud sync (Supabase): set the lineup on a
      laptop, run the game from a phone; teams/seasons data model ready for
      assistant-coach collaboration
- [ ] **Phase 3** – Mobile UX overhaul + print polish
- [ ] **Phase 4** – Season analytics: position distribution, pitcher workload,
      playing-time equity
- [ ] **Phase 5** – Hosted beta on Vercel; payments later
