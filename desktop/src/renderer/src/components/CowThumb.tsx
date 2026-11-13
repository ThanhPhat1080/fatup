/** A small cow drawn in the spirit of the classic `cowsay` one, shown where a link has no preview image. */
export function CowThumb({ size = 56, className = '' }: { size?: number; className?: string }) {
  return (
    <svg className={`cow-thumb ${className}`} width={size} height={size * 0.75} viewBox="0 0 64 48" role="img" aria-hidden fill="none" strokeLinecap="round" strokeLinejoin="round">
      {/* tail */}
      <path d="M52 15c4 1 6 4 5 9" stroke="currentColor" strokeWidth="2" />
      <circle cx="57" cy="26" r="2" fill="currentColor" />
      {/* legs */}
      <path d="M22 34v9M30 34v9M42 34v9M49 33v10" stroke="currentColor" strokeWidth="2.5" />
      {/* body */}
      <rect x="15" y="12" width="40" height="23" rx="9" fill="var(--cow-fill, var(--panel))" stroke="currentColor" strokeWidth="2" />
      {/* spots */}
      <path d="M33 14c5-1 8 2 7 6-1 3-6 3-8 1-2-2-2-6 1-7Z" fill="currentColor" opacity=".75" />
      <path d="M46 24c3 0 5 2 4 5-1 2-4 2-5 0-1-2 0-5 1-5Z" fill="currentColor" opacity=".75" />
      {/* udder */}
      <path d="M36 35c0 4 5 4 5 0" stroke="currentColor" strokeWidth="2" />
      {/* head */}
      <rect x="3" y="14" width="19" height="17" rx="7" fill="var(--cow-fill, var(--panel))" stroke="currentColor" strokeWidth="2" />
      <path d="M7 14c-3-3-3-6-2-8M18 14c3-3 3-6 2-8" stroke="currentColor" strokeWidth="2" />
      <path d="M2 18c-2 0-3 2-2 3M23 18c2 0 3 2 2 3" stroke="currentColor" strokeWidth="2" />
      <circle cx="9" cy="21" r="1.6" fill="currentColor" />
      <circle cx="16" cy="21" r="1.6" fill="currentColor" />
      {/* snout */}
      <rect x="6" y="24" width="13" height="7" rx="3.5" fill="currentColor" opacity=".18" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="10.5" cy="27.5" r="1" fill="currentColor" />
      <circle cx="14.5" cy="27.5" r="1" fill="currentColor" />
    </svg>
  );
}
