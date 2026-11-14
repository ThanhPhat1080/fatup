import type { ReactNode } from 'react';

type Props = {
  /** The PIN input. */
  children: ReactNode;
  /** The error line and the "forgot PIN" button. */
  below?: ReactNode;
};

/**
 * The lock screen on a phone: just the lit gate, standing still. The full scene (lake, company, tentacles, drifting light) is
 * too heavy for a phone's browser, so none of it is drawn. The only movement is the light flickering, done by changing the opacity of
 * two layers (cheap: no filters, nothing is repainted), and it stops under prefers-reduced-motion.
 */
export function LockGate({ children, below }: Props) {
  return (
    <div className="gate">
      <div className="gate__halo" aria-hidden />
      <svg className="gate__svg" viewBox="0 0 240 300" aria-hidden>
        <defs>
          <radialGradient id="gate-light" cx="50%" cy="58%" r="68%">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="0.34" stopColor="#d4edff" />
            <stop offset="0.74" stopColor="#8fd0ff" />
            <stop offset="1" stopColor="#3f78c8" />
          </radialGradient>
          <radialGradient id="gate-flare" cx="50%" cy="58%" r="60%">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="0.55" stopColor="#e9f6ff" stopOpacity={0.75} />
            <stop offset="1" stopColor="#bfe3ff" stopOpacity={0} />
          </radialGradient>
          <linearGradient id="gate-stone" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#24365a" />
            <stop offset="1" stopColor="#101a30" />
          </linearGradient>
        </defs>
        {/* the stone arch, then the doorway with the light behind it */}
        <path d="M14 300V120A106 106 0 0 1 226 120V300Z" fill="url(#gate-stone)" stroke="#34507f" strokeWidth={3} />
        <path d="M44 300V122A76 76 0 0 1 196 122V300Z" fill="url(#gate-light)" />
        <path className="gate__flicker" d="M44 300V122A76 76 0 0 1 196 122V300Z" fill="url(#gate-flare)" />
        {/* the two leaves meet in a seam; a faint line marks where each one starts to curve */}
        <path d="M120 46V300" stroke="#0a1220" strokeOpacity={0.5} strokeWidth={2} />
        <path d="M44 300V122A76 76 0 0 1 196 122V300" fill="none" stroke="#e6f5ff" strokeOpacity={0.9} strokeWidth={2.5} />
        <rect x={0} y={286} width={240} height={14} fill="#0a1220" />
      </svg>
      <div className="gate__pin">{children}</div>
      {below && <div className="gate__below">{below}</div>}
    </div>
  );
}
