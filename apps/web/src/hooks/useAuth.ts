"use client";

import { useAuthContext } from "@/lib/auth-context";

export function useAuth() {
  const { getToken, isLoaded, isSignedIn, userId } = useAuthContext();
  return { getToken, isLoaded, isSignedIn, userId };
}

export function useUser() {
  const { isLoaded, isSignedIn, user } = useAuthContext();
  return { user, isLoaded, isSignedIn };
}

export function useCurrentAccount() {
  return useAuthContext();
}
