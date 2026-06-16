"use client";

import { createContext, useContext } from "react";

export interface AppUser {
  id: string;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  fullName: string | null;
  imageUrl: string | null;
  emailAddresses: { emailAddress: string }[];
}

export interface AppAuthContextValue {
  getToken: () => Promise<string | null>;
  isLoaded: boolean;
  isSignedIn: boolean;
  userId: string | null;
  user: AppUser | null;
  signOut: (() => Promise<void>) | null;
  isAuthConfigured: boolean;
}

export const guestAuthValue: AppAuthContextValue = {
  getToken: async () => null,
  isLoaded: true,
  isSignedIn: false,
  userId: null,
  user: null,
  signOut: null,
  isAuthConfigured: false,
};

export const AuthContext = createContext<AppAuthContextValue>(guestAuthValue);

export function useAuthContext(): AppAuthContextValue {
  return useContext(AuthContext);
}

