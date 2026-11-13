import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Boom } from './Boom';

/** Seconds from the right PIN until the thrown bomb lands; the explosion is held back until then. */
export const BOMB_LANDS_S = 0.9;

/** Cheap seeded noise: irregular, but identical on every render. */
const noise = (i: number, k: number) => {
  const v = Math.sin(i * 97.13 + k * 12.9898) * 43758.5453;
  return v - Math.floor(v);
};

const DECK_TOP = 330;
const DECK_BOTTOM = 358;
const BODY_BOTTOM = 440;
const ARCH_W = 80; // half width of an arch opening
const ARCH_GAP = 190; // distance between arch centres

/** Stone body (with arch openings and broken ends), cracks and railing posts for a bridge spanning x0..x1 in frame units. */
function buildBridge(x0: number, x1: number) {
  const edges: string[] = [`M${x0 + 4} ${DECK_BOTTOM - 2}H${x1 - 4}`];
  for (let y = DECK_BOTTOM; y <= BODY_BOTTOM; y += 14) edges.push(`L${(x1 - 2 - noise(y, 1) * 12).toFixed(1)} ${y + 7}`);
  for (let x = x1; x >= x0; x -= 26) edges.push(`L${x.toFixed(1)} ${(BODY_BOTTOM + noise(x, 2) * 10 - 4).toFixed(1)}`);
  for (let y = BODY_BOTTOM; y >= DECK_BOTTOM; y -= 14) edges.push(`L${(x0 + 2 + noise(y, 3) * 12).toFixed(1)} ${y - 7}`);
  edges.push('Z');

  const centers: number[] = [];
  for (let c = 240; c < x1 - ARCH_W - 20; c += ARCH_GAP) centers.push(c);
  for (let c = 240 - ARCH_GAP; c > x0 + ARCH_W + 20; c -= ARCH_GAP) centers.push(c);
  const arches = centers.map((c) => `M${c - ARCH_W} 432V398A${ARCH_W} 34 0 0 1 ${c + ARCH_W} 398V432Z`).join('');

  const inArch = (x: number) => centers.some((c) => Math.abs(x - c) < ARCH_W + 4);
  const cracks: { d: string; glow: boolean }[] = [];
  const count = Math.round((x1 - x0) / 24);
  for (let i = 0; i < count; i++) {
    const onDeck = i % 3 === 0;
    let x = x0 + 24 + noise(i, 10) * (x1 - x0 - 48);
    if (!onDeck && inArch(x)) continue;
    let y = onDeck ? DECK_TOP + 1 : DECK_BOTTOM + 4 + noise(i, 11) * 24;
    const steps = onDeck ? 3 : 5 + Math.floor(noise(i, 12) * 3);
    const stepLen = onDeck ? 9 : 11 + noise(i, 13) * 9;
    let d = `M${x.toFixed(1)} ${y.toFixed(1)}`;
    let branch = '';
    for (let k = 0; k < steps; k++) {
      x += (noise(i, 20 + k) - 0.5) * 18;
      y += stepLen;
      if (y > (onDeck ? DECK_BOTTOM - 2 : 430)) break;
      d += `L${x.toFixed(1)} ${y.toFixed(1)}`;
      if (!onDeck && k === 1 && noise(i, 14) > 0.2) branch = `M${x.toFixed(1)} ${y.toFixed(1)}l${((noise(i, 15) - 0.5) * 40).toFixed(1)} ${(8 + noise(i, 16) * 12).toFixed(1)}l${((noise(i, 17) - 0.5) * 20).toFixed(1)} 9`;
    }
    cracks.push({ d: d + branch, glow: noise(i, 18) > 0.45 });
  }

  const posts: { x: number; h: number }[] = [];
  for (let x = x0 + 30; x < x1 - 20; x += 100) posts.push({ x, h: noise(x, 19) > 0.7 ? 11 : 22 });
  return { body: edges.join('') + arches, cracks, posts };
}

type Props = {
  /** Right PIN: "Fire in the hole!", a bomb flies in, the wizard is blown away. */
  boom: boolean;
  /** Changes on every wrong PIN; the wizard shakes his head. */
  panicKey: number;
  /** The PIN field, which sits on the wooden board in front of the bridge. */
  children: ReactNode;
};


/**
 * Lock-screen scene: a grumpy grey wizard on a stone bridge over a fiery chasm, a staff in one hand and a
 * no-entry sign in the other. An original cartoon, pure SVG + CSS.
 */
export function LockWizard({ boom, panicKey, children }: Props) {
  const frame = useRef<HTMLDivElement>(null);
  // The bridge is half the screen wide (at least as wide as the frame), so work out how far past the 480-unit frame it runs.
  const [extra, setExtra] = useState(0);
  useLayoutEffect(() => {
    const measure = () => {
      const w = frame.current?.clientWidth || 480;
      const wanted = Math.max(window.innerWidth * 0.5, w);
      setExtra(Math.max(0, ((wanted - w) / 2 / w) * 480));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);
  const bridge = useMemo(() => buildBridge(-extra, 480 + extra), [extra]);

  return (
    <div ref={frame} className={`lockheist${boom ? ' lockheist--boom' : ''}`} style={{ ['--boom-delay' as string]: `${BOMB_LANDS_S}s` }}>
      <svg className="heist__svg" viewBox="0 0 480 440" aria-hidden>
        <defs>
          <pattern id="lock-brick" width="64" height="32" patternUnits="userSpaceOnUse">
            <rect width="64" height="32" fill="#4a4f59" />
            <path d="M0 0H64M0 16H64M32 0V16M0 16V32M64 16V32" fill="none" stroke="#2c3038" strokeWidth="2" opacity="0.7" />
          </pattern>
        </defs>

        {/* The sky and the fire are the screen's backdrop. This is the bridge: half a screen wide, cracked and crumbling. */}
        <path d={bridge.body} fill="url(#lock-brick)" fillRule="evenodd" stroke="#20242b" strokeWidth={3} strokeLinejoin="round" />
        <rect x={-extra} y={DECK_TOP} width={480 + extra * 2} height={DECK_BOTTOM - DECK_TOP} rx={6} fill="#6f747e" stroke="#20242b" strokeWidth={3} />
        <rect x={-extra + 3} y={DECK_BOTTOM - 10} width={480 + extra * 2 - 6} height={7} fill="#5b6069" opacity={0.6} />
        {bridge.posts.map((p) => (
          <rect key={p.x} x={p.x - 10} y={DECK_TOP - p.h} width={20} height={p.h + 2} rx={4} fill="#6f747e" stroke="#20242b" strokeWidth={3} />
        ))}
        <g fill="none" strokeLinecap="round" strokeLinejoin="round">
          {bridge.cracks.map((c, i) => (
            <g key={i}>
              <path d={c.d} stroke="#101216" strokeWidth={3.4} />
              {c.glow && <path className="crack-glow" d={c.d} stroke="#ff8a2a" strokeWidth={1.3} style={{ animationDelay: `${(i * 0.37) % 2}s` }} />}
            </g>
          ))}
        </g>

        {/* wizard */}
        <g key={panicKey} className={`wizard${panicKey ? ' wizard--no' : ''}`}>
          <g className="wizard__body">
            {/* shoes and robe */}
            <ellipse cx={218} cy={331} rx={16} ry={7} fill="#6b4524" stroke="#20242b" strokeWidth={2.5} />
            <ellipse cx={262} cy={331} rx={16} ry={7} fill="#6b4524" stroke="#20242b" strokeWidth={2.5} />
            <path d="M200 238Q170 300 156 328Q175 334 190 326Q205 336 222 326Q240 336 258 326Q275 336 290 326Q305 334 324 328Q310 300 280 238Z" fill="#b9bcc4" stroke="#20242b" strokeWidth={3} strokeLinejoin="round" />
            <path d="M214 262Q208 300 200 322M240 270V326M266 262Q272 300 280 322" fill="none" stroke="#8d919b" strokeWidth={3} strokeLinecap="round" />
            <rect x={206} y={282} width={68} height={10} rx={3} fill="#7a4a22" stroke="#20242b" strokeWidth={2.5} />
            <rect x={234} y={280} width={12} height={14} rx={2} fill="#e5c158" stroke="#20242b" strokeWidth={2} />

            {/* staff arm (his right, our left) */}
            <g className="wizard__staff">
              <path d="M165 138V332" stroke="#20242b" strokeWidth={11} strokeLinecap="round" />
              <path d="M165 138V332" stroke="#8a5a2b" strokeWidth={7} strokeLinecap="round" />
              <path d="M165 150Q152 142 158 128Q170 120 175 132" fill="none" stroke="#8a5a2b" strokeWidth={6} strokeLinecap="round" />
              <circle className="wizard__orb" cx={166} cy={122} r={11} fill="#8fe3ff" stroke="#20242b" strokeWidth={2.5} />
              <circle cx={162} cy={118} r={3.5} fill="#fff" />
            </g>
            <path d="M206 250Q182 252 170 262" fill="none" stroke="#20242b" strokeWidth={20} strokeLinecap="round" />
            <path d="M206 250Q182 252 170 262" fill="none" stroke="#b9bcc4" strokeWidth={14} strokeLinecap="round" />
            <circle cx={166} cy={262} r={9} fill="#f0c9a0" stroke="#20242b" strokeWidth={2.5} />

            {/* sign arm (his left, our right) */}
            <g className="wizard__sign">
              <path d="M335 176V332" stroke="#20242b" strokeWidth={10} strokeLinecap="round" />
              <path d="M335 176V332" stroke="#9aa0ab" strokeWidth={6} strokeLinecap="round" />
              <circle cx={335} cy={134} r={43} fill="#c0392b" stroke="#20242b" strokeWidth={4} />
              <circle cx={335} cy={134} r={35} fill="none" stroke="#e8574a" strokeWidth={3} />
              <rect x={308} y={125} width={54} height={17} rx={3} fill="#fff" stroke="#20242b" strokeWidth={3} />
            </g>
            <path d="M276 250Q310 250 330 262" fill="none" stroke="#20242b" strokeWidth={20} strokeLinecap="round" />
            <path d="M276 250Q310 250 330 262" fill="none" stroke="#b9bcc4" strokeWidth={14} strokeLinecap="round" />
            <circle cx={335} cy={262} r={9} fill="#f0c9a0" stroke="#20242b" strokeWidth={2.5} />

            {/* head */}
            <g className="wizard__head">
              {/* ears and face */}
              <ellipse cx={209} cy={225} rx={5.5} ry={8.5} fill="#eebd94" stroke="#20242b" strokeWidth={2.5} />
              <ellipse cx={271} cy={225} rx={5.5} ry={8.5} fill="#eebd94" stroke="#20242b" strokeWidth={2.5} />
              <ellipse cx={240} cy={222} rx={31} ry={29} fill="#f4d0a8" stroke="#20242b" strokeWidth={3} />
              <circle cx={221} cy={234} r={6.5} fill="#ee9a8a" opacity={0.5} />
              <circle cx={259} cy={234} r={6.5} fill="#ee9a8a" opacity={0.5} />
              {/* stern eyes under heavy lids */}
              <ellipse cx={227} cy={221} rx={6.5} ry={5} fill="#fff" stroke="#20242b" strokeWidth={1.8} />
              <ellipse cx={253} cy={221} rx={6.5} ry={5} fill="#fff" stroke="#20242b" strokeWidth={1.8} />
              <circle cx={228.5} cy={222} r={3} fill="#3b5d7a" />
              <circle cx={251.5} cy={222} r={3} fill="#3b5d7a" />
              <circle cx={228.5} cy={222} r={1.5} fill="#10141a" />
              <circle cx={251.5} cy={222} r={1.5} fill="#10141a" />
              <circle cx={229.6} cy={220.7} r={0.9} fill="#fff" />
              <circle cx={252.6} cy={220.7} r={0.9} fill="#fff" />
              <path d="M219.5 218.5Q227 214.5 234.5 218.5M245.5 218.5Q253 214.5 260.5 218.5" fill="none" stroke="#20242b" strokeWidth={2.6} strokeLinecap="round" />
              {/* big bushy eyebrows, angry */}
              <path d="M212 215Q219 205 238 214Q226 212 214 220Z" fill="#f1f1f6" stroke="#20242b" strokeWidth={2} strokeLinejoin="round" />
              <path d="M268 215Q261 205 242 214Q254 212 266 220Z" fill="#f1f1f6" stroke="#20242b" strokeWidth={2} strokeLinejoin="round" />
              {/* round wizard nose */}
              <ellipse cx={240} cy={232} rx={7.5} ry={6.5} fill="#eba283" stroke="#20242b" strokeWidth={2} />
              <ellipse cx={237.5} cy={229.5} rx={2.4} ry={1.7} fill="#fff" opacity={0.6} />
              {/* hat */}
              <ellipse cx={240} cy={193} rx={66} ry={15} fill="#8d919b" stroke="#20242b" strokeWidth={3} />
              <path d="M194 190Q216 132 236 104Q250 84 276 90Q258 104 262 130Q270 164 288 190Z" fill="#9ea2ac" stroke="#20242b" strokeWidth={3} strokeLinejoin="round" />
              <path d="M222 140Q238 120 262 132" fill="none" stroke="#b8bcc6" strokeWidth={4} strokeLinecap="round" />
              <path d="M198 182Q240 196 285 182" fill="none" stroke="#6b6f79" strokeWidth={7} />
              <ellipse cx={226} cy={187} rx={26} ry={4} fill="#b8bcc6" opacity={0.6} />
              <g className="wizard__beard">
                {/* beard, then a big moustache over it */}
                <path d="M211 234Q204 280 240 316Q276 280 269 234Q258 256 240 250Q222 256 211 234Z" fill="#fff" stroke="#20242b" strokeWidth={3} strokeLinejoin="round" />
                <path d="M228 262Q233 282 240 298M252 262Q247 282 240 298M240 262V290" fill="none" stroke="#d6dae2" strokeWidth={3} strokeLinecap="round" />
                <path d="M240 241Q224 231 211 241Q217 256 238 250Z" fill="#fff" stroke="#20242b" strokeWidth={2.5} strokeLinejoin="round" />
                <path d="M240 241Q256 231 269 241Q263 256 242 250Z" fill="#fff" stroke="#20242b" strokeWidth={2.5} strokeLinejoin="round" />
              </g>
            </g>
          </g>
        </g>

        {/* what he says */}
        {!boom && (
          <g key={`b${panicKey}`} className="lockheist__bubble">
            <path d="M82 10H398Q412 10 412 24V50Q412 64 398 64H258L236 90L222 64H82Q68 64 68 50V24Q68 10 82 10Z" fill="#fff" stroke="#20242b" strokeWidth={3} strokeLinejoin="round" />
            <text x={240} y={46} textAnchor="middle" fontSize={28} fontWeight={900} fontFamily="Impact, 'Arial Black', sans-serif" fill="#20242b" textLength={310} lengthAdjust="spacingAndGlyphs">
              YOU SHALL NOT PASS!
            </text>
          </g>
        )}

        {/* wooden board that carries the PIN */}
        <rect x={130} y={364} width={220} height={62} rx={9} fill="#9a6a38" stroke="#4b2f14" strokeWidth={4} />
        <path d="M136 384H344M136 404H344" stroke="#7d5229" strokeWidth={2} opacity={0.6} />
        <g fill="#4b2f14">
          <circle cx={142} cy={374} r={2.5} />
          <circle cx={338} cy={374} r={2.5} />
          <circle cx={142} cy={416} r={2.5} />
          <circle cx={338} cy={416} r={2.5} />
        </g>

        {boom && (
          <>
            {/* the thrown bomb */}
            <g transform="translate(46 400)">
              <g className="lockheist__bomb">
                <circle r={13} fill="#17181d" stroke="#000" strokeWidth={2.5} />
                <circle cx={-4} cy={-5} r={3.5} fill="#5b5f6c" />
                <path d="M6-11Q12-20 18-16" fill="none" stroke="#c9a15a" strokeWidth={3} strokeLinecap="round" />
                <circle cx={19} cy={-17} r={4.5} fill="#ffb02e" />
                <circle cx={19} cy={-17} r={2} fill="#fff6c2" />
              </g>
            </g>
            <text className="lockheist__fire" x={240} y={64} textAnchor="middle" fontSize={50} fontWeight={900} fontFamily="Impact, 'Arial Black', sans-serif" fill="#ffd23f" stroke="#20242b" strokeWidth={9} paintOrder="stroke" strokeLinejoin="round" textLength={400} lengthAdjust="spacingAndGlyphs">
              FIRE IN THE HOLE!
            </text>
            <Boom cx={240} cy={262} />
          </>
        )}
      </svg>

      <div className="lockheist__pin heist__pin">{children}</div>
      {boom && <div className="heist__flash" />}
    </div>
  );
}
