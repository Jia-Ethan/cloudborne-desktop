import { brandOf } from '../brands';
import { Logo } from './Logo';

/** A platform's mark on a small white tile, like the vendor marks on the usage page. */
export function BrandMark({ platform, size = 'sm' }: { platform: string | null | undefined; size?: 'sm' | 'md' }) {
  const b = brandOf(platform);
  return (
    <span className={`brand-mark brand-mark-${size}`} aria-hidden>
      {b.logo && <Logo id={b.logo} className={size === 'md' ? 'size-[19px]' : 'size-[13px]'} />}
    </span>
  );
}
