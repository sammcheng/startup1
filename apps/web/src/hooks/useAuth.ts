"use client";

// Stub replacement for @clerk/nextjs useAuth.
// Returns null token in demo mode. Swap for real Clerk when auth is wired up.
export function useAuth() {
  return {
    getToken: async () => null as string | null,
    isLoaded: true,
    isSignedIn: false,
    userId: null,
  };
}

export function useUser() {
  return {
    user: null,
    isLoaded: true,
    isSignedIn: false,
  };
}
