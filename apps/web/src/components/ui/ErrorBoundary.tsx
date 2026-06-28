"use client";

import type { ReactNode } from "react";
import { Component } from "react";

import { toPublicErrorDisplay, type PublicErrorDisplay } from "@/lib/error-display";
import { ErrorState } from "@/components/ui/ErrorState";

interface Props { children: ReactNode }
interface State { hasError: boolean; display: PublicErrorDisplay | null }

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, display: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, display: toPublicErrorDisplay(error) };
  }

  componentDidCatch(error: Error, info: unknown) {
    console.error("Client render error", {
      error,
      info,
      display: this.state.display,
    });
  }

  render() {
    if (this.state.hasError) {
      const display = this.state.display ?? toPublicErrorDisplay(null);
      return (
        <ErrorState
          eyebrow="Client recovery"
          title={display.title}
          message={display.message}
          code={display.code}
          requestId={display.requestId}
          status={display.status}
          devDetails={display.devDetails}
          onRetry={() => this.setState({ hasError: false, display: null })}
        />
      );
    }
    return this.props.children;
  }
}
