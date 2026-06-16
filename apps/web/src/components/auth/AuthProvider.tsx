"use client";

import { ClerkProvider, useAuth as useClerkAuth, useUser as useClerkUser } from "@clerk/nextjs";
import type { ReactNode } from "react";
import { useMemo } from "react";

import { AuthContext, guestAuthValue, type AppAuthContextValue } from "@/lib/auth-context";
import { CLERK_PUBLISHABLE_KEY } from "@/lib/env";

function ClerkAuthBridge({ children }: { children: ReactNode }) {
  const { getToken, isLoaded: authLoaded, isSignedIn, signOut, userId } = useClerkAuth();
  const { isLoaded: userLoaded, user } = useClerkUser();

  const value = useMemo<AppAuthContextValue>(
    () => ({
      getToken,
      isLoaded: authLoaded && userLoaded,
      isSignedIn: Boolean(isSignedIn),
      userId: userId ?? null,
      signOut: signOut ? async () => void (await signOut()) : null,
      isAuthConfigured: true,
      user: user
        ? {
            id: user.id,
            firstName: user.firstName,
            lastName: user.lastName,
            username: user.username,
            fullName: user.fullName,
            imageUrl: user.imageUrl,
            emailAddresses: user.emailAddresses.map((email) => ({
              emailAddress: email.emailAddress,
            })),
          }
        : null,
    }),
    [authLoaded, getToken, isSignedIn, signOut, user, userId, userLoaded],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  if (!CLERK_PUBLISHABLE_KEY) {
    return <AuthContext.Provider value={guestAuthValue}>{children}</AuthContext.Provider>;
  }

  return (
    <ClerkProvider
      publishableKey={CLERK_PUBLISHABLE_KEY}
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      signInFallbackRedirectUrl="/dashboard"
      signUpFallbackRedirectUrl="/dashboard"
    >
      <ClerkAuthBridge>{children}</ClerkAuthBridge>
    </ClerkProvider>
  );
}
