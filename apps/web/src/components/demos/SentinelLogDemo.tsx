"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { DemoShell, Pipeline, ResetButton, usePipelineRunner } from "./DemoShared";
import Icon from "./Icon";

interface RawError {
  ts: string;
  sig: string;
  file: string;
  stack: string;
}

interface GroupedIssue {
  sig: string;
  file: string;
  stack: string;
  first: string;
  last: string;
  count: number;
}

const PHASES = [
  { id: "capture", label: "Capture" },
  { id: "analyze", label: "Analyze" },
  { id: "issues", label: "Issues" },
];

const RAW_ERRORS: RawError[] = [
  { ts: "14:32:01", sig: "TypeError: Cannot read property 'map' of undefined", file: "/src/Dashboard.jsx:42", stack: "at renderItems (Dashboard.jsx:42)\nat Dashboard (Dashboard.jsx:18)" },
  { ts: "14:32:01", sig: "TypeError: Cannot read property 'map' of undefined", file: "/src/Dashboard.jsx:42", stack: "at renderItems (Dashboard.jsx:42)\nat Dashboard (Dashboard.jsx:18)" },
  { ts: "14:32:02", sig: "ReferenceError: user is not defined", file: "/src/Auth.js:18", stack: "at requireAuth (Auth.js:18)\nat middleware (server.js:42)" },
  { ts: "14:32:02", sig: "TypeError: Cannot read property 'map' of undefined", file: "/src/Dashboard.jsx:42", stack: "at renderItems (Dashboard.jsx:42)\nat Dashboard (Dashboard.jsx:18)" },
  { ts: "14:32:03", sig: "SyntaxError: Unexpected token in JSON", file: "/src/api/parse.js:7", stack: "at JSON.parse (<anonymous>)\nat parseResponse (parse.js:7)" },
  { ts: "14:32:03", sig: "ReferenceError: user is not defined", file: "/src/Auth.js:18", stack: "at requireAuth (Auth.js:18)\nat middleware (server.js:42)" },
  { ts: "14:32:04", sig: "TypeError: Cannot read property 'map' of undefined", file: "/src/Dashboard.jsx:42", stack: "at renderItems (Dashboard.jsx:42)\nat Dashboard (Dashboard.jsx:18)" },
  { ts: "14:32:04", sig: "SyntaxError: Unexpected token in JSON", file: "/src/api/parse.js:7", stack: "" },
];

const ANALYZE_STEPS_TPL = (n: number) => [
  { label: `Ingesting ${n} error events`, ms: 400 },
  { label: "Parsing stack traces", ms: 700 },
  { label: "Grouping and scoring issues", ms: 800 },
];

const ALERT_STEPS = [
  { label: "Formatting alert", ms: 25 },
  { label: "Sent to #engineering", ms: 80 },
];

function severityFor(occurrences: number): "critical" | "high" | "medium" {
  if (occurrences >= 4) return "critical";
  if (occurrences >= 2) return "high";
  return "medium";
}

export default function SentinelLogDemo() {
  const [phase, setPhase] = useState<string>("capture");
  const [streamed, setStreamed] = useState<RawError[]>([]);
  const [streaming, setStreaming] = useState<boolean>(false);

  const [aStep, setAStep] = useState<number>(-1);
  const [grouped, setGrouped] = useState<GroupedIssue[] | null>(null);
  const [openIdx, setOpenIdx] = useState<number>(0);
  const [alertedIdx, setAlertedIdx] = useState<number | null>(null);
  const [alertStep, setAlertStep] = useState<number>(-1);

  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const { run, clear: clearAlert } = usePipelineRunner();

  function clearTimers() {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  }
  useEffect(() => () => {
    clearTimers();
    clearAlert();
  }, []);

  function simulate() {
    clearTimers();
    setStreamed([]);
    setStreaming(true);
    RAW_ERRORS.forEach((e, i) => {
      timersRef.current.push(setTimeout(() => {
        setStreamed((arr) => [...arr, e]);
        if (i === RAW_ERRORS.length - 1) setStreaming(false);
      }, 300 + i * 320));
    });
  }

  function analyze() {
    setPhase("analyze");
    const steps = ANALYZE_STEPS_TPL(streamed.length);
    run(steps, setAStep, () => {
      // Group
      const m = new Map<string, GroupedIssue>();
      for (const e of streamed) {
        if (!m.has(e.sig)) m.set(e.sig, { sig: e.sig, file: e.file, stack: e.stack, first: e.ts, last: e.ts, count: 0 });
        const g = m.get(e.sig)!;
        g.count += 1;
        g.last = e.ts;
        if (!g.stack && e.stack) g.stack = e.stack;
      }
      const groups = Array.from(m.values()).sort((a, b) => b.count - a.count);
      setGrouped(groups);
      setPhase("issues");
    });
  }

  function sendAlert(i: number) {
    if (alertedIdx !== null) return;
    setAlertedIdx(i);
    run(ALERT_STEPS, setAlertStep, () => {});
  }

  function reset() {
    clearTimers();
    clearAlert();
    setPhase("capture");
    setStreamed([]);
    setStreaming(false);
    setAStep(-1);
    setGrouped(null);
    setOpenIdx(0);
    setAlertedIdx(null);
    setAlertStep(-1);
  }

  return (
    <div className="kc-demo-scope">
      <DemoShell phases={PHASES} currentPhase={phase} height={600}>
        {phase === "capture" && (
          <div className="vv-phase-body">
            {streamed.length === 0 && !streaming && (
              <div className="sl-empty">
                <div style={{ fontFamily: "Inter Tight, sans-serif", fontWeight: 700, fontSize: 16, color: "var(--ink)" }}>Error stream</div>
                <div style={{ fontSize: 13, color: "var(--ink-3)", marginTop: 6, marginBottom: 16 }}>
                  Click below to simulate ~8 runtime errors firing in your app. Some will be duplicates.
                </div>
                <button className="btn btn-vermillion" onClick={simulate}>
                  <Icon name={"bolt" as any} size={13} /> Simulate app errors
                </button>
              </div>
            )}

            {streamed.length > 0 && (
              <div className="sl-feed">
                <AnimatePresence initial={false}>
                  {streamed.map((e, i) => (
                    <motion.div key={i} className="sl-event"
                      initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.22 }}
                    >
                      <span className="sl-event-ts">[{e.ts}]</span>
                      <span className="sl-event-sig">{e.sig}</span>
                      <span className="sl-event-file">{e.file}</span>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}

            {!streaming && streamed.length > 0 && (
              <div className="dx-phase-footer">
                <ResetButton onClick={reset} label="Clear" icon="x" />
                <button className="btn btn-vermillion" onClick={analyze}>
                  Analyze errors <Icon name="arrow-right" size={13} />
                </button>
              </div>
            )}
          </div>
        )}

        {phase === "analyze" && (
          <div className="vv-phase-body">
            <Pipeline steps={ANALYZE_STEPS_TPL(streamed.length)} currentIdx={aStep} complete={Boolean(grouped)} />
          </div>
        )}

        {phase === "issues" && grouped && (
          <div className="vv-phase-body">
            <div className="dx-result-card">
              <div style={{ fontSize: 13 }}>
                <b>{grouped.length}</b> unique issues from <b>{streamed.length}</b> events
              </div>
            </div>

            <ul className="sl-issue-list">
              {grouped.map((g, i) => {
                const open = openIdx === i;
                const sev = severityFor(g.count);
                return (
                  <li key={g.sig} className={`sl-issue ${open ? "open" : ""}`}>
                    <button className="sl-issue-head" onClick={() => setOpenIdx(open ? -1 : i)}>
                      <span className={`dx-sev dx-sev-${sev}`}>{sev}</span>
                      <span className="sl-issue-sig">{g.sig}</span>
                      <span className="sl-issue-count">×{g.count}</span>
                      <span style={{ color: "var(--ink-3)" }}>{open ? "▴" : "▾"}</span>
                    </button>
                    <AnimatePresence initial={false}>
                      {open && (
                        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} style={{ overflow: "hidden" }}>
                          <div className="sl-issue-body">
                            <div className="dx-kv"><span className="k">File</span><span className="v">{g.file}</span></div>
                            <div className="dx-kv"><span className="k">First seen</span><span className="v">{g.first}</span></div>
                            <div className="dx-kv"><span className="k">Last seen</span><span className="v">{g.last}</span></div>
                            {g.stack && <pre className="dx-code" style={{ maxHeight: 70, fontSize: 11 }}>{g.stack}</pre>}

                            <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 10 }}>
                              <button className="btn btn-ghost btn-sm" disabled={alertedIdx !== null} onClick={() => sendAlert(i)}>
                                <Icon name={"bolt" as any} size={11} /> Generate alert
                              </button>
                              {alertedIdx === i && (
                                <div style={{ flex: 1 }}>
                                  <Pipeline steps={ALERT_STEPS} currentIdx={alertStep} complete={alertStep >= ALERT_STEPS.length} />
                                </div>
                              )}
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </li>
                );
              })}
            </ul>

            <div className="dx-phase-footer">
              <ResetButton onClick={reset} label="Reset demo" />
            </div>
          </div>
        )}
      </DemoShell>
    </div>
  );
}
