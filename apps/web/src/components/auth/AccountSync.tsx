"use client";

import { useEffect, useRef } from "react";

import { useCurrentAccount } from "@/hooks/useAuth";
import { syncCurrentUser } from "@/lib/auth-sync";
import type { AppUser } from "@/lib/auth-context";

export function AccountSync() {
  const account = useCurrentAccount();
  const syncedUserRef = useRef<string | null>(null);

  useEffect(() => {
    const user = account.user;
    const userId = account.userId;

    if (!account.isLoaded || !account.isSignedIn || !user || !userId) return;
    if (syncedUserRef.current === userId) return;

    let active = true;
    async function sync(userToSync: AppUser, userIdToSync: string) {
      try {
        const token = await account.getToken();
        const syncedUser = await syncCurrentUser(userToSync, token);
        if (active && syncedUser) syncedUserRef.current = userIdToSync;
      } catch {
        // Keep auth usable even if the API is unavailable; the dashboard fetch will surface status.
      }
    }

    void sync(user, userId);
    return () => {
      active = false;
    };
  }, [account]);

  return null;
}
