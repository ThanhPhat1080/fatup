/** A bin whose lid is a separate group, so CSS can swing it open. Same sizing/stroke conventions as the lucide icons. */
export function TrashIcon({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {/* body */}
      <path d="M19 9l-1 11a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 9" />
      <path d="M10 12.5v5M14 12.5v5" />
      {/* lid and handle, hinged at the left edge */}
      <g className="trash-lid">
        <path d="M3 6h18" />
        <path d="M9 6V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V6" />
      </g>
    </svg>
  );
}
