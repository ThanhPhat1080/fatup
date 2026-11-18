/** A trash can with a small vault sitting over its lower right corner. Same sizing and stroke conventions as the lucide icons. */
export function VaultTrashIcon({ size = 20, className }: { size?: number; className?: string }) {
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
      {/* trash can: lid, handle and body */}
      <path d="M3 6h14" />
      <path d="M7 6V4.5A1.5 1.5 0 0 1 8.5 3h3A1.5 1.5 0 0 1 13 4.5V6" />
      <path d="M4.5 6l.9 13a2 2 0 0 0 2 1.9h4.2a2 2 0 0 0 2-1.9l.4-5" />
      <path d="M7.5 10.5v5M10.5 10.5v5" />
      {/* small vault over the lower right corner; its fill hides the can's lines behind it */}
      <g transform="translate(12.2 11.6) scale(0.5)" strokeWidth={2.6}>
        <rect x="2.5" y="2" width="19" height="17.5" rx="1.8" fill="var(--panel)" />
        <rect x="5.7" y="5" width="12.6" height="11.5" rx="0.4" />
        <circle cx="11.7" cy="10.75" r="3.6" />
        <circle cx="11.7" cy="10.75" r="0.55" />
      </g>
    </svg>
  );
}
