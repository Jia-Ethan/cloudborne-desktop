import type { ToolId } from '../api';

// Neutral monogram tiles rather than the vendors' logos, tinted from the app palette.
const STYLE: Record<ToolId, { label: string; from: string; to: string }> = {
  codex: { label: '>_', from: '#c9d3ff', to: '#a9b8ff' },
  claude: { label: 'C', from: '#ffd9c2', to: '#ffb48f' },
  zcode: { label: 'Z', from: '#d5f0e4', to: '#a8dcc5' },
  grok: { label: 'G', from: '#e4dcf5', to: '#c6b6ea' },
};

export function ToolGlyph({ id, size = 'md' }: { id: ToolId; size?: 'sm' | 'md' }) {
  const s = STYLE[id];
  const box = size === 'sm' ? 'size-6 rounded-[7px] text-[11px]' : 'size-12 rounded-[14px] text-[15px]';
  return (
    <div
      className={`flex ${box} shrink-0 items-center justify-center font-bold tracking-tight text-[#141414] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.6)]`}
      style={{ background: `linear-gradient(145deg, ${s.from}, ${s.to})` }}
      aria-hidden
    >
      <span className={id === 'codex' ? `font-mono ${size === 'sm' ? 'text-[9px]' : 'text-[13px]'}` : ''}>{s.label}</span>
    </div>
  );
}
