/** A safe: body with feet, door with hinges and handle, and a combination dial. Same sizing/stroke conventions as the lucide icons. */
export function VaultIcon({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.3}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {/* body and feet */}
      <rect x="2.5" y="2" width="19" height="17.5" rx="1.8" />
      <path d="M6 19.5V22h3v-2.5M15 19.5V22h3v-2.5" />
      {/* door */}
      <rect x="5.7" y="5" width="12.6" height="11.5" rx="0.4" />
      {/* hinges */}
      <rect x="3.9" y="7" width="1.8" height="3.2" rx="0.9" />
      <rect x="3.9" y="11.8" width="1.8" height="3.2" rx="0.9" />
      {/* handle */}
      <rect x="17.4" y="9" width="1.9" height="3.6" rx="0.4" />
      {/* dial */}
      <circle cx="11.7" cy="10.75" r="3.6" />
      <circle cx="11.7" cy="10.75" r="0.55" />
      <path d="M12.4 11.45l1.9 1.9M11 11.45l-1.9 1.9M12.4 10.05l1.9-1.9M11 10.05l-1.9-1.9" />
    </svg>
  );
}
