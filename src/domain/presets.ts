/* ============================================
   Diamond Lineup - League pitch-rule presets

   Starting points for common sanctioning bodies. Most youth
   baseball organizations (Little League, Cal Ripken/Babe Ruth,
   PONY) base their rest requirements on the MLB/USA Baseball
   "Pitch Smart" guidelines, with age-band daily maximums.
   Individual leagues and tournaments frequently modify these -
   presets are a starting point, and any edit switches the
   settings to "Custom".

   Softball generally has no pitch-count limits; some rec
   leagues cap innings pitched per game or require rest by
   innings thrown, so those presets use the innings scheme.
   ============================================ */

import type { PitchRules, Sport } from './types';

export interface PitchRulePreset {
  id: string;
  label: string;
  sport: Sport;
  description: string;
  rules: PitchRules;
}

/** Pitch Smart rest breakpoints shared by the common baseball age bands. */
const PITCH_SMART_BREAKPOINTS = [
  { maxPitches: 20, restDays: 0 },
  { maxPitches: 35, restDays: 1 },
  { maxPitches: 50, restDays: 2 },
  { maxPitches: 65, restDays: 3 }
];

const NO_INNINGS_RULES = {
  inningsBreakpoints: [],
  maxInningsPerGame: null
};

function pitchSmartRules(absoluteMax: number): PitchRules {
  return {
    limitType: 'pitches',
    maxGamesPerDay: 1,
    maxConsecutiveDays: 2,
    maxMoundReturns: absoluteMax >= 95 ? 1 : 0,
    breakpoints: PITCH_SMART_BREAKPOINTS.map(bp => ({ ...bp })),
    absoluteMax,
    absoluteMaxRest: 4,
    ...NO_INNINGS_RULES
  };
}

export const PITCH_RULE_PRESETS: PitchRulePreset[] = [
  {
    id: 'pitch-smart-7-8',
    label: 'Pitch Smart 7-8 (50 max)',
    sport: 'baseball',
    description: 'USA Baseball Pitch Smart guidelines, ages 7-8. Used by Little League, Cal Ripken, and PONY divisions.',
    rules: { ...pitchSmartRules(50), breakpoints: PITCH_SMART_BREAKPOINTS.slice(0,3), absoluteMaxRest: 2 }
  },
  {
    id: 'pitch-smart-9-10',
    label: 'Pitch Smart 9-10 (75 max)',
    sport: 'baseball',
    description: 'USA Baseball Pitch Smart guidelines, ages 9-10.',
    rules: pitchSmartRules(75)
  },
  {
    id: 'pitch-smart-11-12',
    label: 'Pitch Smart 11-12 (85 max)',
    sport: 'baseball',
    description: 'USA Baseball Pitch Smart guidelines, ages 11-12. Matches Little League Majors rest rules.',
    rules: pitchSmartRules(85)
  },
  {
    id: 'pitch-smart-13-14',
    label: 'Pitch Smart 13-14 (95 max)',
    sport: 'baseball',
    description: 'USA Baseball Pitch Smart guidelines, ages 13-14.',
    rules: pitchSmartRules(95)
  },
  {
    id: 'softball-none',
    label: 'Softball - no pitching limits',
    sport: 'softball',
    description: 'No workload restrictions (typical for USA Softball and many rec leagues).',
    rules: {
      limitType: 'none',
      breakpoints: [],
      absoluteMax: 0,
      absoluteMaxRest: 0,
      ...NO_INNINGS_RULES
    }
  },
  {
    id: 'softball-innings',
    label: 'Softball - innings limits',
    sport: 'softball',
    description: 'Rest requirements by innings pitched, with a per-game cap. Adjust the numbers to your league.',
    rules: {
      limitType: 'innings',
      breakpoints: [],
      absoluteMax: 0,
      absoluteMaxRest: 0,
      inningsBreakpoints: [
        { maxInnings: 3, restDays: 0 },
        { maxInnings: 6, restDays: 1 }
      ],
      maxInningsPerGame: 3
    }
  }
];

export const CUSTOM_PRESET_ID = 'custom';

export function getPreset(id: string): PitchRulePreset | undefined {
  return PITCH_RULE_PRESETS.find(p => p.id === id);
}

export function getPresetsForSport(sport: Sport): PitchRulePreset[] {
  return PITCH_RULE_PRESETS.filter(p => p.sport === sport);
}
