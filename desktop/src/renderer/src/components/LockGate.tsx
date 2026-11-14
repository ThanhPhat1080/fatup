import type { ReactNode } from 'react';
import { CX, DoorBody, DoorDefs } from './MoriaDoor';

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

/** The part of the 1600 x 900 scene that holds the gate: its arch, runes, pillars and the stone around them. */
const VIEW = { x: 525, y: 190, w: 550, h: 470 };
const VIEW_BOX = `${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}`;

/**
 * The lock screen on a phone: the Doors of Durin and nothing else. The full scene (lake, company, trees, tentacles, drifting light)
 * is too heavy for a phone's browser, so none of it is drawn. The door is the same drawing as in LockMoria (MoriaDoor.tsx), drawn a
 * little taller (the SVG is stretched), with the PIN on its body.
 *
 * The carving is lit by a second, transparent SVG laid over the first. It is painted once, glow filter included, and its opacity is
 * all that changes ("stage lighting", as in the full scene), so the flicker is composited, not repainted. A wrong PIN makes it
 * stutter; the right one swings the leaves open and floods the screen with light, like the full scene.
 */
export function LockGate({ open, panicKey, children, below }: Props) {
  return (
    <div className={`gate${open ? ' gate--open' : ''}`}>
      <div className="gate__halo" aria-hidden />
      <div className="gate__door">
        <svg className="gate__base" viewBox={VIEW_BOX} preserveAspectRatio="none" aria-hidden>
          <defs>
            <DoorDefs />
          </defs>
          {/* the mountain wall around the door */}
          <rect x={VIEW.x} y={VIEW.y} width={VIEW.w} height={VIEW.h} fill="url(#moria-rock)" />
          <rect x={VIEW.x} y={VIEW.y} width={VIEW.w} height={VIEW.h} fill="#050a16" opacity={0.35} />
          <DoorBody burst />
          {/* the carving, faintly there; the lit copy is the other SVG */}
          <use href="#moria-frame" opacity={0.16} />
          <use href="#moria-inner" opacity={0.16} />
          <rect x={VIEW.x} y={640} width={VIEW.w} height={VIEW.y + VIEW.h - 640} fill="#0a1220" />
          {open && <circle className="moria__burst" cx={CX} cy={500} r={140} fill="url(#moria-burst)" />}
        </svg>
        <svg key={panicKey} className={`gate__lit${panicKey ? ' gate__lit--panic' : ''}`} viewBox={VIEW_BOX} preserveAspectRatio="none" aria-hidden>
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
