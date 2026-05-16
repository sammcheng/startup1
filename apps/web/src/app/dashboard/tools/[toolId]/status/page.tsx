"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useParams } from "next/navigation";

import { api } from "@/lib/api";
import type { ToolStatusResponse } from "@/types/tool";

export default function ToolStatusPage() {
  const params = useParams<{ toolId: string }>();
  const { getToken, isLoaded } = useAuth();
  const [toolStatus, setToolStatus] = useState<ToolStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoaded || !params.toolId) {
      return;
    }

    let isCancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;

    async function loadStatus() {
      try {
        const token = await getToken();
        const response = await api.get<ToolStatusResponse>(`/tools/${params.toolId}/status`, { token });
        if (!isCancelled) {
          setToolStatus(response);
          setError(null);
        }
        if (response.status === "live" || response.status === "rejected") {
          if (timer) {
            clearInterval(timer);
          }
        }
      } catch (loadError) {
        if (!isCancelled) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load status.");
        }
      }
    }

    void loadStatus();
    timer = setInterval(() => {
      void loadStatus();
    }, 4000);

    return () => {
      isCancelled = true;
      if (timer) {
        clearInterval(timer);
      }
    };
  }, [getToken, isLoaded, params.toolId]);

  return (
    <div>
      <div style={{ marginBottom: 28 }}>
        <p style={{ fontSize: 10.5, fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: ".1em", color: "var(--faint)", marginBottom: 8 }}>Seller Studio</p>
        <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 26, color: "var(--text)", marginBottom: 6 }}>Tool containerization pipeline</h1>
        <p style={{ fontSize: 13.5, color: "var(--muted)" }}>
          This page polls your tool status until the MVP processor marks it live or returns a rejection message.
        </p>
      </div>

      <div style={{ maxWidth: 720, display: "flex", flexDirection: "column", gap: 16 }}>
        {!isLoaded && <Panel title="Loading">Preparing seller session...</Panel>}

        {error && (
          <div style={{ background: "rgba(220,38,38,.06)", border: "1px solid rgba(220,38,38,.2)", borderRadius: "var(--radius-sm)", padding: "10px 16px", fontSize: 13, color: "var(--red)" }}>
            {error}
          </div>
        )}

        {toolStatus && (
          <>
            <Panel title="Current state">
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 32, fontWeight: 700, color: "var(--text)", textTransform: "capitalize", marginBottom: 12 }}>
                {toolStatus.status}
              </div>
              <div style={{ fontSize: 13, color: "var(--muted)", fontFamily: "var(--font-mono)" }}>Tool ID: {toolStatus.tool_id}</div>
              {toolStatus.api_endpoint && (
                <div style={{ fontSize: 13, color: "var(--muted)", fontFamily: "var(--font-mono)", marginTop: 8 }}>API endpoint: {toolStatus.api_endpoint}</div>
              )}
              {toolStatus.error_message && (
                <div style={{ marginTop: 16, background: "rgba(220,38,38,.06)", border: "1px solid rgba(220,38,38,.2)", borderRadius: "var(--radius-sm)", padding: "12px 16px", fontSize: 13, color: "var(--red)" }}>
                  {toolStatus.error_message}
                </div>
              )}
            </Panel>

            <Panel title="Indexed source tree">
              <div style={{ maxHeight: 320, overflowY: "auto", background: "var(--elevated)", borderRadius: "var(--radius-sm)", padding: 16, fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--muted)" }}>
                {toolStatus.source_file_tree?.length ? (
                  toolStatus.source_file_tree.map((item) => (
                    <div key={item} style={{ padding: "3px 0" }}>
                      {item}
                    </div>
                  ))
                ) : (
                  <div style={{ color: "var(--faint)" }}>No source tree available yet.</div>
                )}
              </div>
            </Panel>
          </>
        )}
      </div>
    </div>
  );
}

function Panel(props: { title: string; children: ReactNode }) {
  return (
    <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", overflow: "hidden" }}>
      <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--border)" }}>
        <p style={{ fontSize: 10.5, fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: ".1em", color: "var(--faint)" }}>{props.title}</p>
      </div>
      <div style={{ padding: 20 }}>{props.children}</div>
    </div>
  );
}
