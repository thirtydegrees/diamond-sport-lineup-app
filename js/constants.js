/* ============================================
   Youth Baseball Lineup - Constants
   ============================================ */

// Position definitions
const POSITIONS = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'];

const POSITION_GROUPS = {
  BATTERY: ['P', 'C'],
  INFIELD: ['1B', '2B', '3B', 'SS'],
  OUTFIELD: ['LF', 'CF', 'RF']
};

// Position tier values for player preferences
const POSITION_TIERS = {
  PREFERRED: 'preferred',
  CAN_PLAY: 'canPlay',
  AVOID: 'avoid'
};

// Get the group a position belongs to
function getPositionGroup(pos) {
  if (POSITION_GROUPS.BATTERY.includes(pos)) return 'battery';
  if (POSITION_GROUPS.INFIELD.includes(pos)) return 'infield';
  if (POSITION_GROUPS.OUTFIELD.includes(pos)) return 'outfield';
  return 'sit';
}

// Get color class for position display
function getPositionColorClass(pos) {
  if (pos === 'P') return 'P';
  if (pos === 'C') return 'C';
  if (POSITION_GROUPS.INFIELD.includes(pos)) return 'IF';
  if (POSITION_GROUPS.OUTFIELD.includes(pos)) return 'OF';
  return 'SIT';
}

// Default application settings
const DEFAULT_SETTINGS = {
  // Game defaults
  innings: 6,
  maxSitsPerGame: 2,
  
  // Pitch count rules
  pitchRules: {
    breakpoints: [
      { maxPitches: 20, restDays: 0 },
      { maxPitches: 35, restDays: 1 },
      { maxPitches: 50, restDays: 2 },
      { maxPitches: 65, restDays: 3 }
    ],
    absoluteMax: 85,
    absoluteMaxRest: 4
  },
  
  // Display
  darkMode: false
};

// Demo roster for testing
const DEMO_ROSTER = [
  {
    id: '1',
    name: 'Joe B.',
    canPitch: true,
    prefersPitching: true,
    canCatch: true,
    positions: {
      P: POSITION_TIERS.CAN_PLAY,
      C: POSITION_TIERS.PREFERRED,
      '1B': POSITION_TIERS.CAN_PLAY,
      '2B': POSITION_TIERS.CAN_PLAY,
      '3B': POSITION_TIERS.PREFERRED,
      SS: POSITION_TIERS.PREFERRED,
      LF: POSITION_TIERS.CAN_PLAY,
      CF: POSITION_TIERS.CAN_PLAY,
      RF: POSITION_TIERS.CAN_PLAY
    },
    preferredOrder: ['C', 'SS', '3B']
  },
  {
    id: '2',
    name: 'Max C.',
    canPitch: true,
    prefersPitching: true,
    canCatch: false,
    positions: {
      P: POSITION_TIERS.PREFERRED,
      C: POSITION_TIERS.AVOID,
      '1B': POSITION_TIERS.PREFERRED,
      '2B': POSITION_TIERS.CAN_PLAY,
      '3B': POSITION_TIERS.CAN_PLAY,
      SS: POSITION_TIERS.CAN_PLAY,
      LF: POSITION_TIERS.PREFERRED,
      CF: POSITION_TIERS.CAN_PLAY,
      RF: POSITION_TIERS.CAN_PLAY
    },
    preferredOrder: ['P', '1B', 'LF']
  },
  {
    id: '3',
    name: 'Liam D.',
    canPitch: true,
    prefersPitching: false,
    canCatch: true,
    positions: {
      P: POSITION_TIERS.CAN_PLAY,
      C: POSITION_TIERS.PREFERRED,
      '1B': POSITION_TIERS.CAN_PLAY,
      '2B': POSITION_TIERS.PREFERRED,
      '3B': POSITION_TIERS.CAN_PLAY,
      SS: POSITION_TIERS.CAN_PLAY,
      LF: POSITION_TIERS.CAN_PLAY,
      CF: POSITION_TIERS.PREFERRED,
      RF: POSITION_TIERS.CAN_PLAY
    },
    preferredOrder: ['C', '2B', 'CF']
  },
  {
    id: '4',
    name: 'Noah F.',
    canPitch: false,
    prefersPitching: false,
    canCatch: false,
    positions: {
      P: POSITION_TIERS.AVOID,
      C: POSITION_TIERS.AVOID,
      '1B': POSITION_TIERS.PREFERRED,
      '2B': POSITION_TIERS.CAN_PLAY,
      '3B': POSITION_TIERS.CAN_PLAY,
      SS: POSITION_TIERS.CAN_PLAY,
      LF: POSITION_TIERS.PREFERRED,
      CF: POSITION_TIERS.CAN_PLAY,
      RF: POSITION_TIERS.PREFERRED
    },
    preferredOrder: ['RF', 'LF', '1B']
  },
  {
    id: '5',
    name: 'Owen G.',
    canPitch: true,
    prefersPitching: true,
    canCatch: false,
    positions: {
      P: POSITION_TIERS.CAN_PLAY,
      C: POSITION_TIERS.AVOID,
      '1B': POSITION_TIERS.CAN_PLAY,
      '2B': POSITION_TIERS.CAN_PLAY,
      '3B': POSITION_TIERS.PREFERRED,
      SS: POSITION_TIERS.PREFERRED,
      LF: POSITION_TIERS.CAN_PLAY,
      CF: POSITION_TIERS.PREFERRED,
      RF: POSITION_TIERS.CAN_PLAY
    },
    preferredOrder: ['SS', '3B', 'CF']
  },
  {
    id: '6',
    name: 'Jack H.',
    canPitch: true,
    prefersPitching: true,
    canCatch: false,
    positions: {
      P: POSITION_TIERS.PREFERRED,
      C: POSITION_TIERS.AVOID,
      '1B': POSITION_TIERS.CAN_PLAY,
      '2B': POSITION_TIERS.PREFERRED,
      '3B': POSITION_TIERS.CAN_PLAY,
      SS: POSITION_TIERS.PREFERRED,
      LF: POSITION_TIERS.CAN_PLAY,
      CF: POSITION_TIERS.CAN_PLAY,
      RF: POSITION_TIERS.CAN_PLAY
    },
    preferredOrder: ['P', 'SS', '2B']
  },
  {
    id: '7',
    name: 'Aiden J.',
    canPitch: false,
    prefersPitching: false,
    canCatch: false,
    positions: {
      P: POSITION_TIERS.AVOID,
      C: POSITION_TIERS.AVOID,
      '1B': POSITION_TIERS.PREFERRED,
      '2B': POSITION_TIERS.CAN_PLAY,
      '3B': POSITION_TIERS.CAN_PLAY,
      SS: POSITION_TIERS.CAN_PLAY,
      LF: POSITION_TIERS.PREFERRED,
      CF: POSITION_TIERS.CAN_PLAY,
      RF: POSITION_TIERS.PREFERRED
    },
    preferredOrder: ['LF', 'RF', '1B']
  },
  {
    id: '8',
    name: 'Ben K.',
    canPitch: true,
    prefersPitching: false,
    canCatch: true,
    positions: {
      P: POSITION_TIERS.CAN_PLAY,
      C: POSITION_TIERS.PREFERRED,
      '1B': POSITION_TIERS.PREFERRED,
      '2B': POSITION_TIERS.CAN_PLAY,
      '3B': POSITION_TIERS.CAN_PLAY,
      SS: POSITION_TIERS.CAN_PLAY,
      LF: POSITION_TIERS.CAN_PLAY,
      CF: POSITION_TIERS.CAN_PLAY,
      RF: POSITION_TIERS.PREFERRED
    },
    preferredOrder: ['C', '1B', 'RF']
  },
  {
    id: '9',
    name: 'Caleb L.',
    canPitch: false,
    prefersPitching: false,
    canCatch: false,
    positions: {
      P: POSITION_TIERS.AVOID,
      C: POSITION_TIERS.AVOID,
      '1B': POSITION_TIERS.CAN_PLAY,
      '2B': POSITION_TIERS.PREFERRED,
      '3B': POSITION_TIERS.CAN_PLAY,
      SS: POSITION_TIERS.CAN_PLAY,
      LF: POSITION_TIERS.PREFERRED,
      CF: POSITION_TIERS.PREFERRED,
      RF: POSITION_TIERS.CAN_PLAY
    },
    preferredOrder: ['CF', 'LF', '2B']
  },
  {
    id: '10',
    name: 'Ethan M.',
    canPitch: true,
    prefersPitching: true,
    canCatch: false,
    positions: {
      P: POSITION_TIERS.PREFERRED,
      C: POSITION_TIERS.AVOID,
      '1B': POSITION_TIERS.CAN_PLAY,
      '2B': POSITION_TIERS.CAN_PLAY,
      '3B': POSITION_TIERS.PREFERRED,
      SS: POSITION_TIERS.PREFERRED,
      LF: POSITION_TIERS.CAN_PLAY,
      CF: POSITION_TIERS.CAN_PLAY,
      RF: POSITION_TIERS.CAN_PLAY
    },
    preferredOrder: ['3B', 'SS', 'P']
  },
  {
    id: '11',
    name: 'Ryan P.',
    canPitch: false,
    prefersPitching: false,
    canCatch: false,
    positions: {
      P: POSITION_TIERS.AVOID,
      C: POSITION_TIERS.AVOID,
      '1B': POSITION_TIERS.CAN_PLAY,
      '2B': POSITION_TIERS.PREFERRED,
      '3B': POSITION_TIERS.CAN_PLAY,
      SS: POSITION_TIERS.CAN_PLAY,
      LF: POSITION_TIERS.CAN_PLAY,
      CF: POSITION_TIERS.PREFERRED,
      RF: POSITION_TIERS.PREFERRED
    },
    preferredOrder: ['2B', 'RF', 'CF']
  },
  {
    id: '12',
    name: 'Sam R.',
    canPitch: true,
    prefersPitching: false,
    canCatch: false,
    positions: {
      P: POSITION_TIERS.CAN_PLAY,
      C: POSITION_TIERS.AVOID,
      '1B': POSITION_TIERS.PREFERRED,
      '2B': POSITION_TIERS.CAN_PLAY,
      '3B': POSITION_TIERS.PREFERRED,
      SS: POSITION_TIERS.CAN_PLAY,
      LF: POSITION_TIERS.PREFERRED,
      CF: POSITION_TIERS.CAN_PLAY,
      RF: POSITION_TIERS.CAN_PLAY
    },
    preferredOrder: ['1B', 'LF', '3B']
  }
];

// Create a blank player template
function createBlankPlayer() {
  const positions = {};
  POSITIONS.forEach(pos => {
    positions[pos] = POSITION_TIERS.CAN_PLAY;
  });
  
  return {
    id: Date.now().toString(),
    name: '',
    canPitch: false,
    prefersPitching: false,
    canCatch: false,
    positions,
    preferredOrder: []
  };
}

// Create a blank game template
function createBlankGame(settings) {
  return {
    id: Date.now().toString(),
    date: new Date().toISOString().split('T')[0],
    opponent: '',
    innings: settings?.innings || DEFAULT_SETTINGS.innings,
    battingOrder: [],
    availability: {},
    pitcherAssignments: {},
    lockedCells: {},
    lineup: {},
    score: { us: {}, them: {} },
    pitchLog: {},
    currentInning: 1,
    exitedPlayers: {}
  };
}
