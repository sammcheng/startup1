"use client";

import type { ReactNode } from "react";

import { AccountSync } from "@/components/auth/AccountSync";
import { AuthProvider } from "@/components/auth/AuthProvider";
import ErrorBoundary from "@/components/ui/ErrorBoundary";
import { ToastProvider } from "@/components/ui/Toast";

export default function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <AccountSync />
        <ToastProvider>{children}</ToastProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}
