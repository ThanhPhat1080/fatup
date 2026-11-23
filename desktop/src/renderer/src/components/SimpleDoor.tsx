import type { ReactNode } from 'react';
import baseUrl from '../assets/door-base.webp';
import litUrl from '../assets/door-lit.webp';

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

/**
 * A light lock door: two pre-rendered images (desktop/scripts/render-door.mjs draws them from MoriaDoor.tsx), nothing drawn at runtime.
 * The base is static; the lit image (only the glowing carving) is the single animated layer and only its opacity breathes, slowly.
 * No SVG art, filter, mask or gradient to repaint (ADR 0020, approach C).
 */
export function SimpleDoor({ open, cells = 4, label, children, below }: Props) {
  return (
    <div className={`sdoor${open ? ' sdoor--open' : ''}${cells === 6 ? ' sdoor--6' : ''}`}>
      <div className="sdoor__door">
        <img className="sdoor__base" src={baseUrl} alt="" aria-hidden draggable={false} decoding="async" />
        <img className="sdoor__lit" src={litUrl} alt="" aria-hidden draggable={false} decoding="async" />
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
