import type { ReactNode } from 'react';
import { BASE, CX, DoorBody, DoorDefs, noise } from './MoriaDoor';

type Props = {
  /** True once the right PIN was entered: the doors swing open and light floods out. */
  open: boolean;
  /** Changes on every wrong PIN: the lights of the door stutter. */
  panicKey: number;
  /** The PIN input; it sits on the body of the door, below the star. */
  children: ReactNode;
  /** The error line and the "forgot PIN" button. */
  below?: ReactNode;
};

/** The part of the 1600 x 900 scene that holds the gate (its arch, runes, pillars and the wall around them) and the ground at its foot. */
const VIEW = { x: 525, y: 190, w: 550, h: 560 };
const VIEW_BOX = `${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}`;

/** A rough, angular stone: an irregular polygon with a flat-ish underside, so it sits on the ground. `seed` picks its shape. */
function stonePath(cx: number, cy: number, rx: number, ry: number, seed: number): string {
  const points = Array.from({ length: 8 }, (_, k) => {
    const a = (k / 8) * 2 * Math.PI + (noise(seed, k) - 0.5) * 0.55;
    const r = 0.74 + noise(seed + 20, k) * 0.36;
    return `${(cx + rx * r * Math.cos(a)).toFixed(1)} ${Math.min(cy + ry * r * Math.sin(a), cy + ry * 0.5).toFixed(1)}`;
  });
  return `M${points.join('L')}Z`;
}

/** Rubble at the foot of the gate: [x, y, half-width, half-height]. Bigger ones to the sides, pebbles in front of the door. */
const STONES: [number, number, number, number][] = [
  [572, 686, 46, 25], [640, 708, 31, 17], [702, 726, 21, 12], [540, 722, 24, 13], [608, 738, 16, 8],
  [1028, 688, 44, 24], [962, 710, 30, 16], [902, 728, 20, 11], [1060, 724, 22, 12], [992, 740, 15, 8],
  [764, 730, 13, 7], [852, 734, 15, 8], [808, 716, 10, 6], [732, 718, 9, 5], [886, 722, 10, 5.5],
];
const STONE_FILLS = ['#1d2f4f', '#16243f', '#22375a'];

/**
 * The lock screen on a phone: the Doors of Durin and nothing else. The full scene (lake, company, trees, tentacles, drifting light)
 * is too heavy for a phone's browser, so none of it is drawn. The door is the same drawing as in LockMoria (MoriaDoor.tsx), drawn a
 * little taller (the SVG is stretched), with the PIN on its body. At its foot lie a worn threshold slab and rough stones, and light
 * spills out of the doorway onto them.
 *
 * The carving is lit by a second, transparent SVG laid over the first. It is painted once, glow filter included, and its opacity is
 * all that changes ("stage lighting", as in the full scene), so the flicker is composited, not repainted. A wrong PIN makes it
 * stutter; the right one swings the leaves open and floods the screen with light, like the full scene. The spilled light is part of
 * that same lit layer, so it flickers and stutters with the carving at no extra cost.
 */
export function LockGate({ open, panicKey, children, below }: Props) {
  return (
    <div className={`gate${open ? ' gate--open' : ''}`}>
      <div className="gate__halo" aria-hidden />
      <div className="gate__door">
        <svg className="gate__base" viewBox={VIEW_BOX} preserveAspectRatio="none" aria-hidden>
          <defs>
            <DoorDefs />
            <linearGradient id="gate-ground" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#0f192e" />
              <stop offset="1" stopColor="#070d1c" />
            </linearGradient>
            <linearGradient id="gate-spill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#bfe3ff" stopOpacity="0.6" />
              <stop offset="0.55" stopColor="#8fd0ff" stopOpacity="0.2" />
              <stop offset="1" stopColor="#8fd0ff" stopOpacity="0" />
            </linearGradient>
            <radialGradient id="gate-spill-hot" cx="0.5" cy="0.5" r="0.5">
              <stop offset="0" stopColor="#ffffff" stopOpacity="0.9" />
              <stop offset="1" stopColor="#bfe3ff" stopOpacity="0" />
            </radialGradient>
          </defs>
          {/* the mountain wall around the door */}
          <rect x={VIEW.x} y={VIEW.y} width={VIEW.w} height={VIEW.h} fill="url(#moria-rock)" />
          <rect x={VIEW.x} y={VIEW.y} width={VIEW.w} height={VIEW.h} fill="#050a16" opacity={0.35} />
          <DoorBody burst />
          {/* the carving, faintly there; the lit copy is the other SVG */}
          <use href="#moria-frame" opacity={0.16} />
          <use href="#moria-inner" opacity={0.16} />
          {/* the ground at the foot of the gate: worn threshold slab, then rough stones */}
          <rect x={VIEW.x} y={BASE} width={VIEW.w} height={VIEW.y + VIEW.h - BASE} fill="url(#gate-ground)" />
          <path d={`M${CX - 206} ${BASE}H${CX + 206}L${CX + 214} ${BASE + 14}L${CX + 204} ${BASE + 26}H${CX - 204}L${CX - 216} ${BASE + 13}Z`} fill="#223657" stroke="#0a1220" strokeWidth={2.5} strokeLinejoin="round" />
          <path d={`M${CX - 198} ${BASE + 2}H${CX + 198}`} stroke="#8fd0ff" strokeOpacity={0.5} strokeWidth={1.6} strokeLinecap="round" />
          <path d={`M${CX - 120} ${BASE + 16}L${CX - 70} ${BASE + 20}M${CX + 60} ${BASE + 14}L${CX + 130} ${BASE + 19}`} stroke="#0a1220" strokeWidth={1.6} strokeLinecap="round" />
          <g className="gate__stones">
            {STONES.map(([cx, cy, rx, ry], i) => (
              <g key={i}>
                <path d={stonePath(cx, cy, rx, ry, i)} fill={STONE_FILLS[i % 3]} stroke="#050a14" strokeWidth={1.6} strokeLinejoin="round" />
                <path d={stonePath(cx, cy, rx, ry, i)} fill="rgba(150,200,255,0.26)" stroke="rgba(190,225,255,0.4)" strokeWidth={1.2} strokeLinejoin="round" transform={`translate(${cx} ${cy}) scale(0.62) translate(${-cx - rx * 0.18} ${-cy - ry * 0.45})`} />
              </g>
            ))}
          </g>
          {open && <circle className="moria__burst" cx={CX} cy={500} r={140} fill="url(#moria-burst)" />}
        </svg>
        <svg key={panicKey} className={`gate__lit${panicKey ? ' gate__lit--panic' : ''}`} viewBox={VIEW_BOX} preserveAspectRatio="none" aria-hidden>
          {/* light spilling out of the doorway onto the slab and the stones: a cone widening away from the door, and a hot line at its foot */}
          <g className="gate__spill">
            <path d={`M${CX - 160} ${BASE}H${CX + 160}L${CX + 290} ${VIEW.y + VIEW.h}H${CX - 290}Z`} fill="url(#gate-spill)" />
            <ellipse cx={CX} cy={BASE + 6} rx={200} ry={20} fill="url(#gate-spill-hot)" />
          </g>
          <g filter="url(#moria-glow)">
            <use href="#moria-frame" />
          </g>
          <g filter="url(#moria-glow)">
            <use href="#moria-inner" />
          </g>
        </svg>
        <div className="gate__pin">{children}</div>
      </div>
      {below && <div className="gate__below">{below}</div>}
      {open && <div className="moria__flash" />}
    </div>
  );
}
