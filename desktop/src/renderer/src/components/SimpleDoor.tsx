import type { ReactNode } from 'react';
import { DoorBody, DoorDefs } from './MoriaDoor';

type Props = {
  /** True once the right PIN was entered: the whole door fades out quickly. */
  open: boolean;
  /** 6 for the Vault gate (smaller cells so they fit the door body). */
  cells?: 4 | 6;
  /** Text above the door, e.g. "VAULT". */
  label?: string;
  /** The PIN input; it sits on the body of the door. */
  children: ReactNode;
  /** The error line and the "forgot PIN" button. */
  below?: ReactNode;
};

/** The part of the 1600 x 900 scene that holds the gate (same as LockGate). */
const VIEW_BOX = '525 190 550 560';

/**
 * A light lock door: the Doors of Durin drawn once, with a single transparent layer of lit carving over it whose opacity breathes
 * slowly. No filters, halo, stones, leaves, burst or flash: nothing is repainted while it runs.
 */
export function SimpleDoor({ open, cells = 4, label, children, below }: Props) {
  return (
    <div className={`sdoor${open ? ' sdoor--open' : ''}${cells === 6 ? ' sdoor--6' : ''}`}>
      <div className="sdoor__door">
        <svg className="sdoor__base" viewBox={VIEW_BOX} preserveAspectRatio="none" aria-hidden>
          <defs>
            <DoorDefs glow={false} />
          </defs>
          <rect x={525} y={190} width={550} height={560} fill="url(#moria-rock)" />
          <rect x={525} y={190} width={550} height={560} fill="#050a16" opacity={0.35} />
          <DoorBody />
          <use href="#moria-frame" opacity={0.16} />
          <use href="#moria-inner" opacity={0.16} />
        </svg>
        <svg className="sdoor__lit" viewBox={VIEW_BOX} preserveAspectRatio="none" aria-hidden>
          <use href="#moria-frame" />
          <use href="#moria-inner" />
        </svg>
        {label && (
          <svg className="sdoor__label" viewBox="525 140 550 70" aria-label={label} role="img">
            {/* the text follows the top of the arch (circle of radius 210 around the arch's centre), sitting just above it */}
            <path id="sdoor-label-arc" d="M590 410A210 210 0 0 1 1010 410" fill="none" />
            <text fontSize={34} fontWeight={700} letterSpacing={9} textAnchor="middle" fill="#d6efff">
              <textPath href="#sdoor-label-arc" startOffset="50%">{label}</textPath>
            </text>
          </svg>
        )}
        <div className="sdoor__pin">{children}</div>
      </div>
      {below && <div className="sdoor__below">{below}</div>}
    </div>
  );
}
