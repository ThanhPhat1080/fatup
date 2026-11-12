import { ArrowUp } from 'lucide-react';

export function Logo({ size = 36 }: { size?: number }) {
  return (
    <span className="logo" style={{ width: size, height: size }} aria-hidden>
      <ArrowUp size={size * 0.6} strokeWidth={2.6} />
    </span>
  );
}
