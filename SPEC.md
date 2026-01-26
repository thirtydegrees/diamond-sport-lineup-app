# Youth Baseball Lineup - Feature Specification

## Overview

A mobile-first web app for youth baseball coaches to generate and manage defensive lineups during rec league games. Optimized for landscape phone use in the dugout, with print support for clipboard lineup cards.

---

## Data Architecture

### Persistent Data (carries across games)

#### Roster
Each player record contains:
- `id`: unique identifier
- `name`: display name (e.g., "Joe B.")
- `canPitch`: boolean - hard eligibility, can they pitch at all?
- `prefersPitching`: boolean - are they a primary pitcher (vs emergency/backup)?
- `canCatch`: boolean - hard eligibility, can they catch?
- `positions`: object mapping each position to tier
  - `P`, `C`, `1B`, `2B`, `3B`, `SS`, `LF`, `CF`, `RF`
  - Values: `"preferred"` | `"canPlay"` | `"avoid"`
- `preferredOrder`: array of up to 3 positions in preference order (subset of positions marked "preferred")

#### Pitch History
Each record contains:
- `id`: unique identifier
- `playerId`: reference to player
- `gameId`: reference to game
- `date`: game date
- `pitches`: total pitches thrown that game
- `innings`: object mapping inning number to pitches thrown that inning

#### Settings
- `maxConsecutiveSits`: 1, 2, or 3 (default: 2)
- `innings`: default innings per game (5, 6, or 7; default: 7)
- `pitchRules`: pitch count thresholds and rest requirements
  - `breakpoints`: array of { maxPitches, restDays }
  - `absoluteMax`: maximum pitches allowed per game
  - `absoluteMaxRest`: rest days required at max
- `darkMode`: boolean

#### Default Batting Order
- Optional saved template of player IDs in preferred batting order
- Can be set/updated in Settings

#### Game History
- Array of completed game records for reference

---

### Per-Game Data

#### Game
- `id`: unique identifier
- `date`: game date
- `opponent`: optional team name
- `innings`: number of innings for this game
- `battingOrder`: array of player IDs (available players only, in batting order)
- `availability`: object mapping player ID to boolean (false = unavailable for this game)
- `pitcherAssignments`: object mapping inning number to player ID
- `lockedCells`: object mapping "playerId-inning" to position (hard constraints)
- `lineup`: object mapping "playerId-inning" to position (the solution)
- `score`: { us: { inning: runs }, them: { inning: runs } }
- `pitchLog`: object mapping playerId to { inning: pitchCount }
- `currentInning`: current inning number (1-based)
- `exitedPlayers`: object mapping playerId to inning they exited

---

## Screens & Workflows

### 1. Roster Management

**Purpose:** Add, edit, delete players. Set abilities and position preferences.

**Features:**
- List all players with summary info (name, pitcher/catcher badges, preferred positions)
- "Add Player" button opens editor modal
- Tap player row to edit
- Delete button with confirmation
- "Load Demo" button to populate sample 12-player roster

**Player Editor Modal:**
- Name input
- Checkboxes: Can Pitch, Primary Pitcher (only if Can Pitch), Can Catch
- Position grid (3x3 for 9 positions)
  - Tap to cycle: Can Play → Preferred → Avoid → Can Play
  - Positions marked Preferred show rank number (#1, #2, #3) based on selection order
  - P grayed out if !canPitch, C grayed out if !canCatch
- Save / Cancel buttons

---

### 2. Settings

**Features:**
- Dark Mode toggle
- Default Innings dropdown (5, 6, 7) - this sets the starting default for new games
- Max Consecutive Sits dropdown (1, 2, 3) with descriptions:
  - 1: "More rotation"
  - 2: "Balanced"
  - 3: "Less rotation"
- Pitch Count Rules editor:
  - Editable breakpoint table (up to pitches → rest days)
  - Absolute max pitches per game
  - Rest days at absolute max
- Default Batting Order:
  - Button to "Set from current roster"
  - Shows current default order if set
  - Clear button
- Clear All Data button (with confirmation)

---

### 3. Game Setup (Start New Game)

**Entry Options:**
When starting a new game, prompt with three options:
1. "Use default lineup" - loads saved default batting order
2. "Use last game's lineup" - loads previous game's batting order
3. "Start blank" - all available players in roster order

**Game Info Section:**
- Date picker (defaults to today, fully editable for prep night-before or logging past games)
- Opponent name input (optional)
- Innings selector (defaults from Settings, can adjust for this game)

**Batting Order & Availability Section:**
- List of all roster players
- Checkbox to mark available/unavailable
- **Unavailable players automatically sort to bottom of list**
- Drag handle on available players to reorder
- Shows batting order number for available players
- For pitchers: shows eligibility status based on rest rules
  - "Eligible" (green) or "X days rest needed" (red)

**Validation:**
- Must have 9+ available players to continue
- Show error message if fewer than 9

**Continue Button:**
- Creates game record
- Navigates to Lineup view

---

### 4. Lineup View (Game Day)

#### Header Area (print-friendly)
- Game info: date, opponent
- Only visible in print view

#### Stats Summary
- Players count
- Innings count  
- Max sits (highest sit count among players)
- Sit gap (max sits - min sits)

#### Current Inning Selector
- Row of buttons 1 through N
- Tapping sets current inning (affects re-solve starting point)

#### Pitcher Assignments
- Row of buttons, one per inning
- Shows assigned pitcher name or "+ Assign"
- Tap to open Pitcher Picker modal

**Pitcher Picker Modal:**
- Grouped into "Primary Pitchers" and "Can Pitch if Needed"
- Each row shows player name and eligibility status
- Ineligible players grayed out with reason (e.g., "2 days rest needed")
- Can still see ineligible players but cannot select them
- "Clear" button to remove assignment
- Selecting a pitcher:
  - Updates pitcherAssignments
  - Locks that cell (player-inning) to P
  - Triggers re-solve from that inning

#### Defensive Lineup Grid
- Columns: Player name, Inning 1, Inning 2, ... Inning N
- Rows: Players in batting order
- Each cell shows position abbreviation with color coding:
  - P: red background
  - C: blue background
  - IF (1B, 2B, 3B, SS): green background
  - OF (LF, CF, RF): orange background
  - SIT: gray background
- Locked cells have gold/yellow border indicator
- Exited players:
  - Name has strikethrough
  - Row is grayed out from exit inning onward
  - Batting order number shows "-"

**Cell Tap Actions (opens modal):**
- Shows current position and lock status
- Options:
  - 🔒 Lock / 🔓 Unlock position
  - ⚾ Pitch Counter (only if position is P)
  - 📍 Change Position
  - ❌ Mark Exited (red/danger styling)

#### Score Tracker
- Two rows: "Us" and "Them"
- Cells for each inning + total
- Tap cell to edit with +/- stepper
- Prints as blank boxes

#### Action Buttons
- "Re-solve from Inning X" - regenerates from current inning
- "Regenerate All" - regenerates from inning 1
- "Add Inning" - extends game by one inning, adds column to grid, re-solves for new inning
- "Save Game" - saves to game history
- "Print" - opens print dialog
- "Back to Setup" - returns to game setup

---

### Player Count Considerations

- **No hard limit** on roster size or available players
- With 9 fielding positions, excess players must sit each inning
- **14+ players warning**: If more than 14 players available, show note explaining sit rule implications (with 15 players, 6 sit per inning; balancing becomes difficult)
- Solver handles any count, but coach should understand tradeoffs
- Can override sit rules in Settings if needed for large roster games

---

### 5. Position Change Flow (Manual Swap)

When user taps a cell and selects "Change Position":

**Position Selector Modal:**
- 3x3 grid of positions + SIT option
- Positions colored by tier (preferred/canPlay/avoid)
- Avoided positions shown but grayed out / disabled
- Selecting a position:

**If new position is occupied by another player:**
Show Displacement Resolution Modal:
```
"Moving Sam to 1B will displace Joe."

[Auto-assign Joe] - Solver picks best spot
[Choose for Joe]  - Opens position picker for Joe
[Cancel]          - Abort the change
```

**If "Auto-assign Joe" triggers further displacement:**
Show Changes Summary:
```
"Changes made:
• Sam → 1B (your choice)
• Joe → 2B (was 1B)  
• Ryan → RF (was 2B)

[Accept] [Undo]"
```

**After any position change:**
- Lock the manually changed cell
- Update pitcher assignments if P changed
- Show summary of what changed

---

### 6. Avoid Position Override Flow

When solver cannot create a valid lineup without using an avoided position:

**Override Prompt Modal:**
```
"Cannot create lineup without using avoided positions.

Options:
• Sam R. at Catcher (marked Avoid)
• Joe B. at Pitcher (marked Avoid)

Select one to allow for this game, or go back and adjust player availability."

[Select Sam at C]
[Select Joe at P]
[Cancel]
```

- Selecting an option marks that specific assignment as allowed for this game only
- Does not change the player's permanent position settings
- Solver continues with the override
- Override is visually indicated in the lineup (perhaps different border color?)

---

### 7. Player Exit Flow

When user taps a cell and selects "Mark Exited":

**Exit Confirmation Modal:**
```
"Mark [Player Name] as exited from inning [X]?

Their batting slot will be skipped. Previous innings stay as-is."

[Re-solve Lineup] - Auto-adjust remaining innings
[Manual Adjust]   - I'll reassign positions myself
[Cancel]
```

**After confirming:**
- Add player to exitedPlayers with exit inning
- Clear their assignments from exit inning onward
- Clear any locks for their future innings
- Clear pitcher assignments if they were pitching
- If "Re-solve": run solver from exit inning
- Player's row shows:
  - Strikethrough on name
  - "-" for batting order number
  - Grayed cells from exit inning onward

---

### 8. Pitch Counter

**Access:** Tap the "P" cell for current inning's pitcher, select "Pitch Counter"

**Pitch Counter Modal:**
- Pitcher name prominently displayed
- Large total pitch count (e.g., "47")
- Smaller "this inning" count (e.g., "12 this inning")
- **Large +1 button** (primary action, easy to tap quickly)
- **Smaller -1 button** (for corrections)
- "End Inning" button:
  - Saves pitch data to history
  - Closes modal
- X to close without ending inning (keeps counting)

**Data tracking:**
- pitchLog stored per player per inning within game
- On "End Inning", record is saved/updated in pitchHistory

---

### 9. Pitcher Summary View

**Purpose:** Quick view of all pitchers' status and history

**Features:**
- List all players where canPitch = true
- Each row shows:
  - Player name
  - "Primary" badge if prefersPitching
  - Eligibility status: "Eligible" (green) or "X days rest" (red)
  - Total pitches (season/all-time)
  - Games pitched count
- Tap row to see game-by-game breakdown (future enhancement)

---

### 10. Game History View

**Purpose:** Review past games

**Features:**
- List of saved games, sorted by date (newest first)
- Each row shows:
  - Opponent name (or "Game" if none)
  - Date
  - Final score (Us - Them)
  - W/L/T indicator
- Tap to view game details (future enhancement: show that game's lineup)

---

## Solver Rules & Constraints

### Constraint Hierarchy

#### Hard Constraints (must satisfy or report infeasible)
1. Exactly 9 field positions filled per inning
2. `canPitch = false` → cannot play P
3. `canCatch = false` → cannot play C
4. No P↔C in consecutive innings (safety rule)
5. Pitching stints must be contiguous (one stint per game)
6. Positions marked "avoid" cannot be assigned (unless explicitly overridden)
7. Locked cells must be honored
8. Pitcher rest eligibility (cannot pitch if insufficient rest)

#### Soft Constraints (optimize, in priority order)
1. **Max consecutive sits**: No player sits more than configured max in a row
2. **Sit balance**: Minimize (maxSits - minSits) across players
3. **Minimize disruption**: Prefer keeping same position; same-group changes < cross-group changes < battery changes
4. **Position preferences**: Prefer "preferred" over "canPlay"; honor preference ranking (1st > 2nd > 3rd)

### Position Groups (for disruption scoring)
- Battery: P, C
- Infield: 1B, 2B, 3B, SS
- Outfield: LF, CF, RF

### Disruption Penalties
- No change: 0
- Same group (IF→IF, OF→OF): small
- Cross group (IF↔OF): medium
- Battery involved: large

### Infeasibility Handling
When solver cannot find valid solution:
1. Check if avoid constraint is the blocker → show override prompt
2. Otherwise show error with specific conflicts listed
3. Offer partial solution if available

---

## UI/UX Requirements

### Design Language
- Modern iOS / Notion style: minimal, clean, crisp
- High contrast (readable in sunlight)
- Large touch targets (minimum 44px)
- Optimized for landscape phone use

### Typography
- System fonts (-apple-system, SF Pro)
- Position abbreviations: bold, fill the cell
- Clear hierarchy: titles > body > secondary text

### Color System
Light mode:
- Background: #F5F5F7 (secondary), #FFFFFF (cards)
- Text: #1D1D1F (primary), #86868B (secondary)
- Accent: #007AFF (blue)
- Success: #34C759 (green)
- Warning: #FF9500 (orange)
- Danger: #FF3B30 (red)

Dark mode:
- Background: #1C1C1E, #2C2C2E
- Text: #FFFFFF, #98989D
- Same accent colors

Position colors (subtle backgrounds):
- P: light red
- C: light blue
- IF: light green
- OF: light orange/yellow
- SIT: light gray

### Print Stylesheet
- **Force landscape orientation** via @page CSS rule
- Hide navigation, buttons, interactive elements
- Show header with date/opponent
- Clean grid layout with visible cell borders
- **Score boxes print with visible gridlines** (borders on each inning cell)
- Score cells print empty (for manual entry)
- Optimize for standard letter paper size

---

## Demo Roster

12 players with varied capabilities:

| # | Name | Can Pitch | Primary P | Can Catch | Preferred Positions |
|---|------|-----------|-----------|-----------|---------------------|
| 1 | Joe B. | ✓ | ✓ | ✓ | C, SS, 3B |
| 2 | Max C. | ✓ | ✓ | | P, 1B, LF |
| 3 | Liam D. | ✓ | | ✓ | C, 2B, CF |
| 4 | Noah F. | | | | RF, LF, 1B |
| 5 | Owen G. | ✓ | ✓ | | SS, 3B, CF |
| 6 | Jack H. | ✓ | ✓ | | P, SS, 2B |
| 7 | Aiden J. | | | | LF, RF, 1B |
| 8 | Ben K. | ✓ | | ✓ | C, 1B, RF |
| 9 | Caleb L. | | | | CF, LF, 2B |
| 10 | Ethan M. | ✓ | ✓ | | 3B, SS, P |
| 11 | Ryan P. | | | | 2B, RF, CF |
| 12 | Sam R. | ✓ | | | 1B, LF, 3B |

**Summary:** 8 can pitch (5 primary), 3 can catch, varied position preferences

---

## File Structure (Option A)

```
/youth-baseball-lineup/
  index.html              # Shell, script imports
  css/
    styles.css            # All styles, CSS variables, print styles
  js/
    constants.js          # Position lists, default settings, demo roster
    storage.js            # localStorage abstraction (future: API adapter)
    solver.js             # Lineup generation algorithm
    components.js         # Reusable UI pieces (Modal, Toggle, Stepper, etc.)
    modals.js             # Feature modals (PlayerEditor, PitcherPicker, PitchCounter, etc.)
    LineupGrid.js         # Main lineup grid component (complex, own file)
    views.js              # Screen components (Roster, Settings, GameSetup, Lineup, Pitchers, History)
    app.js                # Main app shell, routing, context/state
```

**~10 files total.** Can split further if any file exceeds ~300 lines.

**Dependency order (build sequence):**
1. `styles.css` - no dependencies
2. `constants.js` - no dependencies
3. `storage.js` - depends on constants
4. `solver.js` - depends on constants
5. `components.js` - no dependencies (just React)
6. `modals.js` - depends on components
7. `LineupGrid.js` - depends on components, solver
8. `views.js` - depends on components, modals, LineupGrid, storage
9. `app.js` - depends on views, storage
10. `index.html` - loads all scripts in order

---

## Future Enhancements (Out of Scope for MVP)

- User accounts / authentication
- Cloud sync across devices
- Season-level statistics
- Team sharing (multiple coaches)
- Push notifications for rest eligibility
- Game Changer integration
- Full at-bat / play-by-play tracking

---

## Revision History

- v1.0 - Initial spec based on requirements document and conversation refinements
