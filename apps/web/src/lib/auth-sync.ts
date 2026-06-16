"use client";

import { api } from "@/lib/api";
import type { AppUser } from "@/lib/auth-context";

export interface AuthSyncResponse {
  id: string;
  clerk_id: string;
  email: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  role: string;
  is_active: boolean;
}

export function buildAuthSyncPayload(user: AppUser) {
  const primaryEmail = user.emailAddresses[0]?.emailAddress;
  if (!primaryEmail) return null;

  return {
    email: primaryEmail,
    username: user.username ?? undefined,
    display_name: user.fullName ?? user.username ?? primaryEmail.split("@")[0],
    avatar_url: user.imageUrl ?? undefined,
  };
}

export async function syncCurrentUser(
  user: AppUser,
  token: string | null,
): Promise<AuthSyncResponse | null> {
  if (!token) return null;

  const payload = buildAuthSyncPayload(user);
  if (!payload) return null;

  return api.post<AuthSyncResponse>("/auth/sync", payload, { token });
}

