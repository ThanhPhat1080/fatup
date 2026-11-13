import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Figure, FellowshipDefs, WALKERS } from './Fellowship';

/** Seconds the doors take to swing open and flood the screen with light, before the app appears. */
export const DOORS_OPEN_S = 1.7;

/** Cheap seeded noise: irregular, but identical on every render. */
const noise = (i: number, k: number) => {
  const v = Math.sin(i * 97.13 + k * 12.9898) * 43758.5453;
  return v - Math.floor(v);
};

const CX = 800; // the gate's centre line
const SPRING = 410; // where the arch starts to curve
const R_IN = 160; // radius of the doorway
const BASE = 640; // threshold
const GLOW = '#8fd0ff';

type TreeArt = { dark: { w: number; d: string }[]; rim: { w: number; d: string }[]; tips: [number, number][] };

/**
 * A bare, gnarled tree grown from a dozen thick limbs that fork again and again into a dense crown of twigs.
 * Segments are merged into one path per thickness so the SVG stays light.
 */
function growTree(seedBase: number): TreeArt {
  const byWidth = new Map<number, string[]>();
  const tips: [number, number][] = [];
  const grow = (x: number, y: number, ang: number, len: number, w: number, depth: number, seed: number) => {
    if (depth === 0 || w < 0.9) return;
    const x2 = x + Math.cos(ang) * len;
    const y2 = y + Math.sin(ang) * len;
    const bend = (noise(seed, 1) - 0.5) * len * 0.55;
    const cx = (x + x2) / 2 + Math.cos(ang + Math.PI / 2) * bend;
    const cy = (y + y2) / 2 + Math.sin(ang + Math.PI / 2) * bend;
    const key = Math.max(1, Math.round(w));
    const list = byWidth.get(key) ?? [];
    list.push(`M${x.toFixed(1)} ${y.toFixed(1)}Q${cx.toFixed(1)} ${cy.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`);
    byWidth.set(key, list);
    if (depth === 1 || w < 1.6) {
      if (noise(seed, 9) > 0.55) tips.push([x2, y2]);
      return;
    }
    const forks = depth >= 5 ? 2 : noise(seed, 2) > 0.62 ? 3 : 2;
    for (let k = 0; k < forks; k++) {
      grow(x2, y2, ang + (noise(seed + k, 3) - 0.5) * 1.3 + (k - (forks - 1) / 2) * 0.5, len * (0.78 + noise(seed + k, 4) * 0.08), w * 0.7, depth - 1, seed * 3 + k + 1);
    }
  };
  // [startX, startY, angle, length, width]: limbs from the crown, plus a few off the trunk lower down
  const limbs: [number, number, number, number, number][] = [
    [428, 304, -2.95, 150, 30],
    [446, 292, -2.5, 170, 32],
    [464, 284, -2.1, 150, 30],
    [480, 284, -1.75, 110, 26],
    [494, 298, -1.4, 80, 20],
    [504, 330, -0.95, 60, 14],
    [420, 360, -3.2, 120, 20],
    [506, 400, -0.5, 105, 17],
    [412, 440, -3.0, 100, 15],
  ];
  limbs.forEach(([x, y, a, l, w], i) => grow(x, y, a, l, w, 6, seedBase + i * 7));
  const widths = [...byWidth.keys()].sort((p, q) => q - p);
  return {
    dark: widths.map((w) => ({ w, d: byWidth.get(w)!.join('') })),
    rim: widths.filter((w) => w >= 2).map((w) => ({ w: Math.max(1, w * 0.2), d: byWidth.get(w)!.join('') })),
    tips: tips.slice(0, 90),
  };
}
const TREE_L = growTree(11);
const TREE_R = growTree(97);

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

const star4 = (x: number, y: number, s: number) => `M${x} ${y - s}Q${x} ${y} ${x + s} ${y}Q${x} ${y} ${x} ${y + s}Q${x} ${y} ${x - s} ${y}Q${x} ${y} ${x} ${y - s}Z`;

/** Pairs of twinkles scattered over the glowing carving. */
const TWINKLES = Array.from({ length: 22 }, (_, i) => {
  const a = Math.PI + noise(i, 50) * Math.PI;
  const rad = 40 + noise(i, 51) * 160;
  return { x: CX + rad * Math.cos(a) * 0.95, y: SPRING + 120 + rad * Math.sin(a) * 1.05, s: 4 + noise(i, 52) * 5, delay: noise(i, 53) * 4 };
});

const MOTES = Array.from({ length: 26 }, (_, i) => ({
  x: 8 + noise(i, 60) * 84,
  size: 1.5 + noise(i, 61) * 2.5,
  dur: 10 + noise(i, 62) * 10,
  delay: -noise(i, 63) * 18,
  dx: (noise(i, 64) - 0.5) * 80,
}));

type Tentacle = { fx: number; fl: number; fw: number; lean: number; amp: number; k: number; speed: number; curl: number; dir: number; phase: number };

/**
 * Giant tentacles reaching up from below the bottom edge of the screen. Sizes are fractions of the window:
 * x position, length (of height), base width (of height), then lean (rad), wave size, wave length, speed, curl, curl direction.
 */
const TENTACLES: Tentacle[] = [
  { fx: 0.06, fl: 0.34, fw: 0.085, lean: -1.5, amp: 0.2, k: 2.6, speed: 1.0, curl: 3.0, dir: 1, phase: 0 },
  { fx: 0.2, fl: 0.24, fw: 0.06, lean: -1.62, amp: 0.26, k: 3.0, speed: 1.3, curl: 2.6, dir: -1, phase: 2.1 },
  { fx: 0.79, fl: 0.26, fw: 0.065, lean: -1.58, amp: 0.24, k: 2.8, speed: 1.15, curl: 2.8, dir: 1, phase: 4.2 },
  { fx: 0.5, fl: 0.3, fw: 0.085, lean: -1.57, amp: 0.2, k: 2.5, speed: 0.95, curl: 3.2, dir: -1, phase: 5.3 },
];
const SEGS = 40;

type Pt = [number, number];

/** Where a tentacle's centre line runs at time `t` in a W x H window; `straight` (0..1) uncurls it and stretches it up. */
function tentaclePose(T: Tentacle, t: number, straight: number, W: number, H: number): Pt[] {
  const drift = Math.sin(t * 0.25 + T.phase) * 0.025 * W * (1 - straight); // swimming slowly side to side
  const rise = Math.sin(t * 0.7 + T.phase) * 0.02 * H * (1 - straight); // rising and sinking
  const curlAmount = (Math.sin(t * 0.42 + T.phase * 1.7) * 0.5 + 0.5) * (1 - straight);
  const lean = T.lean * (1 - straight) + (-Math.PI / 2) * straight;
  const seg = (T.fl * H * (1 + 0.15 * straight)) / SEGS;
  let x = T.fx * W + drift;
  let y = H + 0.05 * H - rise;
  const pts: Pt[] = [[x, y]];
  for (let k = 0; k < SEGS; k++) {
    const f = k / SEGS;
    const wave = (Math.sin(t * T.speed - f * T.k + T.phase) + 0.45 * Math.sin(t * T.speed * 1.7 - f * T.k * 1.9 + T.phase * 2)) * T.amp * (0.15 + f) * (1 - 0.9 * straight);
    const a = lean + wave + T.curl * curlAmount * f * f * f * T.dir * 1.2;
    x += Math.cos(a) * seg;
    y += Math.sin(a) * seg;
    pts.push([x, y]);
  }
  return pts;
}

/** A smooth curve through `pts` (quadratic segments joined at the midpoints), continuing a path already at pts[0]. */
function smooth(pts: Pt[]): string {
  let d = '';
  for (let i = 1; i < pts.length - 1; i++) {
    const [x, y] = pts[i];
    const [nx, ny] = pts[i + 1];
    d += `Q${x.toFixed(1)} ${y.toFixed(1)} ${((x + nx) / 2).toFixed(1)} ${((y + ny) / 2).toFixed(1)}`;
  }
  const last = pts[pts.length - 1];
  return `${d}L${last[0].toFixed(1)} ${last[1].toFixed(1)}`;
}

/**
 * Giant tentacles swimming and curling at the bottom of the screen, above everything else. They are animated in a
 * frame loop (the outline changes every frame) and written straight to the DOM, not through React.
 * `straight` is read live from a ref; the layer lets clicks through except on the tentacles themselves.
 */
function Tentacles({ straightRef, onPoke, animate }: { straightRef: { current: boolean }; onPoke: () => void; animate: boolean }) {
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const bodies = useRef<(SVGPathElement | null)[]>([]);
  const rims = useRef<(SVGPathElement | null)[]>([]);
  const hits = useRef<(SVGPathElement | null)[]>([]);
  const suckers = useRef<(SVGCircleElement | null)[][]>(TENTACLES.map(() => []));

  useEffect(() => {
    const { w: W, h: H } = size;
    let raf = 0;
    let last = 0;
    let straight = 0;
    const draw = (t: number) => {
      TENTACLES.forEach((T, i) => {
        const pts = tentaclePose(T, t, straight, W, H);
        const left: Pt[] = [];
        const right: Pt[] = [];
        pts.forEach(([x, y], k) => {
          const [px, py] = pts[Math.max(0, k - 1)];
          const [nx, ny] = pts[Math.min(pts.length - 1, k + 1)];
          const tx = nx - px;
          const ty = ny - py;
          const len = Math.hypot(tx, ty) || 1;
          const w = (T.fw * H * Math.pow(1 - k / SEGS, 0.8) * 0.5) + 2;
          const ox = (-ty / len) * w;
          const oy = (tx / len) * w;
          left.push([x + ox, y + oy]);
          right.push([x - ox, y - oy]);
          const circle = suckers.current[i][k];
          if (circle) {
            circle.setAttribute('cx', (x + ox * 0.2).toFixed(1));
            circle.setAttribute('cy', (y + oy * 0.2).toFixed(1));
            circle.setAttribute('r', Math.max(1, w * 0.26).toFixed(1));
          }
        });
        const rev = right.slice().reverse();
        bodies.current[i]?.setAttribute('d', `M${left[0][0].toFixed(1)} ${left[0][1].toFixed(1)}${smooth(left)}L${rev[0][0].toFixed(1)} ${rev[0][1].toFixed(1)}${smooth(rev)}Z`);
        rims.current[i]?.setAttribute('d', `M${left[0][0].toFixed(1)} ${left[0][1].toFixed(1)}${smooth(left)}`);
        hits.current[i]?.setAttribute('d', `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}${smooth(pts)}`);
      });
    };
    if (!animate) {
      draw(0);
      return;
    }
    const tick = (ms: number) => {
      const dt = last ? Math.min(0.05, (ms - last) / 1000) : 0.016;
      last = ms;
      straight += ((straightRef.current ? 1 : 0) - straight) * (1 - Math.exp(-dt * 5));
      draw(ms / 1000);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [animate, straightRef, size]);

  return (
    <svg className="moria__tent-layer" viewBox={`0 0 ${size.w} ${size.h}`} preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id="moria-tent" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#1b3650" />
          <stop offset="0.5" stopColor="#2f5c78" />
          <stop offset="1" stopColor="#152b40" />
        </linearGradient>
      </defs>
      {TENTACLES.map((T, i) => (
        <g key={i} className="moria__tent" onClick={onPoke}>
          <path ref={(el) => void (bodies.current[i] = el)} fill="url(#moria-tent)" stroke="#07111d" strokeWidth={3} strokeLinejoin="round" />
          <path ref={(el) => void (rims.current[i] = el)} fill="none" stroke="#9fd0ff" strokeWidth={2.4} opacity={0.38} strokeLinecap="round" />
          {Array.from({ length: SEGS + 1 }, (_, k) =>
            k >= 3 && k < SEGS - 2 && k % 2 === 1 ? <circle key={k} ref={(el) => void (suckers.current[i][k] = el)} fill="#9cc4d8" stroke="#0c1a2a" strokeWidth={1.2} opacity={0.8} /> : null,
          )}
          <path ref={(el) => void (hits.current[i] = el)} className="moria__tent-hit" fill="none" stroke="transparent" strokeWidth={Math.max(40, T.fw * size.h)} strokeLinecap="round" />
        </g>
      ))}
    </svg>
  );
}

type Props = {
  /** The right PIN: the doors swing open and the light floods out. */
  open: boolean;
  /** Changes on every wrong PIN: the light stutters and Gollum ducks. */
  panicKey: number;
  /** The PIN field, set into the stone threshold. */
  children: ReactNode;
  /** Shown on the steps just below the threshold: the error line and the "forgot PIN" button. */
  below?: ReactNode;
};

/**
 * Lock-screen scene: the Doors of Durin glowing in a mountain wall between two ancient trees, a lake in front,
 * a company led by a grey wizard walking up the bank, and a small, pale creature lurking at the water's edge.
 * Original drawing, pure SVG + CSS.
 */
export function LockMoria({ open, panicKey, children, below }: Props) {
  // Click the lurker and he hops about for a moment.
  const [jumpId, setJumpId] = useState(0);
  const [jumping, setJumping] = useState(false);
  const jumpTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(jumpTimer.current), []);
  // Poke a tentacle: it uncurls and stretches up, and everyone on the bank jumps in fright.
  const [poked, setPoked] = useState(false);
  const pokedRef = useRef(false);
  const pokeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(pokeTimer.current), []);
  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const pokeKraken = () => {
    pokedRef.current = true;
    setPoked(true);
    startJump();
    clearTimeout(pokeTimer.current);
    pokeTimer.current = setTimeout(() => {
      pokedRef.current = false;
      setPoked(false);
    }, 2600);
  };
  const startJump = () => {
    setJumpId((n) => n + 1);
    setJumping(true);
    clearTimeout(jumpTimer.current);
    jumpTimer.current = setTimeout(() => setJumping(false), 1900);
  };

  return (
    <div className={`moria${open ? ' moria--open' : ''}`}>
      <div className="moria__stage">
        <svg className="moria__svg" viewBox="0 0 1600 900" aria-hidden>
          <defs>
            <FellowshipDefs />
            <linearGradient id="moria-sky" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#070d1c" />
              <stop offset="1" stopColor="#14223c" />
            </linearGradient>
            <pattern id="moria-rock" width="150" height="100" patternUnits="userSpaceOnUse">
              <rect width="150" height="100" fill="#172640" />
              <path d="M0 0H150M0 50H150M75 0V50M30 50V100M120 50V100" fill="none" stroke="#0a1220" strokeWidth="3" />
              <path d="M8 8H66M84 14H140M10 62H22M64 58H110M130 70H144" fill="none" stroke="#223656" strokeWidth="2" opacity="0.7" />
            </pattern>
            <pattern id="moria-door" width="70" height="46" patternUnits="userSpaceOnUse">
              <rect width="70" height="46" fill="#2a4067" />
              <path d="M0 0H70M0 23H70M35 0V23M0 23V46M70 23V46" fill="none" stroke="#1a2a47" strokeWidth="2" />
            </pattern>
            <radialGradient id="moria-halo" cx="0.5" cy="0.5" r="0.5">
              <stop offset="0" stopColor="#6fb4ff" stopOpacity="0.55" />
              <stop offset="1" stopColor="#6fb4ff" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="moria-burst" cx="0.5" cy="0.5" r="0.5">
              <stop offset="0" stopColor="#ffffff" />
              <stop offset="0.5" stopColor="#bfe3ff" />
              <stop offset="1" stopColor="#6fb4ff" stopOpacity="0" />
            </radialGradient>
            <linearGradient id="moria-lake" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#0e1c33" />
              <stop offset="1" stopColor="#060b16" />
            </linearGradient>
            <linearGradient id="moria-reflect" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#7fc0ff" stopOpacity="0.55" />
              <stop offset="1" stopColor="#7fc0ff" stopOpacity="0" />
            </linearGradient>
            <filter id="moria-glow" x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="3.2" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <clipPath id="moria-rise">
              <rect className="moria__rise-clip" x={640} y={236} width={320} height={BASE - 236} />
            </clipPath>
            <clipPath id="moria-gollum-clip">
              <rect x={-120} y={-240} width={240} height={252} />
            </clipPath>
            <clipPath id="moria-reveal">
              <rect className="moria__reveal" x={560} y={120} width={480} height={620} />
            </clipPath>
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
          </defs>

          {/* the night, far beyond the edges of the 16:9 frame so any window shape is covered */}
          <rect x={-2400} y={-1400} width={6400} height={3400} fill="url(#moria-sky)" />

          {/* the mountain wall */}
          <rect x={-2400} y={-1400} width={6400} height={2040} fill="url(#moria-rock)" />
          <rect x={-2400} y={-1400} width={6400} height={2040} fill="#050a16" opacity={0.35} />
          <ellipse cx={CX} cy={430} rx={620} ry={420} fill="url(#moria-halo)" />

          {/* the gate: frame, pillars, door */}
          <path d={`M${CX - 205} ${BASE}V${SPRING}A205 205 0 0 1 ${CX + 205} ${SPRING}V${BASE}ZM${CX - R_IN} ${BASE}V${SPRING}A${R_IN} ${R_IN} 0 0 1 ${CX + R_IN} ${SPRING}V${BASE}Z`} fill="#243959" fillRule="evenodd" stroke="#0a1220" strokeWidth={4} />
          <rect x={CX - 196} y={SPRING} width={40} height={BASE - SPRING} fill="#2c456e" stroke="#0a1220" strokeWidth={3} />
          <rect x={CX + 156} y={SPRING} width={40} height={BASE - SPRING} fill="#2c456e" stroke="#0a1220" strokeWidth={3} />

          <g clipPath="url(#moria-doorway)">
            {/* light that pours out once the doors open */}
            <rect x={CX - R_IN} y={SPRING - R_IN} width={R_IN * 2} height={R_IN * 2 + (BASE - SPRING)} fill="url(#moria-burst)" />
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

          {/* the carving: faintly there from the start, then lit from the left foot across to the right foot */}
          <g key={panicKey} className={`moria__glow${panicKey ? ' moria__glow--stutter' : ''}`}>
            <use href="#moria-frame" opacity={0.16} />
            <use href="#moria-inner" opacity={0.16} />
            <g clipPath="url(#moria-reveal)">
              <g className="moria__lit" filter="url(#moria-glow)">
                <use href="#moria-frame" />
              </g>
            </g>
            <g clipPath="url(#moria-rise)">
              <g className="moria__lit" filter="url(#moria-glow)">
                <use href="#moria-inner" />
              </g>
            </g>
            <circle className="moria__spark" r={9} fill="#ffffff" filter="url(#moria-glow)" />
            <ellipse className="moria__rise-bar" cx={CX} cy={BASE - 4} rx={165} ry={9} fill="#e6f5ff" filter="url(#moria-glow)" />
          </g>

          {/* the two old trees either side of the gate: dense crowns, bark, and light running through the wood */}
          {[false, true].map((m) => {
            const tree = m ? TREE_R : TREE_L;
            return (
              <g key={String(m)} transform={m ? `translate(${CX * 2} 0) scale(-1 1)` : undefined}>
                {/* roots */}
                <path d="M356 772C330 760 312 770 280 752M366 764C346 790 320 790 296 806M552 772C580 762 604 772 640 756M540 768C560 792 590 794 616 808M404 760C396 786 384 796 372 812" fill="none" stroke="#0a1424" strokeWidth={13} strokeLinecap="round" />
                <path d="M356 772C330 760 312 770 280 752M552 772C580 762 604 772 640 756" fill="none" stroke="#7db8ff" strokeWidth={2} strokeLinecap="round" opacity={0.28} transform="translate(2 -3)" />
                {/* trunk */}
                <path d="M352 774C372 732 388 692 392 642C396 592 380 562 388 522C396 482 380 452 390 412C400 372 392 332 404 292C410 272 416 260 428 252L492 248C500 264 504 292 500 322C496 362 508 402 502 442C496 482 508 522 502 562C496 602 512 652 524 692C534 724 548 748 566 774Z" fill="#0a1424" stroke="#070d1a" strokeWidth={3} />
                {/* bark furrows */}
                <g fill="none" strokeLinecap="round">
                  <path d="M412 300C404 380 418 460 408 540C400 610 416 680 406 750M436 270C430 350 444 430 436 520C428 600 442 680 434 760M462 262C458 340 470 430 462 520C456 610 466 690 458 764" stroke="#050a14" strokeWidth={2.6} opacity={0.8} />
                  <path d="M424 300C418 380 430 460 422 540M450 280C446 360 458 440 450 530M478 270C476 350 486 440 480 530" stroke="#1b2f52" strokeWidth={1.8} opacity={0.75} />
                  <path d="M394 540C410 548 420 540 432 552M476 600C490 592 498 598 504 610M404 440C418 448 428 440 440 452" stroke="#050a14" strokeWidth={2} />
                </g>
                <ellipse cx={444} cy={430} rx={14} ry={20} fill="#06101f" stroke="#1b2f52" strokeWidth={2} />
                <ellipse cx={444} cy={430} rx={7} ry={11} fill="none" stroke="#1b2f52" strokeWidth={1.5} />
                {/* light from the gate pooling on the bark, and glowing sap rising towards the crown */}
                <path d="M498 300C506 380 494 440 500 520C506 600 492 680 536 756" fill="none" stroke="#7db8ff" strokeWidth={5} opacity={0.4} filter="url(#moria-glow)" />
                <g fill="none" stroke={GLOW} strokeLinecap="round" filter="url(#moria-glow)">
                  <path className="moria__vein" d="M470 770C462 710 480 650 470 590C460 530 480 480 472 420C464 360 482 318 474 266" strokeWidth={2.4} />
                  <path className="moria__vein moria__vein--b" d="M424 770C430 700 414 640 426 580C436 520 418 470 430 410" strokeWidth={1.8} />
                  <path className="moria__vein moria__vein--c" d="M510 700C504 640 516 590 506 530" strokeWidth={1.6} />
                </g>
                {/* branches: dark wood, a faint blue rim on the gate side, and glints on the twig tips */}
                {tree.dark.map((b) => (
                  <path key={b.w} d={b.d} fill="none" stroke="#0a1424" strokeWidth={b.w} strokeLinecap="round" />
                ))}
                {tree.rim.map((b) => (
                  <path key={`r${b.w}`} d={b.d} fill="none" stroke="#7db8ff" strokeWidth={b.w} strokeLinecap="round" opacity={0.34} transform="translate(2.5 -1.5)" />
                ))}
                <g fill="#bfe3ff" filter="url(#moria-glow)">
                  {tree.tips.map(([x, y], i) => (
                    <circle key={i} className="moria__tip" cx={x} cy={y} r={1.8} style={{ ['--d' as string]: `${((i * 0.37) % 4).toFixed(2)}s` } as CSSProperties} />
                  ))}
                </g>
                <ellipse cx={456} cy={776} rx={120} ry={16} fill="url(#moria-halo)" opacity={0.7} />
              </g>
            );
          })}

          {/* the bank, the steps to the threshold and the lake */}
          <path d={`M-2400 700C-1000 690 200 688 560 664L${CX - 260} ${BASE + 8}H${CX + 260}L1040 664C1400 688 2600 690 4000 700V800H-2400Z`} fill="#0c1730" />
          <path d={`M${CX - 250} ${BASE + 8}H${CX + 250}L${CX + 290} 668H${CX - 290}Z`} fill="#16264a" stroke="#0a1220" strokeWidth={3} />
          <path d={`M${CX - 290} 668H${CX + 290}L${CX + 340} 700H${CX - 340}Z`} fill="#1b2e56" stroke="#0a1220" strokeWidth={3} />
          <path d={`M${CX - 340} 700H${CX + 340}L${CX + 400} 736H${CX - 400}Z`} fill="#20365f" stroke="#0a1220" strokeWidth={3} />
          <ellipse cx={CX} cy={760} rx={900} ry={50} fill="url(#moria-halo)" opacity={0.5} />
          <path d="M-2400 790C-900 776 200 780 800 788C1400 780 2400 776 4000 790V1900H-2400Z" fill="url(#moria-lake)" />
          <path d={`M${CX - 150} 792H${CX + 150}L${CX + 260} 1000H${CX - 260}Z`} fill="url(#moria-reflect)" className="moria__reflect" />
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <ellipse key={i} className="moria__ripple" cx={360 + i * 190} cy={830 + (i % 3) * 22} rx={70 + (i % 2) * 20} ry={9} fill="none" stroke="#7fb6ff" strokeWidth={2} style={{ animationDelay: `${i * 0.9}s` }} />
          ))}
          {[0, 1, 2, 3].map((i) => (
            <path key={`w${i}`} className="moria__wave" d={`M${200 + i * 360} ${850 + i * 14}q30 -8 60 0t60 0t60 0`} fill="none" stroke="#6fa8f0" strokeWidth={2} opacity={0.35} style={{ animationDelay: `${i * 0.6}s` }} />
          ))}

          {/* the company, walking towards the gate */}
          <g className={`moria__company${poked ? ' moria__company--hop' : ''}`}>
            {WALKERS.slice()
              .reverse()
              .map((w, i) => (
                <g key={i} transform={`translate(${w.x} ${w.y}) scale(${w.s})`}>
                  <g className="moria__walker" style={{ ['--i' as string]: i } as CSSProperties}>
                    <Figure kind={w.kind} />
                  </g>
                </g>
              ))}
          </g>

          {/* the lurker: a pale, bony creature hiding among the rocks at the water's edge. Click him and he hops about. */}
          <g transform="translate(1448 818)">
            <path d="M-120 18Q-124 -10 -98 -22Q-70 -28 -56 -8Q-48 8 -52 18Z" fill="#0f1b32" stroke="#070d1a" strokeWidth={3} />
            <path d="M80 18Q76 -14 104 -30Q132 -36 146 -12Q152 6 146 18Z" fill="#0f1b32" stroke="#070d1a" strokeWidth={3} />
            <g clipPath="url(#moria-gollum-clip)">
            <g key={`g${panicKey}-${jumpId}`} className={`moria__gollum${panicKey ? ' moria__gollum--scared' : ''}${jumping ? ' moria__gollum--jump' : ''}`}>
              <g className="moria__jumper">
                <g className="moria__peek">
                  <g className="moria__fidget">
                    {/* legs, folded */}
                    <path d="M-4 -4Q-22 -10 -16 -26M10 -4Q28 -10 22 -26" fill="none" stroke="#8d998a" strokeWidth={6} strokeLinecap="round" />
                    <ellipse cx={-6} cy={-1} rx={9} ry={4} fill="#8d998a" stroke="#0c1424" strokeWidth={1.4} />
                    <ellipse cx={12} cy={-1} rx={9} ry={4} fill="#8d998a" stroke="#0c1424" strokeWidth={1.4} />
                    {/* hunched, bony back */}
                    <path d="M-16 -28Q-14 -52 4 -58Q24 -56 26 -34Q22 -16 4 -14Q-12 -16 -16 -28Z" fill="#9aa592" stroke="#0c1424" strokeWidth={2} />
                    <path d="M8 -56L12 -52M14 -52L18 -47M18 -46L22 -40M20 -38L23 -32" fill="none" stroke="#6f7a6c" strokeWidth={2} strokeLinecap="round" />
                    <path d="M-14 -22Q-2 -18 14 -22L10 -14Q-2 -12 -12 -14Z" fill="#5a4630" stroke="#0c1424" strokeWidth={1.2} />
                    {/* arms reaching for the rock */}
                    <path d="M-10 -48Q-30 -52 -36 -38M10 -50Q-6 -52 -12 -38" fill="none" stroke="#9aa592" strokeWidth={5} strokeLinecap="round" />
                    {/* head */}
                    <g className="moria__gollum-head">
                      <path d="M-18 -78L-34 -88L-24 -66Z" fill="#9aa592" stroke="#0c1424" strokeWidth={1.6} strokeLinejoin="round" />
                      <path d="M12 -80L28 -92L18 -68Z" fill="#9aa592" stroke="#0c1424" strokeWidth={1.6} strokeLinejoin="round" />
                      <ellipse cx={-4} cy={-74} rx={18} ry={20} fill="#a9b4a0" stroke="#0c1424" strokeWidth={2} />
                      <path d="M-14 -92Q-10 -102 -6 -92M-2 -94Q4 -104 8 -94" fill="none" stroke="#6f7a6c" strokeWidth={1.8} strokeLinecap="round" />
                      <ellipse cx={-14} cy={-77} rx={8.5} ry={10} fill="#eef6ff" stroke="#0c1424" strokeWidth={1.5} />
                      <ellipse cx={6} cy={-79} rx={8.5} ry={10} fill="#eef6ff" stroke="#0c1424" strokeWidth={1.5} />
                      <circle className="moria__gollum-eye" cx={-16} cy={-76} r={3.6} fill="#27487a" />
                      <circle className="moria__gollum-eye" cx={4} cy={-78} r={3.6} fill="#27487a" />
                      <circle className="moria__gollum-eye" cx={-17} cy={-77.5} r={1.1} fill="#fff" />
                      <circle className="moria__gollum-eye" cx={3} cy={-79.5} r={1.1} fill="#fff" />
                      <path d="M-24 -90Q-14 -96 -6 -88M12 -92Q2 -96 -2 -90" fill="none" stroke="#4a5446" strokeWidth={2.4} strokeLinecap="round" />
                      <ellipse cx={-4} cy={-68} rx={2.6} ry={2} fill="#7b8678" />
                      <path d="M-14 -61Q-4 -55 8 -62" fill="#2a1a1a" stroke="#0c1424" strokeWidth={1.6} />
                      <path d="M-6 -60L-5 -56L-3 -60M2 -61L3 -57L5 -61" fill="#f4f1e6" />
                    </g>
                  </g>
                </g>
                {/* clutching hands, in front of the rock */}
                <g className="moria__peek">
                  <g className="moria__fidget">
                    <path d="M-40 -38Q-38 -42 -34 -38M-36 -36L-42 -32M-34 -36L-38 -30M-32 -37L-33 -30" fill="none" stroke="#9aa592" strokeWidth={3} strokeLinecap="round" />
                    <path d="M-16 -38Q-12 -42 -8 -38M-12 -36L-18 -32M-10 -36L-14 -30M-8 -37L-9 -30" fill="none" stroke="#9aa592" strokeWidth={3} strokeLinecap="round" />
                  </g>
                </g>
              </g>
            </g>
            </g>
            {/* mossy, weedy rocks in front of him, hiding his body */}
            <path d="M-62 20Q-66 -14 -34 -30Q-4 -40 30 -34Q70 -24 74 20Z" fill="#101c33" stroke="#070d1a" strokeWidth={3} />
            <path d="M-58 4Q-56 -16 -34 -28Q-4 -38 28 -32Q52 -26 66 -10Q40 -16 12 -16Q-20 -18 -58 4Z" fill="#2d5a44" opacity={0.92} />
            <path d="M-40 -22Q-20 -34 4 -34Q-10 -26 -22 -20Q-30 -16 -40 -22Z" fill="#4c8a62" opacity={0.85} />
            <path d="M-34 -26Q-6 -34 24 -28" fill="none" stroke="#7db8ff" strokeWidth={2.4} opacity={0.35} strokeLinecap="round" />
            <path d="M-170 20Q-172 4 -154 -2Q-134 -6 -124 8Q-120 16 -122 20Z" fill="#0f1b32" stroke="#070d1a" strokeWidth={2.5} />
            <path d="M-166 8Q-160 -2 -142 -2Q-130 0 -128 8Q-146 4 -166 8Z" fill="#2d5a44" opacity={0.9} />
            <path d="M150 20Q150 8 164 4Q182 2 190 14Q192 18 190 20Z" fill="#0f1b32" stroke="#070d1a" strokeWidth={2.5} />
            <path d="M-96 20Q-100 -2 -76 -10Q-52 -14 -34 2Q-26 12 -30 20Z" fill="#101c33" stroke="#070d1a" strokeWidth={2.5} />
            <path d="M-92 6Q-82 -6 -62 -6Q-46 -4 -36 4Q-60 0 -92 6Z" fill="#35684e" opacity={0.9} />
            <path d="M40 22Q38 0 62 -6Q88 -10 100 8Q104 16 100 22Z" fill="#101c33" stroke="#070d1a" strokeWidth={2.5} />
            <path d="M46 8Q54 -2 72 -2Q88 0 96 8Q72 2 46 8Z" fill="#2d5a44" opacity={0.9} />
            {/* trailing weed */}
            <g fill="none" strokeLinecap="round">
              {[[-50, -18, 28], [-20, -28, 36], [10, -30, 32], [40, -22, 30], [-84, -6, 26], [64, -4, 24], [-148, 0, 22]].map(([x, y, h], i) => (
                <path key={i} className="moria__weed" d={`M${x} ${y}Q${x - 6} ${y + h * 0.5} ${x - 2} ${y + h}`} stroke={i % 2 ? '#3f7a55' : '#2a5a40'} strokeWidth={3.2 - (i % 3) * 0.5} style={{ ['--d' as string]: `${(i * 0.43) % 3}s` } as CSSProperties} />
              ))}
            </g>
            {[[-190, 22, 8], [-100, 24, 6], [100, 26, 7], [200, 24, 5], [20, 28, 6]].map(([x, y, r], i) => (
              <ellipse key={i} cx={x} cy={y} rx={r * 1.6} ry={r} fill="#0f1b32" stroke="#070d1a" strokeWidth={2} />
            ))}
            <circle cx={12} cy={-52} r={86} fill="transparent" className="moria__hit" onClick={startJump} />
          </g>

          {/* sparkles over the carving, and motes drifting up from the water */}
          <g fill="#dff1ff" filter="url(#moria-glow)">
            {TWINKLES.map((t, i) => (
              <path key={i} className="moria__twinkle" d={star4(t.x, t.y, t.s)} style={{ ['--d' as string]: `${t.delay.toFixed(2)}s` } as CSSProperties} />
            ))}
          </g>
          {MOTES.map((m, i) => (
            <circle
              key={i}
              className="moria__mote"
              cx={`${m.x}%`}
              cy={880}
              r={m.size}
              fill="#9fd0ff"
              style={{ ['--dur' as string]: `${m.dur.toFixed(1)}s`, ['--delay' as string]: `${m.delay.toFixed(1)}s`, ['--dx' as string]: `${m.dx.toFixed(0)}px` } as CSSProperties}
            />
          ))}

          {/* the doors fling open: a flash of white light */}
          {open && <circle className="moria__burst" cx={CX} cy={500} r={140} fill="url(#moria-burst)" />}
        </svg>

        <div className="moria__pin">{children}</div>
        {below && <div className="moria__below">{below}</div>}
      </div>
      <Tentacles straightRef={pokedRef} onPoke={pokeKraken} animate={!reduced} />
      {open && <div className="moria__flash" />}
    </div>
  );
}
