import type { LucideIcon } from 'lucide-react';

/**
 * A two-way switch drawn with an icon at each end, the thumb sitting under the active one (the same control as the theme switch in
 * Settings). `checked` means the `on` icon's side.
 */
export function IconSwitch({
  checked,
  onChange,
  off: Off,
  on: On,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  off: LucideIcon;
  on: LucideIcon;
  label: string;
  /** Greyed out but kept in place, so nothing around it shifts. */
  disabled?: boolean;
}) {
  return (
    <button role="switch" aria-checked={checked} className="theme-switch icon-switch" disabled={disabled} onClick={() => onChange(!checked)} title={label} aria-label={label}>
      <span className="theme-switch__thumb" />
      <Off size={16} className="icon-switch__off" />
      <On size={16} className="icon-switch__on" />
    </button>
  );
}
