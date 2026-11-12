import { useCallback, useEffect, useRef, useState } from 'react';

type ToastAction = { label: string; onClick: () => void };
type ToastState = { id: number; text: string; error: boolean; action?: ToastAction };

export function useToast() {
  const [current, setCurrent] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const toast = useCallback((text: string, error = false, action?: ToastAction) => {
    clearTimeout(timer.current);
    setCurrent({ id: Date.now(), text, error, action });
    // Leave more time when there's something to click.
    timer.current = setTimeout(() => setCurrent(null), action ? 8000 : 4000);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  const toastNode = current ? (
    <div key={current.id} className={`toast ${current.error ? 'toast--error' : ''}`} role="status">
      <span>{current.text}</span>
      {current.action && (
        <button
          className="toast__action"
          onClick={() => {
            current.action?.onClick();
            setCurrent(null);
          }}
        >
          {current.action.label}
        </button>
      )}
    </div>
  ) : null;

  return { toast, toastNode };
}
