"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";

import { useToast } from "@/components/ui/Toast";
import { api } from "@/lib/api";
import type { ApiKeyCreateResponse, ApiKeyRecord } from "@/types/api-key";

export default function ApiKeysPage() {
  const { getToken, isLoaded } = useAuth();
  const [apiKeys, setApiKeys] = useState<ApiKeyRecord[]>([]);
  const [creating, setCreating] = useState(false);
  const [pendingName, setPendingName] = useState("");
  const [createdKey, setCreatedKey] = useState<ApiKeyCreateResponse | null>(null);
  const [keyToRevoke, setKeyToRevoke] = useState<ApiKeyRecord | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const { pushToast } = useToast();

  useEffect(() => {
    if (!isLoaded) return;
    void loadKeys();
  }, [getToken, isLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadKeys() {
    setIsLoading(true);
    try {
      const token = await getToken();
      const data = await api.get<ApiKeyRecord[]>("/api-keys", { token });
      setApiKeys(data);
    } catch {
      pushToast({ title: "Could not load API keys", variant: "error" });
    } finally {
      setIsLoading(false);
    }
  }

  async function handleCreate() {
    const name = pendingName.trim();
    if (!name) { setNameError("Please give this key a name."); return; }
    if (name.length > 50) { setNameError("Key names must be 50 characters or fewer."); return; }
    setNameError(null);
    setIsBusy(true);
    try {
      const token = await getToken();
      const res = await api.post<ApiKeyCreateResponse>("/api-keys", { name }, { token });
      setCreatedKey(res);
      setPendingName("");
      setCreating(false);
      setCopied(false);
      await loadKeys();
      pushToast({ title: "API key created", message: "Copy it before you close the banner.", variant: "success" });
    } catch {
      pushToast({ title: "Could not create API key", variant: "error" });
    } finally {
      setIsBusy(false);
    }
  }

  async function handleRevoke() {
    if (!keyToRevoke) return;
    setIsBusy(true);
    try {
      const token = await getToken();
      await api.delete(`/api-keys/${keyToRevoke.id}`, { token });
      setKeyToRevoke(null);
      await loadKeys();
      pushToast({ title: "API key revoked", variant: "success" });
    } catch {
      pushToast({ title: "Could not revoke API key", variant: "error" });
    } finally {
      setIsBusy(false);
    }
  }

  async function handleCopy() {
    if (!createdKey) return;
    await navigator.clipboard.writeText(createdKey.key);
    setCopied(true);
    pushToast({ title: "Copied to clipboard", variant: "success" });
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 28, flexWrap: "wrap", gap: 12 }}>
        <div>
          <p style={{ fontSize: 10.5, fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: ".1em", color: "var(--faint)", marginBottom: 8 }}>Authentication</p>
          <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 26, color: "var(--text)", marginBottom: 6 }}>API Keys</h1>
          <p style={{ fontSize: 13.5, color: "var(--muted)" }}>One key works across every tool in the marketplace.</p>
        </div>
        <button
          onClick={() => setCreating(true)}
          style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            padding: "10px 22px", borderRadius: "var(--radius-sm)",
            background: "var(--blue)", color: "#fff",
            fontSize: 14, fontWeight: 600, border: "none", cursor: "pointer", flexShrink: 0,
          }}
        >
          + New Key
        </button>
      </div>

      {/* Newly created key banner */}
      {createdKey && (
        <div style={{
          background: "var(--green-dim)", border: "1px solid rgba(22,163,74,.2)",
          borderRadius: "var(--radius-sm)", padding: "16px 20px", marginBottom: 20,
          animation: "fade-up .3s ease both",
        }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: "var(--green)", marginBottom: 8 }}>
            Key created — save it now. You won&apos;t see it again.
          </p>
          <code style={{
            fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--text)",
            background: "var(--elevated)", padding: "8px 14px", borderRadius: 6,
            display: "block", wordBreak: "break-all",
          }}>
            {createdKey.key}
          </code>
          <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
            <button onClick={handleCopy} style={{
              background: "none", border: "1px solid rgba(22,163,74,.3)", borderRadius: 6,
              padding: "5px 14px", fontSize: 12, color: "var(--green)", cursor: "pointer",
              fontFamily: "var(--font-mono)",
            }}>
              {copied ? "Copied ✓" : "Copy"}
            </button>
            <button onClick={() => setCreatedKey(null)} style={{
              background: "none", border: "none", fontSize: 12, color: "var(--faint)", cursor: "pointer",
            }}>
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Create form */}
      {creating && (
        <div style={{
          background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
          padding: 20, marginBottom: 20, animation: "fade-up .25s ease both",
        }}>
          <p style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text)", marginBottom: 12 }}>Create new key</p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <input
              className="input"
              placeholder="Key name (e.g. Production)"
              value={pendingName}
              onChange={(e) => { setPendingName(e.target.value); if (nameError) setNameError(null); }}
              onKeyDown={(e) => e.key === "Enter" && void handleCreate()}
              style={{ maxWidth: 280 }}
            />
            <button onClick={() => void handleCreate()} disabled={isBusy} style={{
              padding: "10px 22px", borderRadius: "var(--radius-sm)", background: "var(--blue)",
              color: "#fff", fontSize: 14, fontWeight: 600, border: "none", cursor: "pointer",
              opacity: isBusy ? .6 : 1,
            }}>
              {isBusy ? "Creating…" : "Create"}
            </button>
            <button onClick={() => { setCreating(false); setNameError(null); }} style={{
              padding: "10px 22px", borderRadius: "var(--radius-sm)", background: "transparent",
              color: "var(--muted)", fontSize: 14, border: "1px solid var(--border)", cursor: "pointer",
            }}>
              Cancel
            </button>
          </div>
          {nameError && <p style={{ marginTop: 8, fontSize: 12, color: "var(--red)" }}>{nameError}</p>}
        </div>
      )}

      {/* Keys table */}
      <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", overflow: "hidden" }}>
        {isLoading ? (
          <div style={{ padding: 24 }}>
            {[...Array(3)].map((_, i) => (
              <div key={i} className="animate-shimmer" style={{ height: 40, borderRadius: 8, marginBottom: 10 }} />
            ))}
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr><th>Name</th><th>Key</th><th>Created</th><th>Last used</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {apiKeys.length ? apiKeys.map((k) => (
                <tr key={k.id}>
                  <td style={{ color: "var(--text)", fontWeight: 500 }}>{k.name}</td>
                  <td><span className="key-chip">{k.key_prefix}••••••••••••••</span></td>
                  <td>{fmtDate(k.created_at)}</td>
                  <td style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
                    {k.last_used_at ? fmtDate(k.last_used_at) : "Never"}
                  </td>
                  <td>
                    <button
                      onClick={() => setKeyToRevoke(k)}
                      disabled={!k.is_active}
                      style={{
                        background: "none", border: "1px solid rgba(220,38,38,.25)", borderRadius: 5,
                        padding: "4px 10px", fontSize: 11.5, color: "var(--red)", cursor: "pointer",
                        fontFamily: "var(--font-mono)", opacity: k.is_active ? 1 : .4,
                      }}
                    >
                      {k.is_active ? "Revoke" : "Revoked"}
                    </button>
                  </td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={5} style={{ padding: "40px 20px", textAlign: "center", color: "var(--faint)", fontFamily: "var(--font-mono)", fontSize: 13 }}>
                    No API keys yet. Create one to start calling live tool endpoints.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Revoke confirm modal */}
      {keyToRevoke && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 50, display: "flex",
          alignItems: "center", justifyContent: "center",
          background: "rgba(0,0,0,.4)", backdropFilter: "blur(4px)", padding: 16,
        }}>
          <div style={{
            width: "100%", maxWidth: 440, background: "var(--card)",
            border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: 24,
          }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--text)", marginBottom: 12 }}>Revoke API key?</h2>
            <p style={{ fontSize: 13.5, color: "var(--muted)", lineHeight: 1.65, marginBottom: 20 }}>
              This will deactivate <span style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}>{keyToRevoke.key_prefix}••••</span>. It will stop working immediately.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button onClick={() => setKeyToRevoke(null)} style={{
                padding: "10px 20px", borderRadius: "var(--radius-sm)", background: "transparent",
                border: "1px solid var(--border)", color: "var(--muted)", cursor: "pointer", fontSize: 14,
              }}>
                Cancel
              </button>
              <button onClick={() => void handleRevoke()} disabled={isBusy} style={{
                padding: "10px 20px", borderRadius: "var(--radius-sm)", background: "var(--red)",
                border: "none", color: "#fff", cursor: "pointer", fontSize: 14, fontWeight: 600,
                opacity: isBusy ? .6 : 1,
              }}>
                {isBusy ? "Revoking…" : "Revoke key"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function fmtDate(v: string) {
  return new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric" }).format(new Date(v));
}
