import type { ReactNode } from 'react';
import { DoorBody, DoorDefs } from './MoriaDoor';

type Props = {
  /** The PIN input. */
  children: ReactNode;
  /** The error line and the "forgot PIN" button. */
  below?: ReactNode;
};

/** The part of the 1600 x 900 scene that holds the gate: its arch, runes, pillars and the stone around them. */
const VIEW = { x: 525, y: 190, w: 550, h: 470 };
const VIEW_BOX = `${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}`;

/**
 * The lock screen on a phone: the Doors of Durin and nothing else. The full scene (lake, company, trees, tentacles, drifting light)
 * is too heavy for a phone's browser, so none of it is drawn. The door is the same drawing as in LockMoria (MoriaDoor.tsx): the arch of
 * runes, the pillars, the two leaves with their trees, crown and star.
 *
 * The carving is lit by a second, transparent SVG laid over the first. It is painted once, glow filter included, and its opacity is
 * all that changes ("stage lighting", as in the full scene), so the flicker is composited, not repainted. It stops under
 * prefers-reduced-motion.
 */
export function LockGate({ children, below }: Props) {
  return (
    <div className="gate">
      <div className="gate__halo" aria-hidden />
      <div className="gate__door">
        <svg className="gate__base" viewBox={VIEW_BOX} aria-hidden>
          <defs>
            <DoorDefs />
          </defs>
          {/* the mountain wall around the door */}
          <rect x={VIEW.x} y={VIEW.y} width={VIEW.w} height={VIEW.h} fill="url(#moria-rock)" />
          <rect x={VIEW.x} y={VIEW.y} width={VIEW.w} height={VIEW.h} fill="#050a16" opacity={0.35} />
          <DoorBody />
          {/* the carving, faintly there; the lit copy is the other SVG */}
          <use href="#moria-frame" opacity={0.16} />
          <use href="#moria-inner" opacity={0.16} />
          <rect x={VIEW.x} y={640} width={VIEW.w} height={VIEW.y + VIEW.h - 640} fill="#0a1220" />
        </svg>
        <svg className="gate__lit" viewBox={VIEW_BOX} aria-hidden>
          <g filter="url(#moria-glow)">
            <use href="#moria-frame" />
          </g>
          <g filter="url(#moria-glow)">
            <use href="#moria-inner" />
          </g>
        </svg>
      </div>
      <div className="gate__pin">{children}</div>
      {below && <div className="gate__below">{below}</div>}
    </div>
  );
}
