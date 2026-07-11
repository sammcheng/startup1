"use client";

import type { CSSProperties, FormEvent } from "react";
import { useEffect, useEffectEvent, useState } from "react";

import { useCurrentAccount } from "@/hooks/useAuth";
import { api } from "@/lib/api";
import type { APIKeyCreateResponse, APIKeyListItem } from "@/types/api-key";

interface ApiKeyManagerProps {
  onActiveCountChange: (count: number) => void;
}

type LoadStatus = "idle" | "loading" | "ready" | "error";

export default function ApiKeyManager({ onActiveCountChange }: ApiKeyManagerProps) {
  const { getToken, isLoaded, isSignedIn, userId } = useCurrentAccount();
  const [keys, setKeys] = useState<APIKeyListItem[]>([]);
  const [status, setStatus] = useState<LoadStatus>("idle");
  const [name, setName] = useState("Default");
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [pendingRevokeId, setPendingRevokeId] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reportLoadedCount = useEffectEvent(onActiveCountChange);

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      setKeys([]);
      setStatus("idle");
      reportLoadedCount(0);
      return;
    }

    let active = true;
    async function loadKeys() {
      setStatus("loading");
      setError(null);
      try {
        const token = await getToken();
        const result = await api.get<APIKeyListItem[]>("/api-keys", { token });
        if (!active) return;
        setKeys(result);
        setStatus("ready");
        reportLoadedCount(result.filter((key) => key.is_active).length);
      } catch (loadError) {
        if (!active) return;
        setKeys([]);
        setStatus("error");
        setError(errorMessage(loadError, "API keys could not be loaded."));
      }
    }

    void loadKeys();
    return () => {
      active = false;
    };
  }, [getToken, isLoaded, isSignedIn, userId]);

  async function createKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName || creating) return;

    setCreating(true);
    setError(null);
    setCopied(false);
    try {
      const token = await getToken();
      const created = await api.post<APIKeyCreateResponse>(
        "/api-keys",
        { name: trimmedName },
        { token },
      );
      const nextKey: APIKeyListItem = {
        id: created.id,
        key_prefix: created.key_prefix,
        name: created.name,
        is_active: true,
        last_used_at: null,
        created_at: new Date().toISOString(),
      };
      const nextKeys = [nextKey, ...keys];
      setKeys(nextKeys);
      onActiveCountChange(nextKeys.filter((key) => key.is_active).length);
      setNewSecret(created.key);
      setName("Default");
      setStatus("ready");
    } catch (createError) {
      setError(errorMessage(createError, "The API key could not be created."));
    } finally {
      setCreating(false);
    }
  }

  async function revokeKey(keyId: string) {
    if (revokingId) return;
    setRevokingId(keyId);
    setError(null);
    try {
      const token = await getToken();
      await api.delete<void>(`/api-keys/${keyId}`, { token });
      const nextKeys = keys.map((key) => (
        key.id === keyId ? { ...key, is_active: false } : key
      ));
      setKeys(nextKeys);
      onActiveCountChange(nextKeys.filter((key) => key.is_active).length);
      setPendingRevokeId(null);
    } catch (revokeError) {
      setError(errorMessage(revokeError, "The API key could not be revoked."));
    } finally {
      setRevokingId(null);
    }
  }

  async function copySecret() {
    if (!newSecret) return;
    try {
      await navigator.clipboard.writeText(newSecret);
      setCopied(true);
    } catch {
      setError("Clipboard access was blocked. Select the key and copy it manually.");
    }
  }

  if (!isSignedIn) {
    return <p style={mutedTextStyle}>Sign in to create and manage account API keys.</p>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <form onSubmit={createKey} style={{ display: "grid", gap: 8 }}>
        <label htmlFor="api-key-name" style={labelStyle}>Key name</label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            id="api-key-name"
            name="api-key-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={50}
            required
            style={inputStyle}
          />
          <button type="submit" disabled={creating || !name.trim()} style={primaryButtonStyle}>
            {creating ? "Creating..." : "Create API key"}
          </button>
        </div>
      </form>

      {newSecret ? (
        <div role="status" style={secretPanelStyle}>
          <strong style={{ color: "var(--text)", fontSize: 12.5 }}>Copy this key now. It will not be shown again.</strong>
          <input aria-label="New API key" readOnly value={newSecret} style={secretInputStyle} />
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={copySecret} style={secondaryButtonStyle}>
              {copied ? "Copied" : "Copy key"}
            </button>
            <button type="button" onClick={() => setNewSecret(null)} style={secondaryButtonStyle}>
              Dismiss
            </button>
          </div>
        </div>
      ) : null}

      {error ? <p role="alert" style={errorStyle}>{error}</p> : null}
      {status === "loading" ? <p style={mutedTextStyle}>Loading account keys...</p> : null}
      {status === "ready" && keys.length === 0 ? <p style={mutedTextStyle}>No API keys yet.</p> : null}

      {keys.length > 0 ? (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
          {keys.map((key) => (
            <li key={key.id} style={keyRowStyle}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <strong style={{ color: "var(--text)", fontSize: 13 }}>{key.name}</strong>
                  <span style={{ ...statusStyle, color: key.is_active ? "#16a34a" : "var(--muted)" }}>
                    {key.is_active ? "Active" : "Revoked"}
                  </span>
                </div>
                <div style={keyMetaStyle}>
                  {key.key_prefix}... - Created {formatDate(key.created_at)} - Last used {key.last_used_at ? formatDate(key.last_used_at) : "never"}
                </div>
              </div>
              {key.is_active ? (
                pendingRevokeId === key.id ? (
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      type="button"
                      onClick={() => void revokeKey(key.id)}
                      disabled={revokingId === key.id}
                      style={dangerButtonStyle}
                    >
                      {revokingId === key.id ? "Revoking..." : "Confirm"}
                    </button>
                    <button type="button" onClick={() => setPendingRevokeId(null)} style={secondaryButtonStyle}>
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button type="button" onClick={() => setPendingRevokeId(key.id)} style={secondaryButtonStyle}>
                    Revoke
                  </button>
                )
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const labelStyle: CSSProperties = {
  color: "var(--muted)",
  fontSize: 11,
  fontFamily: "var(--font-mono)",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
};

const inputStyle: CSSProperties = {
  flex: "1 1 180px",
  minWidth: 0,
  border: "1px solid var(--border)",
  borderRadius: 8,
  background: "var(--bg)",
  color: "var(--text)",
  padding: "9px 10px",
};

const primaryButtonStyle: CSSProperties = {
  border: 0,
  borderRadius: 8,
  background: "var(--blue)",
  color: "#fff",
  fontWeight: 700,
  padding: "9px 12px",
  cursor: "pointer",
};

const secondaryButtonStyle: CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 7,
  background: "var(--card)",
  color: "var(--text)",
  fontSize: 11.5,
  fontWeight: 700,
  padding: "6px 9px",
  cursor: "pointer",
};

const dangerButtonStyle: CSSProperties = {
  ...secondaryButtonStyle,
  borderColor: "rgba(220, 38, 38, 0.35)",
  color: "#dc2626",
};

const secretPanelStyle: CSSProperties = {
  display: "grid",
  gap: 8,
  padding: 12,
  border: "1px solid rgba(22, 163, 74, 0.3)",
  borderRadius: 9,
  background: "rgba(22, 163, 74, 0.07)",
};

const secretInputStyle: CSSProperties = {
  width: "100%",
  minWidth: 0,
  border: "1px solid var(--border)",
  borderRadius: 7,
  background: "var(--bg)",
  color: "var(--text)",
  padding: "8px 9px",
  fontFamily: "var(--font-mono)",
  fontSize: 11,
};

const keyRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  flexWrap: "wrap",
  border: "1px solid var(--border)",
  borderRadius: 9,
  background: "var(--bg)",
  padding: "10px 11px",
};

const keyMetaStyle: CSSProperties = {
  color: "var(--muted)",
  fontFamily: "var(--font-mono)",
  fontSize: 10.5,
  lineHeight: 1.5,
  marginTop: 3,
  overflowWrap: "anywhere",
};

const statusStyle: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 10,
  fontWeight: 700,
  textTransform: "uppercase",
};

const mutedTextStyle: CSSProperties = {
  color: "var(--muted)",
  fontSize: 12.5,
  margin: 0,
};

const errorStyle: CSSProperties = {
  ...mutedTextStyle,
  color: "#dc2626",
};
