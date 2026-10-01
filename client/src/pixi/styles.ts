import type { CharacterId } from '@bvs/shared';

export interface CharacterStyle {
  id: CharacterId;
  displayName: string;
  skin: string;
  skinShade: string;
  skinLine: string;
  hair: string;
  hairShade: string;
  hairLight: string;
  hairTip: string;
  iris: string;
  irisDark: string;
  lip: string;
  eyeshadow: string;
  line: string;
  /** Ink colour for hair outlines. */
  hairInk: string;
  skinDeep: string;
  blushBase: number;
  hairStyle: 'ponytail' | 'long';
  /** Outfit palette. */
  o: Record<string, string>;
}

// Both characters are adults (Buy is 27, Sell is 26 in the placeholder canon).
export const STYLES: Record<CharacterId, CharacterStyle> = {
  buy: {
    id: 'buy',
    displayName: 'BUY',
    skin: '#f8dccb',
    skinShade: '#e9b49f',
    skinLine: '#b9786a',
    hair: '#17b89b',
    hairShade: '#0b6f68',
    hairLight: '#8ff7e0',
    hairTip: '#0e8f86',
    iris: '#2ee6b8',
    irisDark: '#07564d',
    lip: '#d9606e',
    eyeshadow: '#1aa38c',
    line: '#253238',
    hairInk: '#06413c',
    skinDeep: '#d4907c',
    blushBase: 0.18,
    hairStyle: 'ponytail',
    o: {
      top: '#10b981',
      topShade: '#047857',
      trim: '#f5c451',
      jacket: '#2dd4bf',
      jacketShade: '#0f9e8e',
      jacketTrim: '#ecfeff',
      skirt: '#0f766e',
      skirtShade: '#0b4f4a',
      belt: '#f5c451',
    },
  },
  sell: {
    id: 'sell',
    displayName: 'SELL',
    skin: '#f6d3bf',
    skinShade: '#e2a48e',
    skinLine: '#b46f63',
    hair: '#d8243f',
    hairShade: '#86122d',
    hairLight: '#ff8f9c',
    hairTip: '#7c3aed',
    iris: '#c084fc',
    irisDark: '#4c1d95',
    lip: '#c2185b',
    eyeshadow: '#8b5cf6',
    line: '#2b1d2e',
    hairInk: '#5b0a20',
    skinDeep: '#cc8672',
    blushBase: 0.22,
    hairStyle: 'long',
    o: {
      bikini: '#7c3aed',
      bikiniShade: '#5b21b6',
      bikiniTrim: '#f43f5e',
      shorts: '#4c1d95',
      shortsShade: '#2e1065',
      top: '#dc2626',
      topShade: '#991b1b',
      skirt: '#b91c1c',
      skirtShade: '#7f1d1d',
      skirtTrim: '#a78bfa',
      sash: '#8b5cf6',
      sashShade: '#6d28d9',
      gold: '#f5c451',
      jacket: '#2e1065',
      jacketShade: '#1e0b45',
      jacketLining: '#e11d48',
      jacketTrim: '#f5c451',
    },
  },
};

/** Removable layers, removed from both characters in this order at milestones 1..5. */
export const SELL_LAYERS = ['jacket', 'sash', 'skirt', 'shorts', 'cropTop'] as const;
export type SellLayer = (typeof SELL_LAYERS)[number];

export const LAYER_LABELS: Record<SellLayer, string> = {
  jacket: 'Jackets',
  sash: 'Sash and belt',
  skirt: 'Skirts',
  shorts: 'Shorts',
  cropTop: 'Tops',
};
