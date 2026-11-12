import { useCallback, useEffect, useRef, useState } from 'react';

type ToastState = { id: number; text: string; error: boolean };

export function useToast() {
  const [current, setCurrent] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const toast = useCallback((text: string, error = false) => {
    clearTimeout(timer.current);
    setCurrent({ id: Date.now(), text, error });
    timer.current = setTimeout(() => setCurrent(null), 4000);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  const toastNode = current ? (
    <div key={current.id} className={`toast ${current.error ? 'toast--error' : ''}`} role="status">
      {current.text}
    </div>
  ) : null;

  return { toast, toastNode };
}
