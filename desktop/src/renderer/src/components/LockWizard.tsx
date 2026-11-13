import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Boom } from './Boom';

/** Seconds from the right PIN until the thrown bomb lands; the explosion is held back until then. */
export const BOMB_LANDS_S = 0.9;

const INK = '#1c1f26';
const ROBE = 'M198 242Q180 264 170 300Q162 318 152 331Q172 337 190 330Q208 338 226 331Q240 337 254 331Q272 338 290 330Q308 337 328 331Q318 318 310 300Q300 264 282 242Q262 232 240 234Q218 232 198 242Z';
const BEARD = 'M219 236Q212 262 222 288Q230 304 240 316Q250 304 258 288Q268 262 261 236Q252 248 240 246Q228 248 219 236Z';

/** Outline of a comic "shouting" bubble: a spiky rectangle with a tail pointing down at the wizard's hat. */
function shoutBubblePath(): string {
  const x0 = 64;
  const x1 = 416;
  const y0 = 8;
  const y1 = 64;
  const step = 16;
  const tooth = 8;
  const pts: [number, number][] = [];
  for (let x = x0; x < x1; x += step) pts.push([x, y0], [x + step / 2, y0 - tooth]);
  for (let y = y0; y < y1; y += step) pts.push([x1, y], [x1 + tooth, y + step / 2]);
  pts.push([x1, y1]);
  let tail = false;
  for (let x = x1; x > x0; x -= step) {
    if (x <= 266) {
      if (!tail) {
        pts.push([266, y1], [236, y1 + 28], [214, y1]);
        tail = true;
      }
      if (x > 214) continue;
    }
    pts.push([x - step / 2, y1 + tooth], [x - step, y1]);
  }
  for (let y = y1; y > y0; y -= step) pts.push([x0, y], [x0 - tooth, y - step / 2]);
  return `M${pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join('L')}Z`;
}
const SHOUT_BUBBLE = shoutBubblePath();

/** Cheap seeded noise: irregular, but identical on every render. */
const noise = (i: number, k: number) => {
  const v = Math.sin(i * 97.13 + k * 12.9898) * 43758.5453;
  return v - Math.floor(v);
};

/** How far the bridge, the wizard and his bubble sit lower in the frame; the PIN board stays where it is, so its chains are shorter. */
const LOWER = 150;
const DECK_TOP = 330;
const DECK_BOTTOM = 358;
const BODY_END = 1520; // the piers run on down into the fire, past the bottom of the screen
const ARCH_W = 100; // half width of an arch opening
const ARCH_GAP = 260; // distance between arch centres
const SPRING = 440; // where an arch starts to curve
const CROWN = 392; // the top of an arch

/** The stone body seen from below: arches between thick piers that reach down into the fire, plus cracks and railing posts. */
function buildBridge(x0: number, x1: number) {
  const edges: string[] = [`M${x0 + 4} ${DECK_BOTTOM - 2}H${x1 - 4}`];
  for (let y = DECK_BOTTOM; y <= BODY_END; y += 16) edges.push(`L${(x1 - 2 - noise(y, 1) * 14).toFixed(1)} ${y + 8}`);
  edges.push(`L${x0} ${BODY_END}`);
  for (let y = BODY_END; y >= DECK_BOTTOM; y -= 16) edges.push(`L${(x0 + 2 + noise(y, 3) * 14).toFixed(1)} ${y - 8}`);
  edges.push('Z');

  const centers: number[] = [];
  for (let c = 240; c < x1 - ARCH_W; c += ARCH_GAP) centers.push(c);
  for (let c = 240 - ARCH_GAP; c > x0 + ARCH_W; c -= ARCH_GAP) centers.push(c);
  const arches = centers.map((c) => `M${c - ARCH_W} ${BODY_END - 20}V${SPRING}A${ARCH_W} ${SPRING - CROWN} 0 0 1 ${c + ARCH_W} ${SPRING}V${BODY_END - 20}Z`).join('');

  // pier centres sit halfway between two arches
  const piers: number[] = [];
  for (let c = 240 + ARCH_GAP / 2; c < x1 - 10; c += ARCH_GAP) piers.push(c);
  for (let c = 240 - ARCH_GAP / 2; c > x0 + 10; c -= ARCH_GAP) piers.push(c);

  const cracks: { d: string; glow: boolean }[] = [];
  const zigzag = (i: number, x: number, y: number, steps: number, len: number, maxY: number, spread: number) => {
    let d = `M${x.toFixed(1)} ${y.toFixed(1)}`;
    let branch = '';
    for (let k = 0; k < steps; k++) {
      x += (noise(i, 20 + k) - 0.5) * spread;
      y += len * (0.7 + noise(i, 40 + k) * 0.6);
      if (y > maxY) break;
      d += `L${x.toFixed(1)} ${y.toFixed(1)}`;
      if (k === 1 && noise(i, 14) > 0.25) branch = `M${x.toFixed(1)} ${y.toFixed(1)}l${((noise(i, 15) - 0.5) * 46).toFixed(1)} ${(10 + noise(i, 16) * 14).toFixed(1)}l${((noise(i, 17) - 0.5) * 24).toFixed(1)} 11`;
    }
    return d + branch;
  };
  // deck face
  const deckCount = Math.round((x1 - x0) / 70);
  for (let i = 0; i < deckCount; i++) cracks.push({ d: zigzag(i, x0 + 20 + noise(i, 10) * (x1 - x0 - 40), DECK_TOP + 1, 3, 9, DECK_BOTTOM - 2, 16), glow: noise(i, 18) > 0.5 });
  // spandrels above the arches
  const spanCount = Math.round((x1 - x0) / 60);
  for (let i = 0; i < spanCount; i++) cracks.push({ d: zigzag(i + 100, x0 + 20 + noise(i + 100, 10) * (x1 - x0 - 40), DECK_BOTTOM + 3, 3, 9, CROWN - 4, 12), glow: noise(i + 100, 18) > 0.5 });
  // long cracks down the piers
  piers.forEach((c, k) => {
    for (let j = 0; j < 3; j++) {
      const i = 200 + k * 7 + j;
      cracks.push({ d: zigzag(i, c + (noise(i, 10) - 0.5) * 40, 400 + noise(i, 11) * 90, 6 + Math.floor(noise(i, 12) * 3), 18 + noise(i, 13) * 10, 700, 20), glow: noise(i, 18) > 0.4 });
    }
  });

  const posts: { x: number; h: number }[] = [];
  for (let x = x0 + 30; x < x1 - 20; x += 100) posts.push({ x, h: noise(x, 19) > 0.7 ? 11 : 22 });
  return { body: edges.join('') + arches, cracks, posts };
}

type Props = {
  /** Right PIN: "Fire in the hole!", a bomb flies in, the wizard is blown away. */
  boom: boolean;
  /** Changes on every wrong PIN; the wizard shakes his head. */
  panicKey: number;
  /** What the wizard bellows; defaults to the usual warning. */
  message?: string;
  /** The staff is lowered and planted, and the wizard stops bouncing (used when the visitor turns back). */
  calm?: boolean;
  /** The PIN field, which sits on the wooden board in front of the bridge. */
  children: ReactNode;
};


/**
 * Lock-screen scene: a grumpy grey wizard on a stone bridge over a fiery chasm, a staff in one hand and a
 * no-entry sign in the other. An original cartoon, pure SVG + CSS.
 */
export function LockWizard({ boom, panicKey, message = 'YOU SHALL NOT PASS!', calm = false, children }: Props) {
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
  // Raised high and pumping, or lowered and planted on the deck.
  const staffBottom = calm ? 332 : 300;
  const armPath = calm ? 'M206 250Q182 252 170 262' : 'M206 250Q182 246 168 216';
  const handY = calm ? 262 : 211;
  const bridge = useMemo(() => buildBridge(-extra, 480 + extra), [extra]);

  return (
    <div ref={frame} className={`lockheist${boom ? ' lockheist--boom' : ''}`} style={{ ['--boom-delay' as string]: `${BOMB_LANDS_S}s`, ['--lower' as string]: `${LOWER}px` }}>
      <svg className="heist__svg" viewBox="0 0 480 560" aria-hidden>
        <defs>
          <linearGradient id="wiz-robe" x1="0" x2="1">
            <stop offset="0" stopColor="#7d828d" />
            <stop offset="0.45" stopColor="#b7bbc3" />
            <stop offset="0.7" stopColor="#a6aab3" />
            <stop offset="1" stopColor="#6f747e" />
          </linearGradient>
          <linearGradient id="wiz-firelit" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0.45" stopColor="#ff7a2a" stopOpacity={0} />
            <stop offset="1" stopColor="#ff7a2a" stopOpacity={0.4} />
          </linearGradient>
          <linearGradient id="wiz-hat" x1="0" x2="1">
            <stop offset="0" stopColor="#80858f" />
            <stop offset="0.55" stopColor="#a9adb6" />
            <stop offset="1" stopColor="#737882" />
          </linearGradient>
          <linearGradient id="wiz-brim" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#9a9ea8" />
            <stop offset="1" stopColor="#6c717b" />
          </linearGradient>
          <linearGradient id="wiz-beard" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="1" stopColor="#d2d6de" />
          </linearGradient>
          <linearGradient id="wiz-face-shade" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#3a2416" stopOpacity={0.45} />
            <stop offset="0.35" stopColor="#3a2416" stopOpacity={0} />
          </linearGradient>
          <radialGradient id="wiz-orb" cx="0.38" cy="0.35" r="0.7">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="0.4" stopColor="#bdf1ff" />
            <stop offset="1" stopColor="#2b97d6" />
          </radialGradient>
          <radialGradient id="wiz-halo">
            <stop offset="0" stopColor="#bdf1ff" stopOpacity={0.85} />
            <stop offset="0.35" stopColor="#6fd3ff" stopOpacity={0.35} />
            <stop offset="1" stopColor="#6fd3ff" stopOpacity={0} />
          </radialGradient>
          <radialGradient id="wiz-sign-shade" cx="0.35" cy="0.3" r="0.8">
            <stop offset="0.5" stopColor="#000" stopOpacity={0} />
            <stop offset="1" stopColor="#000" stopOpacity={0.3} />
          </radialGradient>
          <linearGradient id="wiz-firelight" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#ff6a1a" stopOpacity={0} />
            <stop offset="0.55" stopColor="#ff6a1a" stopOpacity={0.08} />
            <stop offset="1" stopColor="#ff8a2a" stopOpacity={0.5} />
          </linearGradient>
          <pattern id="lock-brick" width="64" height="32" patternUnits="userSpaceOnUse">
            <rect width="64" height="32" fill="#4a4f59" />
            <path d="M0 0H64M0 16H64M32 0V16M0 16V32M64 16V32" fill="none" stroke="#2c3038" strokeWidth="2" opacity="0.7" />
          </pattern>
        </defs>

        <g transform={`translate(0 ${LOWER})`}>
        {/* The sky and the fire are the screen's backdrop. This is the bridge: half a screen wide, cracked and crumbling. */}
        <path d={bridge.body} fill="url(#lock-brick)" fillRule="evenodd" stroke="#20242b" strokeWidth={3} strokeLinejoin="round" />
        <rect x={-extra} y={DECK_TOP} width={480 + extra * 2} height={DECK_BOTTOM - DECK_TOP} rx={6} fill="#6f747e" stroke="#20242b" strokeWidth={3} />
        <rect x={-extra + 3} y={DECK_BOTTOM - 10} width={480 + extra * 2 - 6} height={7} fill="#5b6069" opacity={0.6} />
        {/* the underside of the deck, seen from below, with a row of corbel stones */}
        <rect x={-extra} y={DECK_BOTTOM - 2} width={480 + extra * 2} height={9} fill="#3a3e47" stroke="#20242b" strokeWidth={2} />
        {Array.from({ length: Math.ceil((480 + extra * 2) / 32) }, (_, i) => (
          <rect key={i} x={-extra + 6 + i * 32} y={DECK_BOTTOM + 7} width={18} height={7} rx={2} fill="#59606b" stroke="#20242b" strokeWidth={1.5} />
        ))}
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
        <g key={panicKey} className={`wizard${panicKey ? ' wizard--no' : ''}${calm ? ' wizard--calm' : ''}`}>
          <g className="wizard__body">
            {/* boot tips peeking out under the robe */}
            <path d="M212 333Q214 324 226 325Q236 326 238 333Z" fill="#3b2a1c" stroke={INK} strokeWidth={2.2} />
            <path d="M242 333Q244 326 254 325Q266 324 270 333Z" fill="#3b2a1c" stroke={INK} strokeWidth={2.2} />
            {/* long grey robe, wider at the hem, lit orange from the fire below */}
            <path d={ROBE} fill="url(#wiz-robe)" stroke={INK} strokeWidth={3} strokeLinejoin="round" />
            <path d={ROBE} fill="url(#wiz-firelit)" className="wizard__firelit" />
            <path d="M228 252Q224 292 220 330L260 330Q256 292 252 252Z" fill="#7b808b" opacity={0.55} />
            <path d="M206 262Q196 296 184 326M218 270Q212 300 206 328M262 270Q268 300 274 328M274 262Q284 296 296 326" fill="none" stroke="#6d727c" strokeWidth={2.2} strokeLinecap="round" />
            <path d="M188 300Q176 316 168 328M292 300Q304 316 312 328" fill="none" stroke="#ffb072" strokeWidth={1.6} opacity={0.5} strokeLinecap="round" />
            {/* rope belt, knotted, ends hanging */}
            <path d="M203 284Q240 294 277 284" fill="none" stroke={INK} strokeWidth={7} strokeLinecap="round" />
            <path d="M203 284Q240 294 277 284" fill="none" stroke="#8a6338" strokeWidth={4} strokeLinecap="round" />
            <path d="M203 284Q240 294 277 284" fill="none" stroke="#b58a52" strokeWidth={1.2} strokeDasharray="3 3" />
            <circle cx={252} cy={289} r={4.5} fill="#8a6338" stroke={INK} strokeWidth={2} />
            <path d="M251 293Q249 306 253 316M255 293Q259 304 258 312" fill="none" stroke={INK} strokeWidth={4.4} strokeLinecap="round" />
            <path d="M251 293Q249 306 253 316M255 293Q259 304 258 312" fill="none" stroke="#8a6338" strokeWidth={2.2} strokeLinecap="round" />

            {/* staff arm: raised high, the whole arm and staff pump up and down */}
            <g className="wizard__raise">
              <g className="wizard__staff">
                <circle className="wizard__halo" cx={166} cy={122} r={34} fill="url(#wiz-halo)" />
                <path d={`M165 140Q161 ${(140 + staffBottom) / 2} 165 ${staffBottom}`} fill="none" stroke={INK} strokeWidth={10} strokeLinecap="round" />
                <path d={`M165 140Q161 ${(140 + staffBottom) / 2} 165 ${staffBottom}`} fill="none" stroke="#7a5230" strokeWidth={6} strokeLinecap="round" />
                <path d={`M164 150Q162 ${(140 + staffBottom) / 2} 164 ${staffBottom - 6}`} fill="none" stroke="#a87a4a" strokeWidth={1.6} strokeLinecap="round" opacity={0.7} />
                <circle cx={163.4} cy={176} r={2.6} fill="#5a3a20" />
                {/* twisted roots gripping the crystal */}
                <path d="M165 144Q150 140 152 124Q156 110 166 108M165 144Q180 138 178 122Q176 110 168 108" fill="none" stroke={INK} strokeWidth={6.4} strokeLinecap="round" />
                <path d="M165 144Q150 140 152 124Q156 110 166 108M165 144Q180 138 178 122Q176 110 168 108" fill="none" stroke="#7a5230" strokeWidth={3.4} strokeLinecap="round" />
                <circle className="wizard__orb" cx={166} cy={124} r={9.5} fill="url(#wiz-orb)" stroke={INK} strokeWidth={2} />
                <circle cx={163} cy={120.5} r={2.6} fill="#fff" />
              </g>
              <path d={armPath} fill="none" stroke={INK} strokeWidth={21} strokeLinecap="round" />
              <path d={armPath} fill="none" stroke="#a9adb6" strokeWidth={15} strokeLinecap="round" />
              <circle cx={166} cy={handY} r={8} fill="#e9bf98" stroke={INK} strokeWidth={2.4} />
              <path d={`M160 ${handY - 3}H172M160 ${handY + 1}H172M161 ${handY + 5}H171`} stroke="#b98560" strokeWidth={1.2} strokeLinecap="round" />
            </g>

            {/* sign arm (his left, our right) */}
            <g className="wizard__sign">
              <path d="M335 176V332" stroke={INK} strokeWidth={10} strokeLinecap="round" />
              <path d="M335 176V332" stroke="#9aa0ab" strokeWidth={6} strokeLinecap="round" />
              <path d="M333 180V330" stroke="#d3d7de" strokeWidth={1.4} opacity={0.7} />
              <circle cx={335} cy={134} r={43} fill="#c0392b" stroke={INK} strokeWidth={4} />
              <circle cx={335} cy={134} r={43} fill="url(#wiz-sign-shade)" />
              <circle cx={335} cy={134} r={36} fill="none" stroke="#f2f2f2" strokeWidth={3.4} />
              <rect x={308} y={125} width={54} height={17} rx={3} fill="#fff" stroke={INK} strokeWidth={3} />
              <path d="M310 100Q330 92 352 102" fill="none" stroke="#fff" strokeWidth={3} strokeLinecap="round" opacity={0.35} />
            </g>
            <path d="M276 250Q310 250 330 262" fill="none" stroke={INK} strokeWidth={21} strokeLinecap="round" />
            <path d="M276 250Q310 250 330 262" fill="none" stroke="#a9adb6" strokeWidth={15} strokeLinecap="round" />
            <circle cx={335} cy={262} r={8} fill="#e9bf98" stroke={INK} strokeWidth={2.4} />
            <path d="M329 259H341M329 263H341M330 267H340" stroke="#b98560" strokeWidth={1.2} strokeLinecap="round" />
            {/* shoulders of the robe over the sleeves */}
            <path d="M200 244Q220 232 240 234Q260 232 280 244Q270 256 240 254Q210 256 200 244Z" fill="#9da1ab" stroke={INK} strokeWidth={2.4} strokeLinejoin="round" />

            {/* head */}
            <g className="wizard__head">
              {/* long silver hair falling to the shoulders */}
              <path d="M215 194Q198 220 202 256Q210 262 218 252Q214 232 224 206Z" fill="url(#wiz-beard)" stroke={INK} strokeWidth={2.2} strokeLinejoin="round" />
              <path d="M265 194Q282 220 278 256Q270 262 262 252Q266 232 256 206Z" fill="url(#wiz-beard)" stroke={INK} strokeWidth={2.2} strokeLinejoin="round" />
              <path d="M208 222Q206 238 210 250M272 222Q274 238 270 250" fill="none" stroke="#b9bec8" strokeWidth={1.4} strokeLinecap="round" />
              {/* a long, lined face */}
              <path d="M221 198Q219 226 229 240Q240 248 251 240Q261 226 259 198Z" fill="#efc8a2" stroke={INK} strokeWidth={2.6} strokeLinejoin="round" />
              <path d="M221 198Q219 226 229 240Q240 248 251 240Q261 226 259 198Z" fill="url(#wiz-face-shade)" />
              <path d="M226 226Q228 230 231 231M254 226Q252 230 249 231" fill="none" stroke="#c6936c" strokeWidth={1.3} strokeLinecap="round" />
              {/* stern eyes in the shadow of the brim */}
              <path d="M226 214Q231 210.5 236 214Q231 216.6 226 214Z" fill="#fff" stroke={INK} strokeWidth={1.4} />
              <path d="M244 214Q249 210.5 254 214Q249 216.6 244 214Z" fill="#fff" stroke={INK} strokeWidth={1.4} />
              <circle cx={232} cy={213.6} r={2.1} fill="#2f5b86" />
              <circle cx={248} cy={213.6} r={2.1} fill="#2f5b86" />
              <circle cx={232} cy={213.6} r={1} fill="#0b0f16" />
              <circle cx={248} cy={213.6} r={1} fill="#0b0f16" />
              <circle cx={232.7} cy={212.8} r={0.6} fill="#fff" />
              <circle cx={248.7} cy={212.8} r={0.6} fill="#fff" />
              {/* great bushy brows, drawn down in a scowl */}
              <path d="M218 207Q225 200 239 210.5Q232 209 226 212Q221 212 218 207Z" fill="#f3f4f7" stroke={INK} strokeWidth={1.8} strokeLinejoin="round" />
              <path d="M262 207Q255 200 241 210.5Q248 209 254 212Q259 212 262 207Z" fill="#f3f4f7" stroke={INK} strokeWidth={1.8} strokeLinejoin="round" />
              <path d="M236 205L240 210L244 205" fill="none" stroke="#c6936c" strokeWidth={1.3} strokeLinecap="round" />
              {/* long nose */}
              <path d="M239 210Q235 222 236 228Q240 231 244 228Q244 220 241 210" fill="#e4ab86" stroke={INK} strokeWidth={1.9} strokeLinejoin="round" />
              <g className="wizard__beard">
                {/* long beard in flowing locks, then the drooping moustache over it */}
                <path d={BEARD} fill="url(#wiz-beard)" stroke={INK} strokeWidth={2.6} strokeLinejoin="round" />
                <path d="M228 248Q226 272 234 296M240 250Q238 278 240 306M252 248Q254 272 246 296M222 244Q218 262 224 280M258 244Q262 262 256 280" fill="none" stroke="#b9bec8" strokeWidth={1.4} strokeLinecap="round" />
                <path d={BEARD} fill="url(#wiz-firelit)" className="wizard__firelit" opacity={0.6} />
                <path d="M240 231Q228 227 218 238Q214 246 220 250Q226 240 240 238Q254 240 260 250Q266 246 262 238Q252 227 240 231Z" fill="#f6f7fa" stroke={INK} strokeWidth={2.2} strokeLinejoin="round" />
                <path d="M233 240Q237 243 240 240Q243 243 247 240" fill="none" stroke="#6b3a2a" strokeWidth={1.6} strokeLinecap="round" />
              </g>
              {/* tall pointed hat, battered, its tip flopping back; a wide brim shading the eyes */}
              <path d="M200 196Q214 156 228 128Q238 106 252 92Q266 80 286 88Q270 94 264 110Q258 136 268 164Q274 182 282 196Z" fill="url(#wiz-hat)" stroke={INK} strokeWidth={3} strokeLinejoin="round" />
              <path d="M226 150Q236 140 252 146M236 120Q244 116 252 120" fill="none" stroke="#6d727c" strokeWidth={1.8} strokeLinecap="round" />
              <path d="M262 112Q262 140 268 166" fill="none" stroke="#c8ccd4" strokeWidth={2} opacity={0.6} strokeLinecap="round" />
              <path d="M204 190Q240 200 278 190L280 182Q240 192 206 182Z" fill="#5d626d" stroke={INK} strokeWidth={2} strokeLinejoin="round" />
              <path d="M172 197Q200 186 240 186Q282 186 308 197Q284 205 240 205Q196 205 172 197Z" fill="url(#wiz-brim)" stroke={INK} strokeWidth={3} strokeLinejoin="round" />
              <path d="M184 198Q240 192 296 198" fill="none" stroke="#c8ccd4" strokeWidth={1.6} opacity={0.5} strokeLinecap="round" />
            </g>
          </g>
        </g>

        {/* flickering firelight from the chasm, washing over the bridge and the wizard */}
        <rect className="lockheist__firelight" x={-extra} y={180} width={480 + extra * 2} height={1400} fill="url(#wiz-firelight)" />

        {/* what he says */}
        {!boom && (
          <g key={`b${panicKey}${message}`} className={`lockheist__bubble${calm ? ' lockheist__bubble--calm' : ''}`}>
            <path d={SHOUT_BUBBLE} fill="#fff" stroke="#20242b" strokeWidth={3} strokeLinejoin="round" />
            <text className="shout-text" x={240} y={46} textAnchor="middle" fontSize={28} fontWeight={900} fontFamily="Impact, 'Arial Black', sans-serif" fill="#20242b" textLength={Math.min(330, message.length * 16.3)} lengthAdjust="spacingAndGlyphs">
              {message}
            </text>
            {/* sound lines, as if the whole thing is being bellowed */}
            <g className="shout-lines" fill="none" stroke="#fff" strokeWidth={4} strokeLinecap="round">
              <path d="M40 16L52 24M34 36H50M40 56L52 48" />
              <path d="M440 16L428 24M446 36H430M440 56L428 48" />
            </g>
          </g>
        )}

        </g>

        {/* wooden board hanging under the deck on two chains; it carries the PIN */}
        <path d="M152 508V612M328 508V612" stroke="#20242b" strokeWidth={7} strokeDasharray="7 4" strokeLinecap="round" />
        <path d="M152 508V612M328 508V612" stroke="#9aa0ab" strokeWidth={3.5} strokeDasharray="7 4" strokeLinecap="round" />
        <rect x={130} y={610} width={220} height={62} rx={9} fill="#9a6a38" stroke="#4b2f14" strokeWidth={4} />
        <path d="M136 630H344M136 650H344" stroke="#7d5229" strokeWidth={2} opacity={0.6} />
        <g fill="#4b2f14">
          <circle cx={142} cy={620} r={2.5} />
          <circle cx={338} cy={620} r={2.5} />
          <circle cx={142} cy={662} r={2.5} />
          <circle cx={338} cy={662} r={2.5} />
        </g>

        {boom && (
          <g transform={`translate(0 ${LOWER})`}>
            {/* the thrown bomb */}
            <g transform="translate(46 520)">
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
          </g>
        )}
      </svg>

      <div className="lockheist__pin heist__pin">{children}</div>
      {boom && <div className="heist__flash" />}
    </div>
  );
}
