import type { CSSProperties } from 'react';

/** Points of a spiky comic-book burst centred on (cx, cy). */
function burst(cx: number, cy: number, outer: number, inner: number, spikes: number): string {
  const pts: string[] = [];
  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (Math.PI * i) / spikes - Math.PI / 2;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(' ');
}

const RAYS = Array.from({ length: 18 }, (_, i) => i);
const DEBRIS = Array.from({ length: 14 }, (_, i) => {
  const a = (i / 14) * Math.PI * 2 + 0.3;
  const d = 190 + (i % 4) * 45;
  return { dx: Math.cos(a) * d, dy: Math.sin(a) * d - 40, rot: (i % 2 ? 1 : -1) * (180 + i * 40), size: 8 + (i % 3) * 4, color: ['#1c1c22', '#d6322b', '#f2c14e', '#6f7f96'][i % 4] };
});

/**
 * Comic-book explosion drawn inside a 480 x 440 SVG, centred on (cx, cy). Plays as soon as it is mounted; set the
 * CSS variable `--boom-delay` on an ancestor to hold it back (e.g. until a thrown bomb lands).
 */
export function Boom({ cx, cy }: { cx: number; cy: number }) {
  return (
    <g className="boom" pointerEvents="none">
      <g className="boom__rays">
        {RAYS.map((i) => {
          const a = (i / RAYS.length) * Math.PI * 2;
          const w = 0.12;
          const p = (ang: number, r: number) => `${(cx + r * Math.cos(ang)).toFixed(1)},${(cy + r * Math.sin(ang)).toFixed(1)}`;
          return <polygon key={i} points={`${p(a - w, 40)} ${p(a, 420)} ${p(a + w, 40)}`} fill="#fff1a8" />;
        })}
      </g>
      <g className="boom__smoke">
        {[-130, -70, 0, 70, 130, 30].map((dx, i) => (
          <circle key={i} className="boom__puff" cx={cx + dx} cy={cy + 10} r={34 + (i % 3) * 8} fill="#6b6b75" style={{ '--puff-x': `${dx * 0.4}px`, '--puff-delay': `${0.15 + i * 0.05}s` } as CSSProperties} />
        ))}
      </g>
      <polygon className="boom__star boom__star--1" points={burst(cx, cy, 215, 120, 14)} fill="#ffd23f" stroke="#1c1c22" strokeWidth={6} strokeLinejoin="round" />
      <polygon className="boom__star boom__star--2" points={burst(cx, cy, 160, 90, 12)} fill="#ff8c1a" stroke="#1c1c22" strokeWidth={4} strokeLinejoin="round" />
      <polygon className="boom__star boom__star--3" points={burst(cx, cy, 95, 55, 10)} fill="#fffbe6" />
      {DEBRIS.map((d, i) => (
        <rect
          key={i}
          className="boom__debris"
          x={cx - d.size / 2}
          y={cy - d.size / 2}
          width={d.size}
          height={d.size}
          fill={d.color}
          stroke="#1c1c22"
          strokeWidth={1.5}
          style={{ '--dx': `${d.dx}px`, '--dy': `${d.dy}px`, '--rot': `${d.rot}deg` } as CSSProperties}
        />
      ))}
      <text
        className="boom__text"
        x={cx}
        y={cy + 22}
        textAnchor="middle"
        fontSize={104}
        fontFamily="Impact, 'Arial Black', sans-serif"
        fontWeight={900}
        fill="#ff3b30"
        stroke="#1c1c22"
        strokeWidth={11}
        paintOrder="stroke"
        strokeLinejoin="round"
        style={{ transformOrigin: `${cx}px calc(${cy - 10}px + var(--lower, 0px))` }}
      >
        BOOM!
      </text>
    </g>
  );
}
