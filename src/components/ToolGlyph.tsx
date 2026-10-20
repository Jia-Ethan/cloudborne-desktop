import type { ToolId } from '../api';
import { Logo, type LogoId } from './Logo';

// Each tool's own mark on a white tile, the way app icons sit in a dock.
const LOGO: Record<ToolId, LogoId> = {
  codex: 'codex',
  claude: 'claudecode',
  zcode: 'zai',
  grok: 'grok',
  pi: 'pi',
  dsh: 'deepseek',
};

const BOX = { xs: 'size-5 rounded-[6px]', sm: 'size-6 rounded-[7px]', md: 'size-12 rounded-[14px]' };

export function ToolGlyph({ id, size = 'md' }: { id: ToolId; size?: 'xs' | 'sm' | 'md' }) {
  const box = BOX[size];
  const mark = size === 'xs' ? 'size-[13px]' : size === 'sm' ? 'size-[15px]' : id === 'codex' ? 'size-8' : 'size-[26px]';
  return (
    <div
      className={`flex ${box} shrink-0 items-center justify-center bg-white text-[#141414] shadow-[inset_0_0_0_1px_rgb(20_20_20/0.08)]`}
      aria-hidden
    >
      <Logo id={LOGO[id]} className={mark} />
    </div>
  );
}
