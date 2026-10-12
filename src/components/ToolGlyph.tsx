import type { ToolId } from '../api';
import { Logo, type LogoId } from './Logo';

// Each tool's own mark on a white tile, the way app icons sit in a dock.
const LOGO: Record<ToolId, LogoId> = {
  codex: 'codex',
  claude: 'claudecode',
  zcode: 'zai',
  grok: 'grok',
  pi: 'pi',
};

export function ToolGlyph({ id, size = 'md' }: { id: ToolId; size?: 'sm' | 'md' }) {
  const box = size === 'sm' ? 'size-6 rounded-[7px]' : 'size-12 rounded-[14px]';
  const mark = size === 'sm' ? 'size-[15px]' : id === 'codex' ? 'size-8' : 'size-[26px]';
  return (
    <div
      className={`flex ${box} shrink-0 items-center justify-center bg-white text-[#141414] shadow-[inset_0_0_0_1px_rgb(20_20_20/0.08)]`}
      aria-hidden
    >
      <Logo id={LOGO[id]} className={mark} />
    </div>
  );
}
