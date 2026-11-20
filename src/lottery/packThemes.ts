import type { Draw, Rarity } from '../api';
import type { LogoId } from '../components/Logo';

export interface PackSkin {
  id: string;
  name: string;
  zhName: string;
  /** Primary foil coat color. */
  pack: string;
  /** Subtle secondary tint for embossed accents. */
  accent: string;
  /** Foil text ink tone (light on rich foils). */
  ink: string;
}

/**
 * Cloudborne foil booster editions — rotated so consecutive packs never repeat.
 * Inspired by the Cloudborne app icon (dawn cobalt, rose prism, apricot ember)
 * alongside classic collector metallic foils.
 */
export const PACK_SKINS: readonly PackSkin[] = [
  { id: 'cobalt', name: 'Dawn Cobalt', zhName: '晨晓钴蓝', pack: '#2b43ee', accent: '#9bb5ff', ink: '#ffffff' },
  { id: 'ember', name: 'Apricot Ember', zhName: '暖杏日落', pack: '#eb5630', accent: '#ffd0b0', ink: '#ffffff' },
  { id: 'violet', name: 'Nebula Violet', zhName: '星云紫晶', pack: '#7540ec', accent: '#d8c4ff', ink: '#ffffff' },
  { id: 'rose', name: 'Rose Prism', zhName: '暮霞蔷薇', pack: '#e24991', accent: '#ffc7e0', ink: '#ffffff' },
  { id: 'pine', name: 'Aurora Pine', zhName: '极光松绿', pack: '#0e9674', accent: '#9ff5dc', ink: '#ffffff' },
  { id: 'night', name: 'Obsidian Foil', zhName: '星夜黑曜', pack: '#23273d', accent: '#b7c4ff', ink: '#ffffff' },
];

/** Neutral dawn-aurora ribbons shown while tearing before rarity is revealed. */
export const AURORA_BANDS = ['#ff5a8a', '#ff9452', '#ffd35c', '#4fd9a8', '#54b2ff', '#9275ff', '#ff74cc'] as const;

/** Rarity-specific ribbon palettes once the draw result resolves. */
export const RARITY_BANDS: Record<Rarity, readonly string[]> = {
  common: ['#dbe4f3', '#eef2f9', '#b8cbe8', '#ffffff', '#cddaf0', '#e5ecf7', '#c5d6ee'],
  rare: ['#3b82f6', '#60a5fa', '#93c5fd', '#6366f1', '#38bdf8', '#818cf8', '#bfdbfe'],
  epic: ['#a855f7', '#d946ef', '#818cf8', '#f0abfc', '#7c3aed', '#c084fc', '#60a5fa'],
  legendary: ['#f59e0b', '#fbbf24', '#fde68a', '#ff8a3d', '#fff4c2', '#f5b301', '#ff5fa2'],
};

/** Confetti palettes by highest rarity pulled. */
export const CONFETTI_COLORS: Record<Rarity, readonly string[]> = {
  common: ['#ff5a8a', '#ff9452', '#ffd35c', '#4fd9a8', '#54b2ff', '#9275ff', '#ffffff'],
  rare: ['#3b82f6', '#60a5fa', '#93c5fd', '#818cf8', '#38bdf8', '#e0f2fe', '#ffffff'],
  epic: ['#a855f7', '#e879f9', '#818cf8', '#c084fc', '#f472b6', '#60a5fa', '#ffffff'],
  legendary: ['#f5b301', '#ffd76a', '#fff3c4', '#ff8d5c', '#ff5fa2', '#94b1ff', '#ffffff'],
};

/**
 * Option B: in multi-card batch pulls (2+), Epic and Legendary draws land
 * face-down with shimmering mystery foil backs so the player gets the thrill
 * of flipping big hits one by one (or clicking "Flip all").
 */
export function isMysteryDraw(draw: Pick<Draw, 'rarity' | 'kind'>, batchTotal: number): boolean {
  if (batchTotal <= 1) return false;
  if (draw.kind === 'none') return false;
  return draw.rarity === 'epic' || draw.rarity === 'legendary';
}

/**
 * Matches a token pack's `group_name` to one of Cloudborne's built-in vendor marks
 * so token-pack cards carry an authentic embossed vendor medallion.
 */
export function matchVendorLogo(groupName?: string | null): LogoId | null {
  if (!groupName) return null;
  const g = groupName.toLowerCase();
  if (g.includes('claude')) return 'claude';
  if (g.includes('codex')) return 'codex';
  if (g.includes('openai') || g.includes('gpt') || g.includes('o1') || g.includes('o3') || g.includes('o4')) return 'openai';
  if (g.includes('gemini') || g.includes('google')) return 'gemini';
  if (g.includes('deepseek')) return 'deepseek';
  if (g.includes('grok') || g.includes('xai')) return 'grok';
  if (g.includes('kimi') || g.includes('moonshot')) return 'kimi';
  if (g.includes('qwen') || g.includes('千问') || g.includes('通义')) return 'qwen';
  if (g.includes('minimax')) return 'minimax';
  if (g.includes('glm') || g.includes('zhipu') || g.includes('智谱')) return 'zhipu';
  if (g.includes('hunyuan') || g.includes('混元')) return 'hunyuan';
  if (g.includes('mimo')) return 'mimo';
  return null;
}

/** Rarity ranking helper for picking the headline rarity of a pull. */
export function bestRarity(draws: readonly Pick<Draw, 'rarity' | 'kind'>[]): Rarity {
  const order: Rarity[] = ['common', 'rare', 'epic', 'legendary'];
  let best = 0;
  for (const d of draws) {
    if (d.kind === 'none') continue;
    const idx = order.indexOf(d.rarity);
    if (idx > best) best = idx;
  }
  return order[best];
}
