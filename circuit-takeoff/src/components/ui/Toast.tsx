"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Button } from "./Button";

export type ToastItem = {
  id: string;
  message: string;
  onRetry?: () => void;
};

type ToastContextValue = {
  showError: (message: string, onRetry?: () => void) => void;
  dismiss: (id: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showError = useCallback(
    (message: string, onRetry?: () => void) => {
      const id = crypto.randomUUID();
      setToasts((prev) => [...prev.slice(-2), { id, message, onRetry }]);
      if (!onRetry) {
        window.setTimeout(() => dismiss(id), 6000);
      }
    },
    [dismiss]
  );

  const value = useMemo(
    () => ({ showError, dismiss }),
    [showError, dismiss]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2"
        aria-live="polite"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto rounded-lg border border-perry-signal/40 bg-white px-3 py-2.5 shadow-lg"
          >
            <p className="text-sm text-perry-signal">{t.message}</p>
            <div className="mt-2 flex justify-end gap-2">
              {t.onRetry && (
                <Button
                  type="button"
                  variant="secondary"
                  className="text-xs"
                  onClick={() => {
                    dismiss(t.id);
                    t.onRetry?.();
                  }}
                >
                  Retry
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                className="text-xs"
                onClick={() => dismiss(t.id)}
              >
                Dismiss
              </Button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    return {
      showError: (message) => {
        console.error(message);
      },
      dismiss: () => undefined,
    };
  }
  return ctx;
}
