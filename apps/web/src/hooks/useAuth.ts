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

interface StubUser {
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  emailAddresses: { emailAddress: string }[];
}

export function useUser(): { user: StubUser | null; isLoaded: boolean; isSignedIn: boolean } {
  return {
    user: null,
    isLoaded: true,
    isSignedIn: false,
  };
}
