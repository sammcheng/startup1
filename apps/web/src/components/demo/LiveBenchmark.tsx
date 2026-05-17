"use client";

import { useEffect, useRef, useState } from "react";

interface Props {
  endpoint: string;
}

type BenchState = "pending" | "running" | "done" | "error";

export default function LiveBenchmark({ endpoint }: Props) {
  const [state, setState] = useState<BenchState>("pending");
  const [times, setTimes] = useState<number[]>([]);
  const [progress, setProgress] = useState(0);
  const hasRun = useRef(false);

  useEffect(() => {
    if (hasRun.current) return;
    hasRun.current = true;
    const t = setTimeout(() => void runBenchmark(), 1800);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runBenchmark() {
    setState("running");
    const results: number[] = [];
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      try {
        await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
      } catch {
        // count the round-trip even on error
      }
      results.push(Math.round(performance.now() - t0));
      setProgress(i + 1);
    }
    setTimes(results);
    setState("done");
  }

  const avg = times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : 0;
  const min = times.length ? Math.min(...times) : 0;
  const max = times.length ? Math.max(...times) : 0;
  const maxBar = max || 1;

  return (
    <div style={{
      borderTop: "1px solid var(--border)",
      paddingTop: 20,
      marginTop: 20,
    }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: 14,
      }}>
        <span style={{
          fontSize: 11, fontFamily: "var(--font-mono)",
          textTransform: "uppercase", letterSpacing: "0.12em",
          color: "var(--faint)",
        }}>
          Live Benchmark
        </span>
        {state === "running" && (
          <span style={{ fontSize: 12, color: "var(--blue)", fontFamily: "var(--font-mono)" }}>
            {progress}/3 calls...
          </span>
        )}
        {state === "done" && (
          <button
            onClick={() => { setTimes([]); setProgress(0); void runBenchmark(); }}
            style={{
              fontSize: 11, color: "var(--muted)", background: "none",
              border: "none", cursor: "pointer", fontFamily: "var(--font-mono)",
            }}
          >
            re-run
          </button>
        )}
      </div>

      {state === "pending" && (
        <div style={{ fontSize: 12, color: "var(--faint)", fontFamily: "var(--font-mono)" }}>
          Running shortly...
        </div>
      )}

      {state === "running" && (
        <div style={{ display: "flex", gap: 6 }}>
          {[0, 1, 2].map((i) => (
            <div key={i} style={{
              flex: 1, height: 6, borderRadius: 3,
              background: i < progress ? "var(--blue)" : "var(--border)",
              transition: "background 0.3s",
            }} />
          ))}
        </div>
      )}

      {state === "done" && times.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {/* Bar chart */}
          <div style={{ display: "flex", gap: 6, alignItems: "flex-end", height: 40 }}>
            {times.map((t, i) => (
              <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                <span style={{ fontSize: 10, color: "var(--faint)", fontFamily: "var(--font-mono)" }}>{t}ms</span>
                <div style={{
                  width: "100%",
                  height: Math.round((t / maxBar) * 24) + 4,
                  borderRadius: 4,
                  background: t === min ? "var(--green)" : t === max ? "rgba(239,68,68,0.5)" : "var(--blue)",
                  transition: "height 0.4s ease",
                }} />
                <span style={{ fontSize: 10, color: "var(--faint)", fontFamily: "var(--font-mono)" }}>#{i + 1}</span>
              </div>
            ))}
          </div>

          {/* Stats row */}
          <div style={{
            display: "grid", gridTemplateColumns: "1fr 1fr 1fr",
            gap: 8, paddingTop: 8,
          }}>
            {[
              { label: "min", value: min, color: "var(--green)" },
              { label: "avg", value: avg, color: "var(--blue)" },
              { label: "max", value: max, color: "var(--text)" },
            ].map(({ label, value, color }) => (
              <div key={label} style={{
                textAlign: "center", padding: "8px 4px",
                background: "var(--elevated, var(--card))",
                borderRadius: 8, border: "1px solid var(--border)",
              }}>
                <div style={{ fontSize: 16, fontWeight: 700, fontFamily: "var(--font-mono)", color }}>
                  {value}ms
                </div>
                <div style={{ fontSize: 10, color: "var(--faint)", fontFamily: "var(--font-mono)", marginTop: 2 }}>
                  {label}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
