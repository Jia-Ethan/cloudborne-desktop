// Line icons on a 24px grid, stroked in the current color.
const PATHS = {
  home: 'M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z',
  console: 'M4 5h16v11H4zM8.5 20h7M12 16v4M7.5 9.5 10 11l-2.5 1.5M12.5 12.5h4',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M3.5 9h17M3.5 15h17M12 3c-2.4 2.5-3.5 5.5-3.5 9s1.1 6.5 3.5 9c2.4-2.5 3.5-5.5 3.5-9S14.4 5.5 12 3',
  update: 'M20 12a8 8 0 1 1-2.35-5.66M20 4v4.5h-4.5',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 11v5.5M12 7.6v.2',
  logout: 'M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 16l-4-4 4-4M6 12h10',
  chevronRight: 'm9.5 6 6 6-6 6',
  chevronDown: 'm6 9.5 6 6 6-6',
  check: 'm5 12.5 4.5 4.5L19 7.5',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  refresh: 'M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v3.7h-3.7',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className = 'size-4' }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`${className} shrink-0`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
