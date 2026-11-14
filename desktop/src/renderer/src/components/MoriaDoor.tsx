import type { CSSProperties } from 'react';

// The Doors of Durin, shared by the full lock scene (LockMoria) and the still gate shown on phones (LockGate).

/** Cheap seeded noise: irregular, but identical on every render. */
export const noise = (i: number, k: number) => {
  const v = Math.sin(i * 97.13 + k * 12.9898) * 43758.5453;
  return v - Math.floor(v);
};

export const CX = 800; // the gate's centre line
export const SPRING = 410; // where the arch starts to curve
export const R_IN = 160; // radius of the doorway
export const BASE = 640; // threshold
export const GLOW = '#8fd0ff';

/** One short rune-like mark; the shape is picked by `k`. */
function runePath(k: number): string {
  switch (k % 6) {
    case 0: return 'M0-7V7M0-3L5-7M0 2L5-2';
    case 1: return 'M0-7V7M0-5L-5-1M0 0L5 4';
    case 2: return 'M-4-7V7M-4-1L4-7M-4 3L4 7';
    case 3: return 'M0-7V7M-4-7L4-7M-4 7L4 7';
    case 4: return 'M-3-7L3 0L-3 7M3-7V7';
    default: return 'M0-7V7M-4-3L0-7L4-3M-4 3L0 7L4 3';
  }
}

/** Runes marching along the arch and down both sides of the gate. */
const RUNES: { x: number; y: number; rot: number; k: number; t: number }[] = (() => {
  const r = 183;
  const list: { x: number; y: number; rot: number; k: number; t: number }[] = [];
  const arcCount = 40;
  for (let i = 0; i < arcCount; i++) {
    const a = Math.PI + ((i + 0.5) / arcCount) * Math.PI;
    list.push({ x: CX + r * Math.cos(a), y: SPRING + r * Math.sin(a), rot: (a * 180) / Math.PI + 90, k: Math.floor(noise(i, 40) * 6), t: 0.2 + (0.6 * (i + 0.5)) / arcCount });
  }
  for (let j = 0; j < 14; j++) {
    const y = SPRING + 10 + j * 15;
    list.push({ x: CX - r, y, rot: 0, k: Math.floor(noise(j, 41) * 6), t: 0.2 * (1 - j / 14) });
    list.push({ x: CX + r, y, rot: 0, k: Math.floor(noise(j, 42) * 6), t: 0.8 + 0.2 * (j / 14) });
  }
  return list;
})();

export const star4 = (x: number, y: number, s: number) => `M${x} ${y - s}Q${x} ${y} ${x + s} ${y}Q${x} ${y} ${x} ${y + s}Q${x} ${y} ${x - s} ${y}Q${x} ${y} ${x} ${y - s}Z`;

/** What the gate needs in <defs>: the light that pours out when it opens, the wall's and the door's stone patterns, the glow filter, the doorway clip, and the carving drawn once (dim and lit copies <use> it). */
export function DoorDefs() {
  return (
    <>
            <radialGradient id="moria-burst" cx="0.5" cy="0.5" r="0.5">
              <stop offset="0" stopColor="#ffffff" />
              <stop offset="0.5" stopColor="#bfe3ff" />
              <stop offset="1" stopColor="#6fb4ff" stopOpacity="0" />
            </radialGradient>
            <pattern id="moria-rock" width="150" height="100" patternUnits="userSpaceOnUse">
              <rect width="150" height="100" fill="#172640" />
              <path d="M0 0H150M0 50H150M75 0V50M30 50V100M120 50V100" fill="none" stroke="#0a1220" strokeWidth="3" />
              <path d="M8 8H66M84 14H140M10 62H22M64 58H110M130 70H144" fill="none" stroke="#223656" strokeWidth="2" opacity="0.7" />
            </pattern>
            <pattern id="moria-door" width="70" height="46" patternUnits="userSpaceOnUse">
              <rect width="70" height="46" fill="#2a4067" />
              <path d="M0 0H70M0 23H70M35 0V23M0 23V46M70 23V46" fill="none" stroke="#1a2a47" strokeWidth="2" />
            </pattern>
            <filter id="moria-glow" x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="3.2" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <clipPath id="moria-doorway">
              <path d={`M${CX - R_IN} ${BASE}V${SPRING}A${R_IN} ${R_IN} 0 0 1 ${CX + R_IN} ${SPRING}V${BASE}Z`} />
            </clipPath>
            {/* the glowing carving, drawn once and used twice: dim (carved) and lit. The frame is lit by the sweep, the door's own art rises from the threshold afterwards */}
            <g id="moria-frame" fill="none" stroke={GLOW} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
              {/* the arch of runes */}
              <path d={`M${CX - 172} ${BASE - 30}V${SPRING}A172 172 0 0 1 ${CX + 172} ${SPRING}V${BASE - 30}`} strokeWidth={1.6} />
              <path d={`M${CX - 196} ${BASE - 30}V${SPRING}A196 196 0 0 1 ${CX + 196} ${SPRING}V${BASE - 30}`} strokeWidth={1.6} />
              {RUNES.map((r, i) => (
                <path key={i} className="moria__rune" d={runePath(r.k)} transform={`translate(${r.x.toFixed(1)} ${r.y.toFixed(1)}) rotate(${r.rot.toFixed(1)})`} strokeWidth={1.8} style={{ ['--t' as string]: r.t.toFixed(3) } as CSSProperties} />
              ))}
              {/* pillars */}
              <path d="M652 470V636M668 470V636M948 470V636M932 470V636" strokeWidth={2} />
              <path d="M646 466H674M926 466H954M646 640H674M926 640H954" strokeWidth={2.4} />
            </g>
            <g id="moria-inner" fill="none" stroke={GLOW} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
              {/* two trees growing up the door, mirrored */}
              {[false, true].map((m) => (
                <g key={String(m)} transform={m ? `translate(${CX * 2} 0) scale(-1 1)` : undefined}>
                  <path d="M698 636C696 580 690 540 704 502C718 468 704 442 720 412C736 382 728 352 752 322" />
                  <path d="M704 502C672 494 662 462 678 442C692 426 714 436 708 454" />
                  <path d="M720 412C692 398 688 366 706 352C724 340 742 356 732 372" />
                  <path d="M696 568C664 562 650 534 664 514" />
                  <path d="M690 600C672 604 662 590 664 578" />
                  {[[708, 454], [732, 372], [752, 322], [664, 514], [678, 442]].map(([x, y]) => (
                    <circle key={`${x}-${y}`} cx={x} cy={y} r={2.6} fill={GLOW} />
                  ))}
                </g>
              ))}
              {/* crown, anvil and the stars above */}
              <path d={`M${CX - 22} 314L${CX - 18} 290L${CX - 8} 302L${CX} 284L${CX + 8} 302L${CX + 18} 290L${CX + 22} 314Z`} />
              <path d={`M${CX - 24} 318H${CX + 24}`} />
              <path d={`M${CX - 20} 352H${CX + 20}L${CX + 14} 360H${CX - 14}ZM${CX - 6} 360V368H${CX + 6}V360`} />
              <path d={`M${CX - 10} 346L${CX + 14} 336`} />
              {[[-44, 296], [-34, 270], [0, 258], [34, 270], [44, 296], [-22, 338], [22, 338]].map(([dx, y], i) => (
                <path key={i} d={star4(CX + dx, y, 5)} fill={GLOW} strokeWidth={1} />
              ))}
              {/* the eight-pointed star */}
              <path d={star4(CX, 470, 30)} fill={GLOW} strokeWidth={1.4} />
              <path d={`M${CX - 20} 450L${CX + 20} 490M${CX + 20} 450L${CX - 20} 490`} strokeWidth={1.6} />
              <circle cx={CX} cy={470} r={6} fill="#e6f5ff" />
              <path d={`M${CX - 70} 470H${CX - 38}M${CX + 38} 470H${CX + 70}`} strokeWidth={1.8} />
            </g>
    </>
  );
}

/** The gate itself: the arch, the pillars and the two door leaves with their seam. `burst` adds the light that pours out when they open. */
export function DoorBody({ burst = false }: { burst?: boolean }) {
  return (
    <>
          {/* the gate: frame, pillars, door */}
          <path d={`M${CX - 205} ${BASE}V${SPRING}A205 205 0 0 1 ${CX + 205} ${SPRING}V${BASE}ZM${CX - R_IN} ${BASE}V${SPRING}A${R_IN} ${R_IN} 0 0 1 ${CX + R_IN} ${SPRING}V${BASE}Z`} fill="#243959" fillRule="evenodd" stroke="#0a1220" strokeWidth={4} />
          <rect x={CX - 196} y={SPRING} width={40} height={BASE - SPRING} fill="#2c456e" stroke="#0a1220" strokeWidth={3} />
          <rect x={CX + 156} y={SPRING} width={40} height={BASE - SPRING} fill="#2c456e" stroke="#0a1220" strokeWidth={3} />

          <g clipPath="url(#moria-doorway)">
            {/* light that pours out once the doors open */}
            {burst && <rect x={CX - R_IN} y={SPRING - R_IN} width={R_IN * 2} height={R_IN * 2 + (BASE - SPRING)} fill="url(#moria-burst)" />}
            <g className="moria__leaf moria__leaf--l">
              <path d={`M${CX - R_IN} ${BASE}V${SPRING}A${R_IN} ${R_IN} 0 0 1 ${CX} ${SPRING - R_IN}V${BASE}Z`} fill="url(#moria-door)" />
              <path d="M690 300L706 360L690 420M720 520L744 560M672 600L690 570L716 596" fill="none" stroke="#0c1628" strokeWidth={2} />
            </g>
            <g className="moria__leaf moria__leaf--r">
              <path d={`M${CX + R_IN} ${BASE}V${SPRING}A${R_IN} ${R_IN} 0 0 0 ${CX} ${SPRING - R_IN}V${BASE}Z`} fill="url(#moria-door)" />
              <path d="M910 300L894 360L910 420M880 520L856 560M928 600L910 570L884 596" fill="none" stroke="#0c1628" strokeWidth={2} />
            </g>
            <rect x={CX - 1.5} y={SPRING - R_IN} width={3} height={BASE - SPRING + R_IN} fill="#0a1220" className="moria__seam" />
          </g>

    </>
  );
}
