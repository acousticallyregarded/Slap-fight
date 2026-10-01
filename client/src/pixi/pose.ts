// Pose model, keyframe clips and the character state list.
// Arm angles are "forward-positive": 0 = hanging down, +PI/2 = pointing toward
// the opponent (centre stage), negative = back/outward.

export type HandShape = 'open' | 'relaxed' | 'fist' | 'peace' | 'point';
export type Mouth = 'smile' | 'grin' | 'open' | 'o' | 'smug' | 'laugh' | 'pout' | 'flat' | 'grit' | 'kiss';
export type EyeMode = 'normal' | 'wide' | 'happy' | 'wince' | 'wink';
export type Brows = 'neutral' | 'up' | 'angry' | 'worried' | 'smug';

export interface Pose {
  x: number;
  y: number;
  lean: number;
  headRot: number;
  headTurn: number;
  lookX: number;
  lookY: number;
  eyeOpen: number;
  blush: number;
  nearShoulder: number;
  nearElbow: number;
  nearWrist: number;
  farShoulder: number;
  farElbow: number;
  farWrist: number;
  nearHand: HandShape;
  farHand: HandShape;
  mouth: Mouth;
  eyes: EyeMode;
  brows: Brows;
  farArmFront: boolean;
  sweat: boolean;
}

export const NUMERIC_KEYS = [
  'x', 'y', 'lean', 'headRot', 'headTurn', 'lookX', 'lookY', 'eyeOpen', 'blush',
  'nearShoulder', 'nearElbow', 'nearWrist', 'farShoulder', 'farElbow', 'farWrist',
] as const;
export const DISCRETE_KEYS = ['nearHand', 'farHand', 'mouth', 'eyes', 'brows', 'farArmFront', 'sweat'] as const;

export const IDLE: Pose = {
  x: 0, y: 0, lean: 0, headRot: 0, headTurn: 0.35, lookX: 0.35, lookY: 0, eyeOpen: 1, blush: 0,
  nearShoulder: 0.14, nearElbow: 0.22, nearWrist: 0.1,
  farShoulder: -0.14, farElbow: -0.2, farWrist: -0.1,
  nearHand: 'relaxed', farHand: 'relaxed', mouth: 'smile', eyes: 'normal', brows: 'neutral', farArmFront: false, sweat: false,
};

export type Ease = 'inOut' | 'out' | 'in' | 'linear' | 'back';

export interface Key {
  t: number;
  p: Partial<Pose>;
  ease?: Ease;
}

export interface Clip {
  name: StateName;
  duration: number;
  keys: Key[];
  /** Named moments (e.g. impact) reported to the scheduler. */
  marks?: Record<string, number>;
  /** Blend back to idle afterwards (ms). 0 = stay on last pose (caller continues). */
  returnMs: number;
}

export type StateName =
  | 'idle'
  | 'lookViewer'
  | 'wave'
  | 'peace'
  | 'smileTilt'
  | 'blush'
  | 'coy'
  | 'fingerWag'
  | 'laugh'
  | 'cheer'
  | 'smugVictory'
  | 'acknowledge'
  | 'slapWindup'
  | 'slapStrike'
  | 'notice'
  | 'receiveSlap'
  | 'recover'
  | 'glare'
  | 'outfitTransition'
  | 'reducedSlapAttack'
  | 'reducedSlapDefend';

export function ease(e: Ease | undefined, t: number): number {
  switch (e ?? 'inOut') {
    case 'linear':
      return t;
    case 'in':
      return t * t * t;
    case 'out':
      return 1 - Math.pow(1 - t, 3);
    case 'back': {
      const c1 = 1.70158;
      const c3 = c1 + 1;
      return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    }
    default:
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }
}

const looking = { headTurn: 0, lookX: 0, lookY: 0 };

export const CLIPS: Record<Exclude<StateName, 'idle'>, Clip> = {
  lookViewer: {
    name: 'lookViewer', duration: 1300, returnMs: 450,
    keys: [
      { t: 220, p: { ...looking, headRot: -0.04, mouth: 'smile' } },
      { t: 380, p: { eyeOpen: 0.1 } },
      { t: 470, p: { eyeOpen: 1 } },
      { t: 1300, p: { ...looking } },
    ],
  },
  wave: {
    name: 'wave', duration: 1900, returnMs: 500,
    keys: [
      { t: 250, p: { ...looking, mouth: 'grin', brows: 'up' } },
      { t: 380, p: { eyeOpen: 0.1 } },
      { t: 470, p: { eyeOpen: 1 } },
      { t: 420, p: { nearShoulder: 2.3, nearElbow: 0.9, nearWrist: 0.2, nearHand: 'open' }, ease: 'back' },
      { t: 700, p: { nearElbow: 0.5, nearWrist: -0.3 } },
      { t: 980, p: { nearElbow: 0.95, nearWrist: 0.3 } },
      { t: 1260, p: { nearElbow: 0.5, nearWrist: -0.3 } },
      { t: 1540, p: { nearElbow: 0.9, nearWrist: 0.2 } },
      { t: 1900, p: { nearElbow: 0.8 } },
    ],
  },
  peace: {
    name: 'peace', duration: 1800, returnMs: 500,
    keys: [
      { t: 260, p: { ...looking, headRot: -0.12, mouth: 'grin', eyes: 'wink', brows: 'up' } },
      { t: 380, p: { nearShoulder: 0.95, nearElbow: 2.35, nearWrist: -0.15, nearHand: 'peace', y: -6 }, ease: 'back' },
      { t: 1500, p: { headRot: -0.16, y: -4 } },
      { t: 1800, p: { eyes: 'normal' } },
    ],
  },
  smileTilt: {
    name: 'smileTilt', duration: 1500, returnMs: 450,
    keys: [
      { t: 350, p: { headRot: 0.2, headTurn: 0.1, lookX: 0.1, mouth: 'smile', eyes: 'happy', blush: 0.5, brows: 'up' } },
      { t: 1300, p: { headRot: 0.22 } },
      { t: 1500, p: { eyes: 'normal' } },
    ],
  },
  blush: {
    name: 'blush', duration: 1200, returnMs: 500,
    keys: [
      { t: 250, p: { blush: 1, mouth: 'pout', lookY: 0.4, lookX: -0.2, headRot: 0.08, brows: 'worried' } },
      { t: 1200, p: { blush: 0.8 } },
    ],
  },
  coy: {
    name: 'coy', duration: 1800, returnMs: 550,
    keys: [
      { t: 120, p: { farArmFront: true } },
      {
        t: 450,
        p: {
          ...looking, headRot: 0.18, mouth: 'kiss', eyes: 'wink', blush: 0.7, brows: 'up', lean: 0.03,
          nearShoulder: -0.25, nearElbow: 1.55, nearWrist: 0.3, nearHand: 'relaxed',
          farShoulder: 0.28, farElbow: 1.45, farWrist: 0.2, farHand: 'relaxed',
        },
      },
      { t: 1500, p: { headRot: 0.14, mouth: 'smile', eyes: 'happy' } },
      { t: 1800, p: { eyes: 'normal' } },
      { t: 1800, p: { farArmFront: false } },
    ],
  },
  fingerWag: {
    name: 'fingerWag', duration: 1900, returnMs: 500,
    keys: [
      { t: 280, p: { headTurn: -0.9, lookX: -0.9, headRot: 0.12, blush: 0.9, mouth: 'pout', brows: 'angry', eyes: 'normal' } },
      { t: 380, p: { nearShoulder: 0.9, nearElbow: 2.3, nearWrist: 0, nearHand: 'point' }, ease: 'back' },
      { t: 600, p: { nearWrist: 0.4 } },
      { t: 800, p: { nearWrist: -0.3 } },
      { t: 1000, p: { nearWrist: 0.4 } },
      { t: 1200, p: { nearWrist: -0.3 } },
      { t: 1400, p: { nearWrist: 0.1 } },
      { t: 1900, p: { headTurn: -0.6 } },
    ],
  },
  laugh: {
    name: 'laugh', duration: 1500, returnMs: 450,
    keys: [
      { t: 200, p: { eyes: 'happy', mouth: 'laugh', headRot: -0.1, lean: -0.03, brows: 'up', nearShoulder: 0.6, nearElbow: 2.1, nearHand: 'relaxed' } },
      { t: 380, p: { y: -8, headRot: -0.14 } },
      { t: 540, p: { y: 0, headRot: -0.06 } },
      { t: 700, p: { y: -8, headRot: -0.14 } },
      { t: 860, p: { y: 0, headRot: -0.06 } },
      { t: 1020, p: { y: -6, headRot: -0.12 } },
      { t: 1250, p: { y: 0 } },
      { t: 1500, p: { eyes: 'normal', mouth: 'smile' } },
    ],
  },
  cheer: {
    name: 'cheer', duration: 1600, returnMs: 500,
    keys: [
      { t: 180, p: { nearShoulder: 0.5, nearElbow: 1.9, nearHand: 'fist', y: 4, eyes: 'happy', mouth: 'grin' } },
      { t: 420, p: { nearShoulder: 2.9, nearElbow: 0.25, y: -14, headRot: -0.1, mouth: 'laugh', ...looking }, ease: 'back' },
      { t: 700, p: { nearShoulder: 2.4, nearElbow: 0.9, y: -2 } },
      { t: 950, p: { nearShoulder: 2.95, nearElbow: 0.2, y: -12 }, ease: 'back' },
      { t: 1600, p: { eyes: 'normal', mouth: 'grin' } },
    ],
  },
  smugVictory: {
    name: 'smugVictory', duration: 1700, returnMs: 500,
    keys: [
      { t: 300, p: { ...looking, headRot: 0.14, mouth: 'smug', eyes: 'wink', brows: 'smug', nearShoulder: 2.55, nearElbow: 0.35, nearWrist: -0.1, nearHand: 'peace', y: -6 }, ease: 'back' },
      { t: 1400, p: { headRot: 0.1 } },
      { t: 1700, p: { eyes: 'normal' } },
    ],
  },
  acknowledge: {
    name: 'acknowledge', duration: 1600, returnMs: 500,
    keys: [
      { t: 300, p: { ...looking, mouth: 'grin', eyes: 'happy', nearShoulder: 1.2, nearElbow: 0.5, nearHand: 'open', nearWrist: -0.4 } },
      { t: 700, p: { lean: 0.08, headRot: 0.1, y: 6 } },
      { t: 1100, p: { lean: 0, headRot: 0, y: 0 } },
      { t: 1600, p: { eyes: 'normal', mouth: 'smile' } },
    ],
  },
  slapWindup: {
    name: 'slapWindup', duration: 480, returnMs: 0,
    keys: [
      { t: 480, p: { headTurn: 1, lookX: 1, brows: 'angry', mouth: 'grit', eyes: 'normal', lean: -0.07, x: -12, nearShoulder: 2.75, nearElbow: -1.35, nearWrist: -0.3, nearHand: 'open' }, ease: 'out' },
    ],
  },
  slapStrike: {
    name: 'slapStrike', duration: 380, returnMs: 0,
    marks: { impact: 150 },
    keys: [
      { t: 150, p: { nearShoulder: 1.88, nearElbow: 0.05, nearWrist: 0.1, lean: 0.12, x: 140, mouth: 'open' }, ease: 'in' },
      { t: 380, p: { nearShoulder: 1.55, nearElbow: 0.45, lean: 0.08, x: 118 }, ease: 'out' },
    ],
  },
  notice: {
    name: 'notice', duration: 260, returnMs: 0,
    keys: [{ t: 260, p: { headTurn: 1, lookX: 1, eyes: 'wide', brows: 'up', mouth: 'o', lean: -0.02 }, ease: 'out' }],
  },
  receiveSlap: {
    name: 'receiveSlap', duration: 700, returnMs: 0,
    keys: [
      { t: 90, p: { headTurn: -1, lookX: -1, headRot: 0.42, eyes: 'wince', mouth: 'o', brows: 'worried', lean: -0.12, x: -38, sweat: true }, ease: 'out' },
      { t: 700, p: { headRot: 0.3, x: -30, lean: -0.08 } },
    ],
  },
  glare: {
    name: 'glare', duration: 900, returnMs: 0,
    keys: [
      { t: 220, p: { headTurn: 1, lookX: 1, headRot: -0.05, eyes: 'normal', eyeOpen: 0.62, brows: 'angry', mouth: 'pout', sweat: false, x: -10 } },
      { t: 900, p: { headRot: -0.07 } },
    ],
  },
  recover: {
    name: 'recover', duration: 520, returnMs: 0,
    keys: [{ t: 520, p: { ...IDLE } }],
  },
  outfitTransition: {
    name: 'outfitTransition', duration: 1500, returnMs: 500,
    marks: { release: 380 },
    keys: [
      { t: 200, p: { eyes: 'wide', mouth: 'o', brows: 'up', ...looking, blush: 0.4 } },
      { t: 500, p: { y: -10 } },
      { t: 800, p: { y: 0, eyes: 'wink', mouth: 'grin', nearShoulder: 2.55, nearElbow: 0.35, nearHand: 'peace', blush: 0.3 }, ease: 'back' },
      { t: 1500, p: { eyes: 'normal' } },
    ],
  },
  reducedSlapAttack: {
    name: 'reducedSlapAttack', duration: 900, returnMs: 400,
    marks: { impact: 300 },
    keys: [{ t: 300, p: { headTurn: 1, lookX: 1, brows: 'smug', mouth: 'smug', nearShoulder: 1.3, nearElbow: 0.2, nearHand: 'point' } }],
  },
  reducedSlapDefend: {
    name: 'reducedSlapDefend', duration: 900, returnMs: 400,
    keys: [{ t: 300, p: { headTurn: 1, lookX: 1, eyes: 'wide', brows: 'up', mouth: 'o' } }],
  },
};

export const ALL_STATES: StateName[] = ['idle', ...(Object.keys(CLIPS) as Exclude<StateName, 'idle'>[])];
