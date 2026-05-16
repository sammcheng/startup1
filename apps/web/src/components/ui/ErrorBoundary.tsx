"use client";

import type { ReactNode } from "react";
import { Component } from "react";

interface Props { children: ReactNode }
interface State { hasError: boolean; message: string }

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: "" };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message || "Something went wrong." };
  }

  componentDidCatch(error: Error, info: unknown) {
    console.error("ErrorBoundary caught:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-[50vh] items-center justify-center px-6 py-16">
          <div className="w-full max-w-lg rounded-[28px] border border-red-400/20 bg-stone-950/90 p-8 text-center shadow-2xl shadow-black/20">
            <div className="text-xs uppercase tracking-[0.25em] text-red-300/70">Render error</div>
            <h2 className="mt-3 text-2xl font-semibold text-stone-100">We hit a snag loading this screen</h2>
            <p className="mt-3 text-sm leading-6 text-stone-400">{this.state.message}</p>
            <button
              type="button"
              onClick={() => this.setState({ hasError: false, message: "" })}
              className="mt-6 rounded-full bg-red-300 px-5 py-3 text-sm font-semibold text-stone-950 transition hover:bg-red-200"
            >
              Try Again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
