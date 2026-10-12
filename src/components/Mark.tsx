import markPath from '../../brand/dist/mark-path.json';

const [x, y, w, h] = markPath.viewBox;

/** Cloudborne mark, drawn in the current text color. */
export function Mark({ className = 'h-6' }: { className?: string }) {
  return (
    <svg viewBox={`${x} ${y} ${w} ${h}`} fill="currentColor" className={`${className} w-auto shrink-0`} aria-hidden>
      <path fillRule="evenodd" d={markPath.d} />
    </svg>
  );
}
