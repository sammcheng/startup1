"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";

type ToastVariant = "success" | "error";

interface ToastItem {
  id: string;
  title: string;
  message?: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  pushToast: (toast: Omit<ToastItem, "id">) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);
let toastIdCounter = 0;

function createToastId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  toastIdCounter += 1;
  return `${Date.now()}-${toastIdCounter}`;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const pushToast = useCallback(
    (toast: Omit<ToastItem, "id">) => {
      const id = createToastId();
      setToasts((current) => [...current, { ...toast, id }]);
      window.setTimeout(() => removeToast(id), 5000);
    },
    [removeToast]
  );

  const value = useMemo(() => ({ pushToast }), [pushToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed right-4 top-4 z-[100] flex w-full max-w-sm flex-col gap-3">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto rounded-[24px] border p-4 shadow-2xl shadow-black/30 ${
              toast.variant === "success"
                ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-50"
                : "border-red-400/30 bg-red-400/10 text-red-50"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">{toast.title}</div>
                {toast.message ? <div className="mt-1 text-sm opacity-90">{toast.message}</div> : null}
              </div>
              <button
                type="button"
                onClick={() => removeToast(toast.id)}
                className="text-xs opacity-80 transition hover:opacity-100"
              >
                Dismiss
              </button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider.");
  }
  return context;
}
