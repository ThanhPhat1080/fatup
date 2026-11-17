import { useEffect, useRef, useState } from 'react';

type Props = {
  onComplete: (pin: string) => void;
  disabled?: boolean;
  /** Changing this plays the shake animation. */
  errorKey?: number;
  label: string;
  autoFocus?: boolean;
  /** Number of digits; the app PIN is 4, the Vault PIN 6. */
  length?: number;
};

export function PinInput({ onComplete, disabled, errorKey = 0, label, autoFocus = true, length = 4 }: Props) {
  const [value, setValue] = useState('');
  const ref = useRef<HTMLInputElement>(null);

  // The input element stays mounted so fast typing after a wrong PIN is never lost.
  useEffect(() => {
    if (!disabled) ref.current?.focus();
  }, [errorKey, disabled]);

  return (
    <div className={`pin${length > 4 ? ' pin--long' : ''}`} onClick={() => ref.current?.focus()}>
      <div key={errorKey} className={`pin__cells ${errorKey ? 'pin--shake' : ''}`}>
        {Array.from({ length }, (_, i) => (
          <span key={i} className={`pin__cell ${i < value.length ? 'pin__cell--filled' : ''} ${i === value.length ? 'pin__cell--active' : ''}`} />
        ))}
      </div>
      <input
        ref={ref}
        className="pin__input"
        aria-label={label}
        inputMode="numeric"
        autoComplete="off"
        autoFocus={autoFocus}
        disabled={disabled}
        value={value}
        maxLength={length}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, '').slice(0, length);
          if (digits.length === length) {
            setValue('');
            onComplete(digits);
          } else {
            setValue(digits);
          }
        }}
      />
    </div>
  );
}
