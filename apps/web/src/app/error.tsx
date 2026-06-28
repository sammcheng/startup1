"use client";

import { useEffect } from "react";

import { toPublicErrorDisplay } from "@/lib/error-display";
import { ErrorState } from "@/components/ui/ErrorState";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const display = toPublicErrorDisplay(error, {
    fallbackTitle: "An unexpected error occurred",
    fallbackMessage: "The page failed to render cleanly. Please retry, or use the support ID if this repeats.",
  });

  useEffect(() => {
    console.error("Unhandled app route error", {
      error,
      supportId: display.requestId,
    });
  }, [display.requestId, error]);

  return (
    <ErrorState
      eyebrow="Application recovery"
      title={display.title}
      message={display.message}
      code={display.code}
      requestId={display.requestId}
      status={display.status}
      devDetails={display.devDetails}
      onRetry={reset}
      primaryHref="/"
      primaryLabel="Go home"
    />
  );
}
