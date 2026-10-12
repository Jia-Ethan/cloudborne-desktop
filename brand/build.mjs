// Cloudborne brand assets: app icon + standalone mark, generated from geometry.
// Usage: node brand/build.mjs  ->  brand/dist/*.svg
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'dist');
const f = v => v.toFixed(1);

// macOS superellipse body, 824px on a 1024 canvas (Apple icon grid)
function squircle(x, y, size, n = 5, steps = 360) {
  const r = size / 2, cx = x + r, cy = y + r, pts = [];
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * 2 * Math.PI, c = Math.cos(t), s = Math.sin(t);
    pts.push([cx + r * Math.sign(c) * Math.abs(c) ** (2 / n), cy + r * Math.sign(s) * Math.abs(s) ** (2 / n)]);
  }
  return 'M' + pts.map(p => p.map(f).join(',')).join('L') + 'Z';
}

// concave four-point sparkle
function sparkle(cx, cy, s, k = 0.12) {
  return `M${cx},${cy - s}Q${cx + s * k},${cy - s * k} ${cx + s},${cy}` +
    `Q${cx + s * k},${cy + s * k} ${cx},${cy + s}Q${cx - s * k},${cy + s * k} ${cx - s},${cy}` +
    `Q${cx - s * k},${cy - s * k} ${cx},${cy - s}Z`;
}

// inward spiral centerline; angles in degrees, clockwise in SVG space
function spiral(cx, cy, a0, a1, rf, n = 160) {
  const p = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, a = (a0 + (a1 - a0) * t) * Math.PI / 180, r = rf(t);
    p.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return 'M' + p.map(q => q.map(f).join(',')).join('L');
}

// 云起 mark: three-lobe cloud, right lobe carved into a 祥云 curl, sparkles in the dome
const C = { mx: 482, my: 470, mr: 140, lx: 356, ly: 574, lr: 84, rx: 650, ry: 558, rr: 100, base: 658 };
const CLOUD = `<circle cx="${C.mx}" cy="${C.my}" r="${C.mr}"/>` +
  `<circle cx="${C.lx}" cy="${C.ly}" r="${C.lr}"/>` +
  `<circle cx="${C.rx}" cy="${C.ry}" r="${C.rr}"/>` +
  `<rect x="${C.lx}" y="${C.ly}" width="${C.rx - C.lx}" height="${C.base - C.ly}"/>`;
const SPARKLES = sparkle(C.mx - 4, C.my + 14, 56) + sparkle(C.lx + 30, C.ly - 8, 21);
const CURL = spiral(C.rx, C.ry, 198, 198 + 360 * 1.12, t => (C.rr - 6) * (1 - t) ** 1.25 + 16 * t);
// glyph bounds: x 272..750, y 330..658
const MARK_BOX = { x: 272, y: 330, w: 478, h: 328 };

const cutMask = id => `<mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1024">` +
  `<rect width="1024" height="1024" fill="#fff"/><path d="${SPARKLES}" fill="#000"/>` +
  `<path d="${CURL}" stroke="#000" stroke-width="23" stroke-linecap="round" fill="none"/></mask>`;

const PALETTE = { top: '#C9D3FF', mid: '#FCDCE6', bot: '#FFC4A3', sun: '#FF8D5C', sky: '#94B1FF', rose: '#FFAFCB', ink: '#141414' };

function appIcon(p = PALETTE) {
  const SQ = squircle(100, 100, 824);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
<defs>
  <clipPath id="sq"><path d="${SQ}"/></clipPath>
  <linearGradient id="base" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.top}"/><stop offset=".5" stop-color="${p.mid}"/><stop offset="1" stop-color="${p.bot}"/></linearGradient>
  <radialGradient id="sun" cx=".46" cy="1.04" r=".64"><stop offset="0" stop-color="${p.sun}"/><stop offset=".5" stop-color="${p.sun}" stop-opacity=".45"/><stop offset="1" stop-color="${p.sun}" stop-opacity="0"/></radialGradient>
  <radialGradient id="sky" cx=".9" cy=".1" r=".62"><stop offset="0" stop-color="${p.sky}"/><stop offset="1" stop-color="${p.sky}" stop-opacity="0"/></radialGradient>
  <radialGradient id="rose" cx=".04" cy=".46" r=".52"><stop offset="0" stop-color="${p.rose}"/><stop offset="1" stop-color="${p.rose}" stop-opacity="0"/></radialGradient>
  <radialGradient id="glow" cx=".5" cy=".42" r=".44"><stop offset="0" stop-color="#FFF8F3" stop-opacity=".95"/><stop offset="1" stop-color="#FFF8F3" stop-opacity="0"/></radialGradient>
  <filter id="soft" filterUnits="userSpaceOnUse" x="-200" y="-200" width="1424" height="1424"><feGaussianBlur stdDeviation="38"/></filter>
  <filter id="grain" x="0" y="0" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" stitchTiles="stitch"/>
    <feColorMatrix values="0 0 0 0 .5  0 0 0 0 .5  0 0 0 0 .5  0 0 0 .07 0"/>
  </filter>
  <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
    <feGaussianBlur in="SourceAlpha" stdDeviation="16"/><feOffset dy="14"/>
    <feComponentTransfer><feFuncA type="linear" slope=".22"/></feComponentTransfer>
    <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
  ${cutMask('cut')}
</defs>
<g filter="url(#shadow)"><path d="${SQ}" fill="url(#base)"/></g>
<g clip-path="url(#sq)">
  <rect width="1024" height="1024" fill="url(#rose)"/>
  <rect width="1024" height="1024" fill="url(#sky)"/>
  <rect width="1024" height="1024" fill="url(#sun)"/>
  <path d="M60,700 C300,560 640,820 980,560 L980,1000 L60,1000Z" fill="#FFB08A" opacity=".35" filter="url(#soft)"/>
  <path d="M80,300 C320,180 700,360 960,220" stroke="#fff" stroke-width="120" fill="none" opacity=".35" filter="url(#soft)"/>
  <rect width="1024" height="1024" fill="url(#glow)"/>
  <rect width="1024" height="1024" filter="url(#grain)"/>
</g>
<path d="${SQ}" fill="none" stroke="#fff" stroke-opacity=".6" stroke-width="2.5"/>
<g fill="${p.ink}" mask="url(#cut)">${CLOUD}</g>
</svg>
`;
}

// standalone mark, tightly cropped; fill follows currentColor for web use
function mark(fill = 'currentColor', pad = 24) {
  const b = MARK_BOX, vb = `${b.x - pad} ${b.y - pad} ${b.w + pad * 2} ${b.h + pad * 2}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" fill="${fill}">
<defs>${cutMask('cb-cut')}</defs>
<g mask="url(#cb-cut)">${CLOUD}</g>
</svg>
`;
}

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'app-icon.svg'), appIcon());
writeFileSync(join(OUT, 'mark.svg'), mark());
writeFileSync(join(OUT, 'mark-ink.svg'), mark(PALETTE.ink));
writeFileSync(join(OUT, 'mark-white.svg'), mark('#FFFFFF'));
console.log('wrote', OUT);
