import type { ReactNode } from 'react';
import { Boom } from './Boom';

/** One bundle of dynamite sticks, 54 x 30. */
function Tnt({ x, y }: { x: number; y: number }) {
  return (
    <g>
      <rect x={x} y={y} width={54} height={30} rx={4} fill="#d6322b" stroke="#7d1410" strokeWidth={2.5} />
      <path d={`M${x + 18} ${y + 2}V${y + 28}M${x + 36} ${y + 2}V${y + 28}`} stroke="#9c1f19" strokeWidth={2} />
      <rect x={x} y={y + 10} width={54} height={10} fill="#f1dcae" stroke="#7d1410" strokeWidth={1.5} />
      <text x={x + 27} y={y + 18.4} textAnchor="middle" fontSize={8.5} fontWeight={800} fill="#7d1410" fontFamily="Impact, 'Arial Black', sans-serif">
        TNT
      </text>
    </g>
  );
}

type Props = {
  /** Plays the Marvel-style explosion. */
  boom: boolean;
  /** Changes every time a wrong PIN is entered; the thief panics. */
  panicKey: number;
  /** Text shown on the bomb's display. */
  timer: string;
  /** The PIN input, which sits on the bomb's face. */
  children: ReactNode;
};

/**
 * Cartoon scene behind the Vault PIN: a striped burglar with his fingers in his ears, a safe sitting on a pile of TNT,
 * and a time bomb carrying the PIN field. Pure SVG + CSS, no assets.
 */
export function VaultHeist({ boom, panicKey, timer, children }: Props) {
  return (
    <div className={`heist${boom ? ' heist--boom' : ''}`}>
      <svg className="heist__svg" viewBox="0 0 480 440" aria-hidden>
        <defs>
          <pattern id="heist-stripes" width="10" height="10" patternUnits="userSpaceOnUse">
            <rect width="10" height="10" fill="#f7f7f7" />
            <rect width="10" height="5" fill="#1c1c22" />
          </pattern>
        </defs>

        <g className="heist__actors">
          <ellipse cx="240" cy="424" rx="225" ry="12" fill="rgba(0,0,0,0.16)" />

          {/* TNT pile */}
          <g>
            {[235, 293, 351, 409].map((x) => (
              <Tnt key={x} x={x} y={268} />
            ))}
            {[264, 322, 380].map((x) => (
              <Tnt key={x} x={x} y={237} />
            ))}
            <path d="M432 238q6-16 18-13" fill="none" stroke="#5a4630" strokeWidth={3} strokeLinecap="round" />
            <g className="heist__spark">
              <circle cx={452} cy={225} r={7} fill="#ffb02e" />
              <circle cx={452} cy={225} r={3.5} fill="#fff6c2" />
            </g>
          </g>

          {/* the safe */}
          <g className="heist__vault">
            <rect x={268} y={97} width={160} height={140} rx={10} fill="#6f7f96" stroke="#2f3a4d" strokeWidth={4} />
            <rect x={282} y={111} width={132} height={112} rx={6} fill="#8fa0b8" stroke="#2f3a4d" strokeWidth={3} />
            <rect x={274} y={130} width={10} height={20} rx={4} fill="#2f3a4d" />
            <rect x={274} y={184} width={10} height={20} rx={4} fill="#2f3a4d" />
            <circle cx={340} cy={167} r={30} fill="#f2c14e" stroke="#2f3a4d" strokeWidth={3} />
            <circle cx={340} cy={167} r={18} fill="#e0a82e" stroke="#2f3a4d" strokeWidth={2.5} />
            <circle cx={340} cy={167} r={4} fill="#2f3a4d" />
            <path d="M340 137v8M340 189v8M310 167h8M362 167h8" stroke="#2f3a4d" strokeWidth={3} strokeLinecap="round" />
            <rect x={384} y={150} width={16} height={34} rx={4} fill="#f2c14e" stroke="#2f3a4d" strokeWidth={3} />
          </g>

          {/* the burglar */}
          <g key={panicKey} className={`thief${panicKey ? ' thief--panic' : ''}`}>
            <g className="thief__body">
              <rect x={102} y={266} width={24} height={64} rx={8} fill="url(#heist-stripes)" stroke="#1c1c22" strokeWidth={3} />
              <rect x={134} y={266} width={24} height={64} rx={8} fill="url(#heist-stripes)" stroke="#1c1c22" strokeWidth={3} />
              <rect x={98} y={170} width={64} height={100} rx={14} fill="url(#heist-stripes)" stroke="#1c1c22" strokeWidth={3} />
              <rect x={98} y={258} width={64} height={9} fill="#1c1c22" />
              {/* arms, fingers in the ears */}
              <path d="M104 192L72 172L90 146" fill="none" stroke="#1c1c22" strokeWidth={19} strokeLinecap="round" strokeLinejoin="round" />
              <path d="M104 192L72 172L90 146" fill="none" stroke="url(#heist-stripes)" strokeWidth={13} strokeLinecap="round" strokeLinejoin="round" />
              <path d="M156 192L188 172L170 146" fill="none" stroke="#1c1c22" strokeWidth={19} strokeLinecap="round" strokeLinejoin="round" />
              <path d="M156 192L188 172L170 146" fill="none" stroke="url(#heist-stripes)" strokeWidth={13} strokeLinecap="round" strokeLinejoin="round" />
            </g>

            <g className="thief__head">
              <circle cx={130} cy={132} r={36} fill="#f6c9a0" stroke="#1c1c22" strokeWidth={3} />
              {/* beret */}
              <ellipse cx={126} cy={100} rx={40} ry={17} fill="#1c1c22" />
              <rect x={124} y={80} width={6} height={9} rx={3} fill="#1c1c22" />
              {/* mask with happily closed eyes */}
              <rect x={95} y={121} width={70} height={22} rx={11} fill="#1c1c22" />
              <path d="M107 134q8-9 16 0M137 134q8-9 16 0" fill="none" stroke="#fff" strokeWidth={3.2} strokeLinecap="round" />
              <circle cx={106} cy={149} r={5} fill="#f4a3a3" opacity={0.7} />
              <circle cx={154} cy={149} r={5} fill="#f4a3a3" opacity={0.7} />
              {/* big grin, or a scream when the PIN was wrong */}
              <g className="thief__grin">
                <path d="M108 148Q130 176 152 148Z" fill="#7a1f1f" stroke="#1c1c22" strokeWidth={2.5} strokeLinejoin="round" />
                <path d="M112 150Q130 158 148 150L146 155Q130 163 114 155Z" fill="#fff" />
              </g>
              <g className="thief__scream">
                <ellipse cx={130} cy={160} rx={11} ry={14} fill="#7a1f1f" stroke="#1c1c22" strokeWidth={2.5} />
              </g>
              {/* hands over the ears */}
              <circle cx={92} cy={136} r={12} fill="#3a3a44" stroke="#1c1c22" strokeWidth={2.5} />
              <circle cx={168} cy={136} r={12} fill="#3a3a44" stroke="#1c1c22" strokeWidth={2.5} />
            </g>
          </g>

          {/* the time bomb */}
          <g>
            <path d="M215 306C213 282 233 292 247 284" fill="none" stroke="#e5383b" strokeWidth={3.5} strokeLinecap="round" />
            <path d="M226 306C229 286 240 298 252 292" fill="none" stroke="#3a86ff" strokeWidth={3.5} strokeLinecap="round" />
            <path d="M74 300V278" stroke="#11131a" strokeWidth={3} strokeLinecap="round" />
            <circle className="heist__led" cx={74} cy={275} r={6} fill="#ff3b30" stroke="#11131a" strokeWidth={2} />
            <rect x={46} y={322} width={20} height={72} rx={6} fill="#c9333a" stroke="#11131a" strokeWidth={3} />
            <rect x={414} y={322} width={20} height={72} rx={6} fill="#c9333a" stroke="#11131a" strokeWidth={3} />
            <rect x={60} y={300} width={360} height={112} rx={22} fill="#2b2f3a" stroke="#11131a" strokeWidth={4} />
            <rect x={78} y={303} width={324} height={9} rx={4.5} fill="#f2c14e" />
            <rect x={80} y={320} width={116} height={56} rx={8} fill="#0b0d10" stroke="#586074" strokeWidth={3} />
            <text x={138} y={392} textAnchor="middle" fontSize={9} fontWeight={700} fill="#9aa3b5" letterSpacing={2}>
              TIMER
            </text>
            <rect x={212} y={318} width={196} height={76} rx={10} fill="#3a4050" stroke="#11131a" strokeWidth={3} />
            <g fill="#8c96ab">
              <circle cx={222} cy={328} r={2.5} />
              <circle cx={398} cy={328} r={2.5} />
              <circle cx={222} cy={384} r={2.5} />
              <circle cx={398} cy={384} r={2.5} />
            </g>
          </g>
        </g>

        {boom && <Boom cx={240} cy={330} />}
      </svg>

      <div className="heist__timer" aria-hidden>
        {timer}
      </div>
      <div className="heist__pin">{children}</div>
      {boom && <div className="heist__flash" />}
    </div>
  );
}
