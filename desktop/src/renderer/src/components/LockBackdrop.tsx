/** Cheap seeded noise: scattered, but the same on every render. */
const noise = (i: number, k: number) => {
  const v = Math.sin(i * 97.13 + k * 12.9898) * 43758.5453;
  return v - Math.floor(v);
};

const ASH = Array.from({ length: 48 }, (_, i) => ({
  x: noise(i, 1) * 100,
  size: 2 + noise(i, 2) * 4.5,
  dur: 9 + noise(i, 3) * 10,
  delay: -noise(i, 4) * 19,
  dx: (noise(i, 5) - 0.4) * 160,
}));

const EMBERS = Array.from({ length: 34 }, (_, i) => ({
  x: noise(i + 100, 1) * 100,
  size: 2 + noise(i + 100, 2) * 3,
  dur: 5 + noise(i + 100, 3) * 5,
  delay: -noise(i + 100, 4) * 10,
  dx: (noise(i + 100, 5) - 0.5) * 120,
}));

const METEORS = Array.from({ length: 7 }, (_, i) => ({
  x: 35 + noise(i + 200, 1) * 75,
  len: 120 + noise(i + 200, 2) * 160,
  thick: 3 + noise(i + 200, 3) * 4,
  cycle: 7 + noise(i + 200, 4) * 7,
  delay: -noise(i + 200, 5) * 12,
}));

/** Tongues of fire along the bottom edge, some licking high up the sides of the bridge. */
const FLAMES = Array.from({ length: 46 }, (_, i) => ({
  x: ((i + noise(i + 300, 1) * 0.9) / 46) * 100 - 3,
  w: 6 + noise(i + 300, 2) * 9,
  h: 10 + noise(i + 300, 3) * 30,
  dur: 0.45 + noise(i + 300, 4) * 0.7,
  delay: -noise(i + 300, 5) * 2,
  hot: noise(i + 300, 6) > 0.6,
}));

/** A taller, darker wall of fire behind the front flames, swaying slowly. */
const BACK_FLAMES = Array.from({ length: 22 }, (_, i) => ({
  x: ((i + noise(i + 400, 1) * 0.8) / 22) * 100 - 5,
  w: 12 + noise(i + 400, 2) * 12,
  h: 30 + noise(i + 400, 3) * 34,
  dur: 0.9 + noise(i + 400, 4) * 0.9,
  delay: -noise(i + 400, 5) * 2,
}));

/** Sparks thrown up out of the fire, flickering as they rise and fade. */
const SPARKS = Array.from({ length: 40 }, (_, i) => ({
  x: noise(i + 500, 1) * 100,
  size: 2 + noise(i + 500, 2) * 3.5,
  dur: 1.6 + noise(i + 500, 3) * 2.2,
  delay: -noise(i + 500, 4) * 4,
  dx: (noise(i + 500, 5) - 0.5) * 140,
  rise: 30 + noise(i + 500, 6) * 45,
}));

type Vars = Record<`--${string}`, string>;
const vars = (v: Vars) => v as React.CSSProperties;

/**
 * Full-screen sky for the lock screen: a smouldering dusk with ash and red embers drifting down and meteors
 * streaking across. Purely decorative; hidden when the user prefers reduced motion.
 */
export function LockBackdrop() {
  return (
    <div className="lockbg" aria-hidden>
      <div className="lockbg__fireglow" />
      {BACK_FLAMES.map((f, i) => (
        <span key={`b${i}`} className="lockbg__flame lockbg__flame--back" style={vars({ '--x': `${f.x.toFixed(1)}%`, '--w': `${f.w.toFixed(1)}vw`, '--h': `${f.h.toFixed(1)}vh`, '--dur': `${f.dur.toFixed(2)}s`, '--delay': `${f.delay.toFixed(2)}s` })} />
      ))}
      {FLAMES.map((f, i) => (
        <span key={`f${i}`} className={`lockbg__flame${f.hot ? ' lockbg__flame--hot' : ''}`} style={vars({ '--x': `${f.x.toFixed(1)}%`, '--w': `${f.w.toFixed(1)}vw`, '--h': `${f.h.toFixed(1)}vh`, '--dur': `${f.dur.toFixed(2)}s`, '--delay': `${f.delay.toFixed(2)}s` })} />
      ))}
      {SPARKS.map((p, i) => (
        <span key={`s${i}`} className="lockbg__spark" style={vars({ '--x': `${p.x.toFixed(1)}%`, '--s': `${p.size.toFixed(1)}px`, '--dur': `${p.dur.toFixed(2)}s`, '--delay': `${p.delay.toFixed(2)}s`, '--dx': `${p.dx.toFixed(0)}px`, '--rise': `${p.rise.toFixed(0)}vh` })} />
      ))}
      <div className="lockbg__flicker" />
      {ASH.map((p, i) => (
        <span key={`a${i}`} className="lockbg__p lockbg__p--ash" style={vars({ '--x': `${p.x.toFixed(1)}%`, '--s': `${p.size.toFixed(1)}px`, '--dur': `${p.dur.toFixed(1)}s`, '--delay': `${p.delay.toFixed(1)}s`, '--dx': `${p.dx.toFixed(0)}px` })} />
      ))}
      {EMBERS.map((p, i) => (
        <span key={`e${i}`} className="lockbg__p lockbg__p--ember" style={vars({ '--x': `${p.x.toFixed(1)}%`, '--s': `${p.size.toFixed(1)}px`, '--dur': `${p.dur.toFixed(1)}s`, '--delay': `${p.delay.toFixed(1)}s`, '--dx': `${p.dx.toFixed(0)}px` })} />
      ))}
      {METEORS.map((m, i) => (
        <span key={`m${i}`} className="lockbg__meteor" style={vars({ '--x': `${m.x.toFixed(1)}%`, '--len': `${m.len.toFixed(0)}px`, '--th': `${m.thick.toFixed(1)}px`, '--cycle': `${m.cycle.toFixed(1)}s`, '--delay': `${m.delay.toFixed(1)}s` })} />
      ))}
    </div>
  );
}
