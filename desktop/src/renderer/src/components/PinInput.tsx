import { useEffect, useRef, useState } from 'react';

type Props = {
  onComplete: (pin: string) => void;
  disabled?: boolean;
  /** Changing this plays the shake animation. */
  errorKey?: number;
  label: string;
  autoFocus?: boolean;
};

export function PinInput({ onComplete, disabled, errorKey = 0, label, autoFocus = true }: Props) {
  const [value, setValue] = useState('');
  const ref = useRef<HTMLInputElement>(null);

  // The input element stays mounted so fast typing after a wrong PIN is never lost.
  useEffect(() => {
    if (!disabled) ref.current?.focus();
  }, [errorKey, disabled]);

  return (
    <div className="pin" onClick={() => ref.current?.focus()}>
      <div key={errorKey} className={`pin__cells ${errorKey ? 'pin--shake' : ''}`}>
        {[0, 1, 2, 3].map((i) => (
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
        maxLength={4}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, '').slice(0, 4);
          if (digits.length === 4) {
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
