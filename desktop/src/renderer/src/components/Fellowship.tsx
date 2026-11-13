import type { ReactNode } from 'react';

/**
 * The company walking up the bank: small storybook figures facing right, feet at (0, 0), caught mid-stride.
 * Original drawings. Each garment gets a soft shadow on the side away from the gate (`#fel-shade`) and a thin
 * blue rim of gate light on the near side. Render `<FellowshipDefs />` once inside the scene's `<defs>`.
 */

const INK = '#0b1322';
const RIM = '#9cc8ff';
const LINE = 1.1;

export type WalkerKind = 'gandalf' | 'aragorn' | 'boromir' | 'legolas' | 'gimli' | 'frodo' | 'sam' | 'merry' | 'pippin';
export type Walker = { kind: WalkerKind; x: number; y: number; s: number };

/** Nearest the gate first. The grey wizard leads. */
export const WALKERS: Walker[] = [
  { kind: 'gandalf', x: 588, y: 744, s: 1 },
  { kind: 'aragorn', x: 512, y: 738, s: 1 },
  { kind: 'boromir', x: 448, y: 746, s: 1 },
  { kind: 'legolas', x: 392, y: 740, s: 1 },
  { kind: 'gimli', x: 344, y: 748, s: 1 },
  { kind: 'frodo', x: 304, y: 742, s: 1 },
  { kind: 'sam', x: 264, y: 750, s: 1 },
  { kind: 'merry', x: 226, y: 743, s: 1 },
  { kind: 'pippin', x: 190, y: 751, s: 1 },
];

/** Shared paint for the figures: the shadow gradient and a ring-mail texture. */
export function FellowshipDefs() {
  return (
    <>
      <linearGradient id="fel-shade" x1="0" x2="1" y1="0" y2="0">
        <stop offset="0" stopColor="#040814" stopOpacity={0.62} />
        <stop offset="0.5" stopColor="#040814" stopOpacity={0.2} />
        <stop offset="0.85" stopColor="#040814" stopOpacity={0} />
        <stop offset="1" stopColor="#9cc8ff" stopOpacity={0.22} />
      </linearGradient>
      <linearGradient id="fel-skin-shade" x1="0" x2="1" y1="0" y2="0">
        <stop offset="0" stopColor="#040814" stopOpacity={0.4} />
        <stop offset="0.55" stopColor="#040814" stopOpacity={0} />
        <stop offset="1" stopColor="#bfe0ff" stopOpacity={0.25} />
      </linearGradient>
      <pattern id="fel-mail" width="3" height="2.6" patternUnits="userSpaceOnUse">
        <path d="M0 1.3a1.5 1.3 0 0 1 3 0" fill="none" stroke="#2e3542" strokeWidth={0.55} />
      </pattern>
    </>
  );
}

/** A garment or body part: flat colour, outline, then the gate-side lighting on top. */
function Cloth({ d, fill, line = LINE }: { d: string; fill: string; line?: number }) {
  return (
    <>
      <path d={d} fill={fill} stroke={INK} strokeWidth={line} strokeLinejoin="round" />
      <path d={d} fill="url(#fel-shade)" />
    </>
  );
}

/** A thin dark-outlined limb drawn along a path. */
function Limb({ d, color, w }: { d: string; color: string; w: number }) {
  return (
    <>
      <path d={d} fill="none" stroke={INK} strokeWidth={w + 2.2} strokeLinecap="round" strokeLinejoin="round" />
      <path d={d} fill="none" stroke={color} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" />
    </>
  );
}

function Fold({ d, color, w = 1 }: { d: string; color: string; w?: number }) {
  return <path d={d} fill="none" stroke={color} strokeWidth={w} strokeLinecap="round" opacity={0.85} />;
}

function Rim({ d, w = 1.3 }: { d: string; w?: number }) {
  return <path d={d} fill="none" stroke={RIM} strokeWidth={w} opacity={0.7} strokeLinecap="round" />;
}

function Hand({ x, y, skin, r = 3.2 }: { x: number; y: number; skin: string; r?: number }) {
  return (
    <>
      <circle cx={x} cy={y} r={r} fill={skin} stroke={INK} strokeWidth={0.9} />
      <circle cx={x} cy={y} r={r} fill="url(#fel-skin-shade)" />
    </>
  );
}

/** A boot standing on its sole, toe to the right. `r` tips it up onto the toe for the trailing foot. */
function Boot({ x, y = 0, r = 0, color, k = 1, tall = 12 }: { x: number; y?: number; r?: number; color: string; k?: number; tall?: number }) {
  const d = `M-4 ${-tall}L4 ${-tall}L4.3 -5Q11 -4.6 11.6 -1.4Q11.6 0 9 0L-4.6 0Q-5.2 ${-tall / 2} -4 ${-tall}Z`;
  return (
    <g transform={`translate(${x} ${y}) rotate(${r}) scale(${k})`}>
      <Cloth d={d} fill={color} line={1} />
      <path d="M-4.6 -0.4H10" stroke="#1a120b" strokeWidth={1.4} />
    </g>
  );
}

/** A big, hairy hobbit foot, toes to the right. */
function BareFoot({ x, y = 0, r = 0, skin }: { x: number; y?: number; r?: number; skin: string }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${r})`}>
      <Cloth d="M-3.4 -7Q-5.6 -2 -4.4 0L9.6 0Q12.8 -0.4 12 -3Q9.6 -5.4 3.6 -5.8L1.8 -7.6Z" fill={skin} line={0.9} />
      <path d="M-1 -6.4l-1 -2.4M1.6 -6.6l-0.4 -2.6M4.6 -6l0.6 -2.4M7.4 -5.4l1 -2" stroke="#6b4a2c" strokeWidth={1.1} strokeLinecap="round" />
      <path d="M9 -0.2V-2.4M6.6 -0.2V-2.6" stroke="#9a6e4c" strokeWidth={0.6} />
    </g>
  );
}

/** A head in profile looking right, about 24 units tall at k = 1, centred on (x, y). */
const HEAD =
  'M-8 -7C-7 -12 -1 -14 3 -13C7.5 -12 9.4 -8.5 9.4 -5L9.6 -3C10.2 -1 12 1.8 12.2 2.8C11.6 3.6 10.6 3.6 9.9 3.8L10.2 5.2L9.6 6L10 7C9.6 9 8.2 10.5 6 10.6C3.5 10.8 1.5 9.6 0 8C-3 7.6 -6.5 5.5 -8 2C-9 -1 -9 -4 -8 -7Z';

type HeadProps = {
  x: number;
  y: number;
  k?: number;
  skin: string;
  brow: string;
  /** Drawn behind the head, in head units (long hair, hood). */
  back?: ReactNode;
  /** Drawn over the face, in head units (hair, beard, helm). */
  children?: ReactNode;
  ear?: 'round' | 'point' | 'small' | 'none';
};

function Head({ x, y, k = 1, skin, brow, back, children, ear = 'round' }: HeadProps) {
  return (
    <g transform={`translate(${x} ${y}) scale(${k})`}>
      {back}
      <path d={HEAD} fill={skin} stroke={INK} strokeWidth={0.9} strokeLinejoin="round" />
      <path d={HEAD} fill="url(#fel-skin-shade)" />
      {/* cheek and jaw shading, nostril */}
      <path d="M2 6.5Q5 9.2 8.6 8.4" fill="none" stroke="#000" strokeWidth={0.7} opacity={0.18} strokeLinecap="round" />
      <path d="M9.8 2.6Q10.6 3.2 11.2 3" fill="none" stroke={INK} strokeWidth={0.6} opacity={0.6} />
      {/* eye: a small almond with a glint, set under the brow */}
      <path d="M4.4 -2.1Q6.2 -3.4 7.9 -2Q6.2 -1 4.4 -2.1Z" fill="#141c2c" />
      <circle cx={6.6} cy={-2.4} r={0.45} fill="#dfefff" />
      <path d="M3.6 -4.6Q6.4 -6 9.2 -4.5" fill="none" stroke={brow} strokeWidth={1.5} strokeLinecap="round" />
      <path d="M8.8 5.9L10 5.7" stroke={INK} strokeWidth={0.75} strokeLinecap="round" />
      {ear === 'round' && <path d="M-1.6 -2.6C-4.6 -3.6 -5.8 1.6 -2.4 3.2" fill={skin} stroke={INK} strokeWidth={0.8} />}
      {children}
      {ear === 'small' && (
        <path d="M-1.2 2.6C-4.4 2.6 -5.6 -1 -4.8 -4.6C-3.6 -2.8 -2 -2 -0.8 -1.6Z" fill={skin} stroke={INK} strokeWidth={0.8} strokeLinejoin="round" />
      )}
      {ear === 'point' && (
        <path d="M-1.4 1.8C-3.4 -1 -6 -6 -8.6 -9.6C-5.4 -6.4 -3.2 -3.4 -0.6 -1.6Z" fill={skin} stroke={INK} strokeWidth={0.8} strokeLinejoin="round" />
      )}
    </g>
  );
}

/** A mop of curls over the top and back of a head, in head units. */
function curls(r = 12.6, from = 150, to = 342, n = 11): string {
  const cx = -0.6;
  const cy = -2.4;
  const pt = (a: number) => {
    const t = (a * Math.PI) / 180;
    return [cx + r * Math.cos(t), cy + r * Math.sin(t)].map((v) => v.toFixed(2));
  };
  const step = (to - from) / n;
  const [sx, sy] = pt(from);
  let d = `M${sx} ${sy}`;
  for (let i = 1; i <= n; i++) {
    const [x, y] = pt(from + step * i);
    d += `A${(r * 0.17).toFixed(2)} ${(r * 0.17).toFixed(2)} 0 0 1 ${x} ${y}`;
  }
  return `${d}Q6 -7 2 -7.6Q-1 -5 -3.2 -1.2Q-4.6 2 -6.4 5Z`;
}

/* ------------------------------------------------------------------ the wizard */

function Gandalf() {
  const robe = '#8a919e';
  const dark = '#626977';
  const skin = '#d0a88c';
  return (
    <g>
      {/* trailing cape */}
      <Cloth d="M-8 -116C-24 -106 -32 -66 -40 -8Q-33 -2 -26 -5Q-19 0 -12 -4L-4 -60Z" fill={dark} />
      <Boot x={-14} y={-1} color="#33281e" />
      <Boot x={16} color="#33281e" />
      {/* back arm swinging behind */}
      <Limb d="M-6 -110Q-15 -96 -19 -80" color={dark} w={10} />
      <Hand x={-19} y={-75} skin={skin} />
      {/* the long robe */}
      <Cloth d="M-11 -116C-16 -96 -22 -50 -28 -3Q-18 2 -8 -1Q4 3 14 -1Q22 2 28 -2C24 -44 18 -94 12 -116Q0 -121 -11 -116Z" fill={robe} />
      <Fold d="M-2 -96Q-6 -50 -12 -4M6 -88Q8 -48 6 -2M15 -60Q19 -30 22 -3" color={dark} w={1.2} />
      <Rim d="M13 -112C18 -92 24 -48 27 -6" />
      <path d="M-15 -70Q0 -65 16 -71" fill="none" stroke="#4a3a28" strokeWidth={2.8} strokeLinecap="round" />
      <path d="M10 -68Q12 -56 9 -46" fill="none" stroke="#4a3a28" strokeWidth={1.8} strokeLinecap="round" />
      {/* the staff, gnarled at the top round a glowing crystal */}
      <path d="M41 -178Q34 -90 30 -2" fill="none" stroke={INK} strokeWidth={5.4} strokeLinecap="round" />
      <path d="M41 -178Q34 -90 30 -2" fill="none" stroke="#6b4f33" strokeWidth={3.2} strokeLinecap="round" />
      <path d="M41 -176Q47 -184 42 -191Q35 -193 34 -186" fill="none" stroke={INK} strokeWidth={4} strokeLinecap="round" />
      <path d="M41 -176Q47 -184 42 -191Q35 -193 34 -186" fill="none" stroke="#6b4f33" strokeWidth={2.2} strokeLinecap="round" />
      <circle className="moria__staff-tip" cx={40} cy={-185} r={4.6} fill="#d6eeff" />
      {/* front arm on the staff, wide sleeve */}
      <Limb d="M5 -110Q20 -104 30 -95" color={robe} w={10} />
      <path d="M26 -101L36 -99L33 -88Z" fill={robe} stroke={INK} strokeWidth={LINE} strokeLinejoin="round" />
      <Hand x={35} y={-92} skin={skin} r={3.4} />
      {/* head: silver hair, long beard, bushy brows */}
      <Head
        x={6}
        y={-126}
        skin={skin}
        brow="#e8eaee"
        back={<path d="M-6 -9C-14 -4 -14 10 -11 22Q-7 18 -5 22Q-3 14 -1 10L0 0Z" fill="#d3d6dd" stroke={INK} strokeWidth={0.8} />}
      >
        <path d="M-1 4C-2 12 0 24 4 34Q6 30 8 33Q10 26 11 18C12 12 12 8 11.5 6L10.3 6.4C8 8 3 7 -1 4Z" fill="#e2e4e9" stroke={INK} strokeWidth={0.8} strokeLinejoin="round" />
        <path d="M2 10Q2 20 5 28M6 9Q6 18 8 26M9.5 9Q10 16 10 22" fill="none" stroke="#a9aebb" strokeWidth={0.6} />
        <path d="M6.5 3.4Q10.5 2.6 12.4 5.8Q10 6.2 8.4 5Q6.4 6.2 4 5.4Z" fill="#eceef2" stroke={INK} strokeWidth={0.6} />
        <path d="M2.6 -5.2Q6.4 -8.2 10.4 -4.4Q6.4 -5.4 2.6 -3.8Z" fill="#eceef2" stroke={INK} strokeWidth={0.5} />
        <path d="M-8.4 -6Q-7 -10 -2 -10L-1 -3Q-4 -1 -6 4Q-8 -1 -8.4 -6Z" fill="#d3d6dd" />
      </Head>
      {/* the tall, wide-brimmed pointed hat, its tip bent back */}
      <Cloth d="M-10 -137C-8 -156 -4 -170 -12 -192C2 -180 12 -160 18 -137Q4 -140 -10 -137Z" fill={robe} />
      <path d="M-10 -138Q4 -141 18 -138" fill="none" stroke="#4f5562" strokeWidth={2.6} />
      <Cloth d="M-20 -135Q4 -143 32 -136Q30 -131 6 -131Q-14 -130 -20 -135Z" fill="#7a818e" />
      <Rim d="M8 -174C12 -162 15 -150 17 -139" w={1.1} />
    </g>
  );
}

/* ------------------------------------------------------------------ the ranger */

function Aragorn() {
  const cloak = '#28372d';
  const skin = '#c99c80';
  const hair = '#221a14';
  return (
    <g>
      <Cloth d="M-8 -102C-20 -96 -30 -64 -38 -18Q-33 -12 -27 -15Q-21 -9 -15 -14Q-10 -12 -6 -18L0 -60L4 -100Z" fill={cloak} />
      {/* sword in its scabbard, slung behind the hip */}
      <Limb d="M-4 -60L-28 -22" color="#2a1e14" w={3.4} />
      <path d="M-28 -22L-30 -19" stroke="#b8a160" strokeWidth={3} strokeLinecap="round" />
      {/* trailing leg, then leading leg */}
      <Limb d="M-3 -54L-9 -30L-13 -14" color="#33291f" w={8} />
      <Boot x={-17} y={-4} r={22} color="#2c2017" />
      <Limb d="M5 -54L11 -30L14 -10" color="#3b2f24" w={8} />
      <Boot x={14} color="#2c2017" />
      {/* back arm */}
      <Limb d="M-5 -98L-12 -78L-14 -63" color="#2f3c30" w={7.5} />
      <Hand x={-14} y={-60} skin={skin} />
      <path d="M0 -110L1 -101" stroke={skin} strokeWidth={6} strokeLinecap="round" />
      {/* leather jerkin */}
      <Cloth d="M-11 -100C-4 -106 8 -106 14 -100C16 -86 16 -70 15 -58L17 -40Q3 -35 -13 -40L-11 -58C-13 -72 -13 -88 -11 -100Z" fill="#4e3c2a" />
      <Fold d="M2 -96V-44M-6 -56L-8 -42M10 -56L12 -42" color="#2c2016" />
      <Rim d="M15 -96C16 -84 16 -70 15.4 -60" />
      <path d="M-12 -60Q2 -56 16 -61" fill="none" stroke="#1d150e" strokeWidth={3.6} strokeLinecap="round" />
      <rect x={4} y={-61} width={4.6} height={5} rx={1} fill="#b8a160" stroke={INK} strokeWidth={0.7} />
      {/* sword hilt above the hip */}
      <path d="M-8 -64L0 -58" stroke="#b8a160" strokeWidth={2.2} strokeLinecap="round" />
      <Limb d="M-4 -61L1 -71" color="#3a2a1a" w={2.4} />
      <circle cx={1.6} cy={-72} r={1.8} fill="#b8a160" stroke={INK} strokeWidth={0.6} />
      {/* the cloak's shoulders and its leaf clasp */}
      <Cloth d="M-12 -101C-6 -108 8 -108 15 -101C14 -95 10 -93 6 -93C0 -93 -8 -92 -14 -88Z" fill="#33463a" />
      <path d="M8 -101Q11 -104 13 -100Q10 -98 8 -101Z" fill="#a9d8b0" stroke={INK} strokeWidth={0.6} />
      {/* front arm with a leather bracer */}
      <Limb d="M7 -98L14 -79L21 -67" color="#2f3c30" w={7.5} />
      <Limb d="M15 -77L20.5 -68" color="#5a4029" w={7.6} />
      <Hand x={22} y={-64} skin={skin} />
      <Head
        x={5}
        y={-117}
        k={0.95}
        skin={skin}
        brow={hair}
        back={<path d="M-6 -10C-13 -6 -13 6 -11 15Q-7 12 -5 15Q-3 10 -1 8L-2 0Z" fill={hair} stroke={INK} strokeWidth={0.8} />}
      >
        <path d="M0 7.4C2 10.4 7.5 11.6 10 7L9.6 6L10.2 5.2L8 5C6 7 3 7 0 6Z" fill={hair} opacity={0.42} />
        <path d="M8.2 4.2Q10 3.6 11 4.8" fill="none" stroke={hair} strokeWidth={1} opacity={0.7} />
        <path d="M-9 -4C-10 -11 -4 -15 2 -14.5C7 -14 10 -10 9.6 -6C7 -8.5 5 -8 2.4 -9.4C1.6 -6.4 -0.4 -4.4 -2.6 -3.2C-4.6 -1.4 -7 -0.6 -9 2Z" fill={hair} stroke={INK} strokeWidth={0.8} strokeLinejoin="round" />
        <path d="M5 -8.6Q6.4 -6.4 6 -4.6" fill="none" stroke={hair} strokeWidth={1.2} strokeLinecap="round" />
      </Head>
    </g>
  );
}

/* ------------------------------------------------------------------ the soldier with the shield */

function Boromir() {
  const skin = '#d0a283';
  const hair = '#5c3a20';
  const mail = '#8a929e';
  return (
    <g>
      <Cloth d="M-8 -102C-20 -96 -30 -64 -36 -16Q-30 -10 -24 -13Q-18 -8 -12 -13L0 -60L4 -100Z" fill="#4b2a20" />
      {/* round shield on his back */}
      <circle cx={-14} cy={-74} r={18} fill="#6b3022" stroke={INK} strokeWidth={LINE} />
      <circle cx={-14} cy={-74} r={18} fill="url(#fel-shade)" />
      <circle cx={-14} cy={-74} r={13.5} fill="none" stroke="#b9a05e" strokeWidth={1.3} />
      <path d="M-14 -87V-61M-27 -74H-1" stroke="#b9a05e" strokeWidth={0.9} opacity={0.6} />
      <circle cx={-14} cy={-74} r={4} fill="#a7a49a" stroke={INK} strokeWidth={0.8} />
      <Limb d="M-3 -54L-9 -30L-13 -14" color="#30271f" w={8} />
      <Boot x={-17} y={-4} r={22} color="#271c14" />
      <Limb d="M5 -54L11 -30L14 -10" color="#3a2f26" w={8} />
      <Boot x={14} color="#271c14" />
      <path d="M0 -110L1 -102" stroke={skin} strokeWidth={6} strokeLinecap="round" />
      {/* surcoat over mail */}
      <Cloth d="M-11 -100C-4 -106 8 -106 14 -100C16 -86 16 -70 15 -58L18 -38Q3 -33 -14 -38L-11 -58C-13 -72 -13 -88 -11 -100Z" fill="#652a25" />
      <path d="M-11 -100C-4 -106 8 -106 14 -100C16 -86 16 -70 15 -58L18 -38Q3 -33 -14 -38L-11 -58C-13 -72 -13 -88 -11 -100Z" fill="url(#fel-mail)" opacity={0.25} />
      <Fold d="M2 -94V-40M-7 -54L-9 -40M11 -54L13 -40" color="#3a1612" />
      <path d="M-4 -92L2 -86L8 -92" fill="none" stroke="#c4ab66" strokeWidth={1} opacity={0.8} />
      <Rim d="M15 -96C16 -84 16 -70 15.4 -60" />
      <path d="M-12 -59Q2 -55 16 -60" fill="none" stroke="#1d150e" strokeWidth={3.6} strokeLinecap="round" />
      {/* the great horn at his belt */}
      <path d="M-12 -56Q-16 -44 -10 -36Q-6 -38 -6 -42Q-10 -46 -8 -55Z" fill="#e2d6b2" stroke={INK} strokeWidth={0.8} />
      <path d="M-11 -50l3 0.6M-11 -45l3 0.4" stroke="#9c8c5c" strokeWidth={0.8} />
      {/* mail sleeve */}
      <Limb d="M7 -98L14 -79L21 -67" color={mail} w={7.8} />
      <path d="M7 -98L14 -79L21 -67" fill="none" stroke="url(#fel-mail)" strokeWidth={7.8} strokeLinecap="round" strokeLinejoin="round" />
      <Limb d="M17 -73L21 -67" color="#4a3624" w={7.8} />
      <Hand x={22} y={-64} skin={skin} />
      {/* fur collar */}
      <Cloth d="M-12 -101C-6 -110 10 -110 16 -101C14 -95 8 -94 2 -94C-4 -94 -9 -95 -12 -101Z" fill="#6f6050" />
      <path d="M-9 -98l-1 3M-4 -96l-0.6 3M1 -95.6l0 3M6 -95.6l0.6 3M11 -97l1 3" stroke="#4a3e32" strokeWidth={0.9} strokeLinecap="round" />
      <Head x={5} y={-118} k={0.96} skin={skin} brow={hair}>
        <path d="M0 6.4C1.6 10.6 6.6 12 9.6 9L10 7L9.6 6L8.6 5.6C6.6 7.4 3 7.6 0 5Z" fill={hair} stroke={INK} strokeWidth={0.6} />
        <path d="M7.6 4.4Q10 3.4 11.4 5.2Q9.6 5.4 8.4 5Z" fill={hair} />
        <path d="M-9 -3C-10 -11 -4 -15 2 -14.5C7 -14 10 -10 9.6 -7C7 -9 4 -9 1 -9.4C0 -7 -1.4 -5.6 -3 -4.2C-5 -3.2 -6.6 -1 -8 0.6Z" fill={hair} stroke={INK} strokeWidth={0.8} strokeLinejoin="round" />
      </Head>
    </g>
  );
}

/* ------------------------------------------------------------------ the archer */

function Legolas() {
  const skin = '#e2c3a6';
  const hair = '#e0d096';
  return (
    <g>
      <Cloth d="M-6 -100C-16 -92 -24 -66 -28 -36Q-23 -32 -19 -35Q-14 -30 -10 -35L0 -64L4 -98Z" fill="#3c4c43" />
      {/* quiver with its arrows */}
      <path d="M-4 -108L-1 -120M-6 -108L-5 -121M-8 -107L-9 -119" stroke="#d8d0b8" strokeWidth={0.9} strokeLinecap="round" />
      <path d="M-2 -118l1.6 -4l1 3.6ZM-5.6 -119l0 -4.4l1.6 3.8ZM-9.4 -117l-1.2 -4.2l2.4 3.4Z" fill="#9fb2bf" stroke={INK} strokeWidth={0.5} />
      <Cloth d="M-9 -110L1 -107L-11 -62L-19 -66Z" fill="#5a4028" />
      <path d="M-8 -101L-1 -99M-14 -78L-8 -76" stroke="#c4a86a" strokeWidth={1.2} />
      <Limb d="M-2 -56L-8 -31L-12 -15" color="#34402f" w={6.8} />
      <Boot x={-16} y={-4} r={22} color="#5d4c36" tall={16} k={0.92} />
      <Limb d="M4 -56L10 -31L13 -12" color="#3c4a39" w={6.8} />
      <Boot x={12.6} color="#5d4c36" tall={16} k={0.92} />
      <Limb d="M-3 -98L-9 -80L-11 -65" color="#435549" w={6.5} />
      <Hand x={-11} y={-62} skin={skin} r={2.9} />
      <path d="M0 -112L1 -101" stroke={skin} strokeWidth={5} strokeLinecap="round" />
      {/* slim tunic */}
      <Cloth d="M-9 -100C-3 -105 7 -105 12 -100C13 -86 13 -70 12 -58L14 -45Q2 -41 -10 -45L-9 -58C-11 -72 -11 -88 -9 -100Z" fill="#4b5f52" />
      <Fold d="M1 -97V-44M-5 -56L-6 -45M8 -56L10 -45" color="#2c3a31" />
      <path d="M-9 -60Q2 -56 13 -61" fill="none" stroke="#6b5434" strokeWidth={2.6} strokeLinecap="round" />
      <Rim d="M12.6 -96C13.4 -84 13.4 -70 12.6 -60" />
      {/* the bow, held out in front */}
      <path d="M24 -124L25 -34" stroke="#ece6d2" strokeWidth={0.7} />
      <path d="M24 -124Q41 -79 25 -34" fill="none" stroke={INK} strokeWidth={4.2} strokeLinecap="round" />
      <path d="M24 -124Q41 -79 25 -34" fill="none" stroke="#a7824e" strokeWidth={2.3} strokeLinecap="round" />
      <Limb d="M6 -98L15 -86L28 -80" color="#435549" w={6.5} />
      <Hand x={31} y={-79} skin={skin} r={2.9} />
      <path d="M7 -101Q10 -105 13 -101Q10 -98 7 -101Z" fill="#a9d8b0" stroke={INK} strokeWidth={0.6} />
      <Head
        x={5}
        y={-121}
        k={0.9}
        skin={skin}
        brow="#bfa76a"
        ear="point"
        back={<path d="M-7 -9C-15 -2 -14 18 -12 34Q-8 30 -6 34Q-4 24 -3 14L0 0Z" fill={hair} stroke={INK} strokeWidth={0.8} />}
      >
        <path d="M-9 -4C-10 -11 -4 -15 2 -14.5C7 -14 10 -10 9.6 -6.4C6 -9 2 -9.2 -2 -8.6C-4 -6 -6 -3 -8.6 0Z" fill={hair} stroke={INK} strokeWidth={0.8} strokeLinejoin="round" />
        <path d="M-4 -9Q-7 -4 -9 2M0 -9.4Q-4 -6 -6 -1" fill="none" stroke="#b8a464" strokeWidth={0.7} />
        <path d="M-6 -5Q-10 6 -11 16" fill="none" stroke="#c9b676" strokeWidth={1.6} strokeLinecap="round" />
      </Head>
    </g>
  );
}

/* ------------------------------------------------------------------ the dwarf */

function Gimli() {
  const skin = '#cf9878';
  const beard = '#a3471f';
  const mail = '#7d8692';
  const coat = 'M-17 -64C-6 -72 12 -72 20 -64C23 -48 24 -34 25 -18Q4 -12 -20 -18C-20 -34 -20 -50 -17 -64Z';
  return (
    <g>
      <Cloth d="M-12 -64C-22 -58 -28 -38 -30 -14Q-25 -10 -20 -13Q-16 -9 -12 -13L-4 -50Z" fill="#46301f" />
      <Limb d="M-4 -34L-8 -20L-11 -11" color="#3a2c20" w={9.5} />
      <Boot x={-16} y={-4} r={18} color="#2a1e14" k={1.2} />
      <Limb d="M5 -34L9 -20L12 -9" color="#45362a" w={9.5} />
      <Boot x={12} color="#2a1e14" k={1.2} />
      {/* mail coat to the knees */}
      <Cloth d={coat} fill={mail} />
      <path d={coat} fill="url(#fel-mail)" opacity={0.85} />
      <path d="M-20 -22Q4 -16 25 -22" fill="none" stroke="#5d6672" strokeWidth={1.6} />
      <Rim d="M21 -60C23 -48 24 -34 24.6 -22" />
      {/* the axe over his shoulder: haft resting on it, a double-bitted head up behind */}
      <Limb d="M30 -36L-6 -104" color="#5d4127" w={3.2} />
      <g transform="translate(-3 -98) rotate(-28)">
        <Cloth d="M1.6 -5Q9 -8 13 -14Q16 -2 13 10Q9 4 1.6 3Z" fill="#aab4c2" />
        <Cloth d="M-1.6 -5Q-9 -8 -13 -14Q-16 -2 -13 10Q-9 4 -1.6 3Z" fill="#9aa4b2" />
        <path d="M11.6 -11Q14 -2 11.6 7.6M-11.6 -11Q-14 -2 -11.6 7.6" fill="none" stroke="#dce6f2" strokeWidth={0.9} />
        <rect x={-2.6} y={-7} width={5.2} height={12} rx={1} fill="#6d7684" stroke={INK} strokeWidth={0.8} />
      </g>
      {/* broad belt */}
      <path d="M-19 -42Q3 -36 24 -43" fill="none" stroke="#2a1d12" strokeWidth={5} strokeLinecap="round" />
      <rect x={6} y={-45} width={7} height={7.4} rx={1.4} fill="#c9a24a" stroke={INK} strokeWidth={0.8} />
      {/* thick mail arm gripping the haft */}
      <Limb d="M10 -62L19 -50L25 -44" color={mail} w={9} />
      <path d="M10 -62L19 -50L25 -44" fill="none" stroke="url(#fel-mail)" strokeWidth={9} strokeLinecap="round" strokeLinejoin="round" />
      <Hand x={26} y={-42} skin={skin} r={3.8} />
      <Head x={5} y={-77} k={1.02} skin={skin} brow={beard}>
        {/* bulbous nose */}
        <path d="M9 -1.6Q13.6 -0.4 13.2 3.4Q11.6 4.8 9.6 3.8Z" fill={skin} stroke={INK} strokeWidth={0.8} />
        {/* the great forked, braided beard */}
        <path d="M-4 1C-7 8 -6 18 -3 26Q-1 32 2 31Q4 28 6 32Q10 30 12 22C14 15 13.6 9 13 5.2L9.6 4.8C8 7 3 7.4 -4 1Z" fill={beard} stroke={INK} strokeWidth={0.8} strokeLinejoin="round" />
        <path d="M-1 8Q0 18 2 26M3 9Q4 18 6 27M7.6 8Q9 16 9.6 24" fill="none" stroke="#6f2c10" strokeWidth={0.7} />
        <path d="M8 3.6Q11.6 3 13.6 6Q11.4 6.8 9.6 5.6Q8 6.6 6.2 6Z" fill="#b8572a" stroke={INK} strokeWidth={0.6} />
        <path d="M1 30Q0 36 1 40M7 31Q8 37 7 41" fill="none" stroke={beard} strokeWidth={2.6} strokeLinecap="round" />
        <rect x={-0.8} y={34} width={3.4} height={2.6} rx={0.8} fill="#d4a24a" stroke={INK} strokeWidth={0.5} />
        <rect x={5.6} y={35} width={3.4} height={2.6} rx={0.8} fill="#d4a24a" stroke={INK} strokeWidth={0.5} />
        <path d="M-6 -6C-8 -2 -8 4 -5 8L-2 4Z" fill={beard} stroke={INK} strokeWidth={0.6} />
        {/* iron helm with a nose guard */}
        <path d="M-10 -3C-11 -12 -4 -17 2 -17C8.6 -17 11.6 -11.6 11.2 -4.6L-10 -3Z" fill="#8f99a8" stroke={INK} strokeWidth={0.9} />
        <path d="M-10 -3C-11 -12 -4 -17 2 -17C8.6 -17 11.6 -11.6 11.2 -4.6L-10 -3Z" fill="url(#fel-shade)" />
        <path d="M-10.4 -3.4Q0 -5.4 11.4 -4.6" fill="none" stroke="#c9a24a" strokeWidth={1.8} />
        <path d="M9.6 -4.6L10.4 2.4" stroke="#8f99a8" strokeWidth={2.2} strokeLinecap="round" />
        <path d="M0 -16.6Q1.4 -10 0.6 -4.6" fill="none" stroke="#c9a24a" strokeWidth={1.2} />
      </Head>
    </g>
  );
}

/* ------------------------------------------------------------------ the four small ones */

type HobbitProps = { hair: string; vest: string; cloak: string; breeches: string; extra: 'sword' | 'pack' | 'pan' | 'pipe' };

function Hobbit({ hair, vest, cloak, breeches, extra }: HobbitProps) {
  const skin = '#ddb08c';
  const shirt = '#d6cdb6';
  const vestD = 'M-8 -50C-3 -54 6 -54 10 -50C12 -42 12 -34 11 -27Q1 -24 -9 -27C-10 -36 -10 -44 -8 -50Z';
  return (
    <g>
      {/* short grey cloak trailing behind */}
      <Cloth d="M-6 -51C-14 -46 -20 -30 -22 -12Q-17 -9 -13 -12Q-9 -8 -5 -13L0 -40Z" fill={cloak} />
      {(extra === 'pack' || extra === 'pan') && (
        <>
          <Cloth d="M-6 -50Q-20 -52 -21 -40Q-22 -28 -16 -24Q-10 -22 -6 -28Z" fill="#5f4a33" />
          <path d="M-20 -40H-8M-20 -33H-8" stroke="#3a2a1a" strokeWidth={0.9} />
          <Cloth d="M-19 -56Q-21 -50 -17 -49L-5 -50Q-2 -52 -4 -56Z" fill="#7b6a4e" />
        </>
      )}
      {extra === 'pan' && (
        <>
          <path d="M-14 -36L-25 -46" stroke={INK} strokeWidth={3} strokeLinecap="round" />
          <path d="M-14 -36L-25 -46" stroke="#4d535d" strokeWidth={1.6} strokeLinecap="round" />
          <ellipse cx={-26} cy={-36} rx={5.6} ry={6.4} fill="#4d535d" stroke={INK} strokeWidth={0.9} />
          <ellipse cx={-26} cy={-36} rx={3.6} ry={4.4} fill="none" stroke="#7a828d" strokeWidth={0.6} />
        </>
      )}
      {/* trailing leg: breeches to the knee, bare shin, big foot */}
      <Limb d="M-2 -28L-6 -18" color={breeches} w={6.4} />
      <Limb d="M-6 -17L-9 -9" color={skin} w={4} />
      <BareFoot x={-12} y={-3} r={20} skin={skin} />
      <Limb d="M3 -28L7 -18" color={breeches} w={6.4} />
      <Limb d="M7 -17L9 -7" color={skin} w={4} />
      <BareFoot x={8} skin={skin} />
      <Limb d="M-4 -48L-8 -39L-8 -32" color={shirt} w={5} />
      <Hand x={-8} y={-30} skin={skin} r={2.6} />
      <path d="M0 -60L0.6 -52" stroke={skin} strokeWidth={4.4} strokeLinecap="round" />
      {/* shirt and waistcoat */}
      <Cloth d="M-8 -51C-3 -55 6 -55 10 -51L9 -46L-7 -46Z" fill={shirt} />
      <Cloth d={vestD} fill={vest} />
      <path d="M1 -51L1.6 -26" stroke={INK} strokeWidth={0.6} opacity={0.6} />
      <circle cx={3.6} cy={-45} r={0.9} fill="#e0c068" />
      <circle cx={3.8} cy={-39} r={0.9} fill="#e0c068" />
      <circle cx={4} cy={-33} r={0.9} fill="#e0c068" />
      <Rim d="M10.6 -48C11.6 -42 11.6 -34 11 -29" w={1.1} />
      <path d="M-4 -53Q-1 -57 3 -53Q-1 -50 -4 -53Z" fill="#a9d8b0" stroke={INK} strokeWidth={0.5} />
      {extra === 'sword' && (
        <>
          <path d="M16 -30L26 -8" stroke={INK} strokeWidth={3.2} strokeLinecap="round" />
          <path d="M16 -30L26 -8" stroke="#a8dcff" strokeWidth={1.6} strokeLinecap="round" />
          <path d="M16 -30L26 -8" stroke="#6fb8ff" strokeWidth={4} strokeLinecap="round" opacity={0.25} />
          <path d="M12 -30L18 -33" stroke="#b9a05e" strokeWidth={1.8} strokeLinecap="round" />
        </>
      )}
      {/* front arm */}
      <Limb d="M5 -48L10 -39L14 -33" color={shirt} w={5} />
      <Hand x={15} y={-31} skin={skin} r={2.6} />
      {extra === 'pipe' && (
        <>
          <path d="M11 -56Q16 -55 19 -57" fill="none" stroke="#5a3e24" strokeWidth={1.4} strokeLinecap="round" />
          <path d="M18 -57L19 -61L21.6 -60.4L21 -57Z" fill="#5a3e24" stroke={INK} strokeWidth={0.5} />
          <path d="M20 -62Q18 -66 21 -69Q24 -72 22 -76" fill="none" stroke="#c8d6e8" strokeWidth={1} opacity={0.5} strokeLinecap="round" />
        </>
      )}
      <Head x={3} y={-62} k={0.8} skin={skin} brow={hair} ear="small">
        <path d={curls()} fill={hair} stroke={INK} strokeWidth={0.8} strokeLinejoin="round" />
        <path d="M-6 -8a2 2 0 0 1 3 -1M-2 -11a2 2 0 0 1 3 0M3 -11a2 2 0 0 1 3 1M-8 -2a2 2 0 0 1 2 -2" fill="none" stroke="#000" strokeWidth={0.6} opacity={0.3} />
      </Head>
    </g>
  );
}

/** One traveller facing right, feet at (0, 0). */
export function Figure({ kind }: { kind: WalkerKind }) {
  switch (kind) {
    case 'gandalf':
      return <Gandalf />;
    case 'aragorn':
      return <Aragorn />;
    case 'boromir':
      return <Boromir />;
    case 'legolas':
      return <Legolas />;
    case 'gimli':
      return <Gimli />;
    case 'frodo':
      return <Hobbit hair="#2e2116" vest="#4a5a7a" cloak="#6e7c76" breeches="#4a3e30" extra="sword" />;
    case 'sam':
      return <Hobbit hair="#7a5430" vest="#5f6e36" cloak="#646a58" breeches="#55432e" extra="pan" />;
    case 'merry':
      return <Hobbit hair="#8f6034" vest="#7e3f32" cloak="#6e786a" breeches="#4a4036" extra="pack" />;
    case 'pippin':
      return <Hobbit hair="#b88d40" vest="#3c5a72" cloak="#727a70" breeches="#504234" extra="pipe" />;
  }
}
