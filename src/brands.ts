import type { LogoId } from './components/Logo';

/** Display name and mark for a relay platform or status provider. */
const BRANDS: Record<string, { name: string; logo: LogoId | null }> = {
  anthropic: { name: 'Claude', logo: 'claude' },
  openai: { name: 'GPT', logo: 'openai' },
  gemini: { name: 'Gemini', logo: 'gemini' },
  grok: { name: 'Grok', logo: 'grok' },
  deepseek: { name: 'DeepSeek', logo: 'deepseek' },
  zhipu: { name: 'GLM', logo: 'zhipu' },
  kimi: { name: 'Kimi', logo: 'kimi' },
  minimax: { name: 'MiniMax', logo: 'minimax' },
  antigravity: { name: 'Antigravity', logo: 'gemini' },
};

export function brandOf(platform: string | null | undefined): { name: string; logo: LogoId | null } {
  return (platform && BRANDS[platform]) || { name: platform ?? '', logo: null };
}
