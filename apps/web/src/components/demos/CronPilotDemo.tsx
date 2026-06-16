"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { DemoShell, Pipeline, ResetButton, usePipelineRunner } from "./DemoShared";
import Icon from "./Icon";

interface JobConfig {
  name: string;
  cron: string;
  handler: string;
  retries: number;
  backoff: string;
  timeout: number;
}

interface RunRecord {
  idx: number;
  time: string;
  status: "ok" | "fail" | "ok-after-retry";
  ms: number;
  retrying: boolean;
}

const PHASES = [
  { id: "config", label: "Configure" },
  { id: "schedule", label: "Schedule" },
  { id: "monitor", label: "Monitor" },
];

const SCHEDULE_STEPS = [
  { label: "Parsing cron expression", ms: 400 },
  { label: "Validating handler URL", ms: 700 },
  { label: "Registering schedule", ms: 600 },
];

// Tiny cron → human translator. Handles the common cases for the demo.
function explainCron(expr: string): string {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return "Invalid cron expression";
  const [m, h, dom, mon, dow] = parts;
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const time = `${h.padStart(2, "0")}:${m.padStart(2, "0")}`;
  if (dom === "*" && mon === "*" && dow === "*") return `Every day at ${time}`;
  if (dow !== "*" && dom === "*") {
    const d = days[Number(dow)] || dow;
    return `Every ${d}day at ${time}`.replace("Sunday", "Sunday").replace(/day$/, (day) => day);
  }
  if (m.startsWith("*/")) return `Every ${m.slice(2)} minutes`;
  if (h === "*") return `Every hour at :${m.padStart(2, "0")}`;
  return `${time} on day ${dom} of month ${mon}`;
}

export default function CronPilotDemo() {
  const [phase, setPhase] = useState<string>("config");
  const [job, setJob] = useState<JobConfig>({
    name: "Weekly report",
    cron: "0 9 * * 1",
    handler: "https://myapp.com/api/weekly-report",
    retries: 3,
    backoff: "Exponential",
    timeout: 30,
  });
  const [schedStep, setSchedStep] = useState<number>(-1);
  const [scheduled, setScheduled] = useState<boolean>(false);

  const [runs, setRuns] = useState<RunRecord[]>([]);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const { run, clear } = usePipelineRunner();

  function clearTimers() { timersRef.current.forEach(clearTimeout); timersRef.current = []; }
  useEffect(() => () => { clearTimers(); clear(); }, [clear]);

  function schedule() {
    setScheduled(false);
    setPhase("schedule");
    run(SCHEDULE_STEPS, setSchedStep, () => { setScheduled(true); setPhase("monitor"); startMonitor(); });
  }

  function startMonitor() {
    setRuns([]);
    clearTimers();
    const scripts: { idx: number; status: "ok" | "retry"; ms: number }[] = [
      { idx: 1, status: "ok", ms: 234 },
      { idx: 2, status: "ok", ms: 189 },
      { idx: 3, status: "retry", ms: 312 }, // fails first, then retries
    ];
    let cumulative = 600;
    scripts.forEach((s) => {
      timersRef.current.push(setTimeout(() => {
        setRuns((prev) => [...prev, {
          idx: s.idx,
          time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
          status: s.status === "retry" ? "fail" : "ok",
          ms: s.ms,
          retrying: s.status === "retry",
        }]);
        if (s.status === "retry") {
          timersRef.current.push(setTimeout(() => {
            setRuns((prev) => prev.map((r) => r.idx === s.idx ? { ...r, status: "ok-after-retry", ms: 312, retrying: false } : r));
          }, 800));
        }
      }, cumulative));
      cumulative += 1500;
    });
  }

  function reset() {
    clearTimers(); clear();
    setPhase("config"); setSchedStep(-1); setScheduled(false); setRuns([]);
  }

  const totalRuns = runs.length;
  const retryCount = runs.filter((r) => r.status === "ok-after-retry").length;
  const successful = runs.filter((r) => r.status === "ok" || r.status === "ok-after-retry").length;
  const avgMs = runs.length ? Math.round(runs.reduce((s, r) => s + r.ms, 0) / runs.length) : 0;

  return (
    <div className="kc-demo-scope">
      <DemoShell phases={PHASES} currentPhase={phase} height={620}>
        {phase === "config" && (
          <div className="vv-phase-body">
            <div className="dx-form">
              <div className="dx-field">
                <span className="dx-field-label">Job name</span>
                <input className="dx-field-input" value={job.name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setJob({ ...job, name: e.target.value })} />
              </div>
              <div className="dx-field">
                <span className="dx-field-label">Cron expression</span>
                <input className="dx-field-input dx-field-mono" value={job.cron} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setJob({ ...job, cron: e.target.value })} />
                <span className="dx-helper">→ {explainCron(job.cron)}</span>
              </div>
              <div className="dx-field">
                <span className="dx-field-label">Handler URL</span>
                <input className="dx-field-input dx-field-mono" value={job.handler} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setJob({ ...job, handler: e.target.value })} />
              </div>
              <div className="dx-row" style={{ gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                <div className="dx-field">
                  <span className="dx-field-label">Max retries</span>
                  <input className="dx-field-input dx-field-mono" type="number" value={job.retries} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setJob({ ...job, retries: Number(e.target.value) })} />
                </div>
                <div className="dx-field">
                  <span className="dx-field-label">Backoff</span>
                  <select className="dx-field-select" value={job.backoff} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setJob({ ...job, backoff: e.target.value })}>
                    <option>Linear</option>
                    <option>Exponential</option>
                  </select>
                </div>
                <div className="dx-field">
                  <span className="dx-field-label">Timeout (s)</span>
                  <input className="dx-field-input dx-field-mono" type="number" value={job.timeout} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setJob({ ...job, timeout: Number(e.target.value) })} />
                </div>
              </div>
            </div>
            <div className="dx-phase-footer">
              <span className="dx-helper">{job.backoff.toLowerCase()} backoff up to {job.retries} retries</span>
              <button className="btn btn-vermillion" onClick={schedule}>
                Schedule job <Icon name="arrow-right" size={13} />
              </button>
            </div>
          </div>
        )}

        {phase === "schedule" && (
          <div className="vv-phase-body">
            <Pipeline steps={SCHEDULE_STEPS} currentIdx={schedStep} complete={scheduled} />
          </div>
        )}

        {phase === "monitor" && (
          <div className="vv-phase-body">
            <div className="dx-result-card dx-result-good">
              <div className="dx-kv"><span className="k">Job</span><span className="v">{job.name}</span></div>
              <div className="dx-kv"><span className="k">Schedule</span><span className="v">{job.cron} · {explainCron(job.cron)}</span></div>
              <div className="dx-kv"><span className="k">Handler</span><span className="v">{job.handler}</span></div>
            </div>

            <div>
              <div className="vv-summary-k" style={{ marginBottom: 6 }}>Execution timeline</div>
              <div className="cp-runs">
                <AnimatePresence initial={false}>
                  {runs.map((r) => (
                    <motion.div key={r.idx} className="cp-run"
                      initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.24 }}
                    >
                      <span className="cp-run-idx">Run #{r.idx}</span>
                      <span className="cp-run-time">{r.time}</span>
                      {r.status === "ok" && (
                        <>
                          <span className="pill pill-good"><Icon name="check" size={10} stroke={3} /> 200 OK</span>
                          <span className="cp-run-ms">{r.ms}ms</span>
                        </>
                      )}
                      {r.status === "fail" && r.retrying && (
                        <>
                          <span className="pill" style={{ background: "rgba(220,38,38,0.12)", color: "#B91C1C" }}>✗ 500 Error</span>
                          <span className="cp-run-arrow">→</span>
                          <span className="pill" style={{ background: "var(--info-bg)", color: "var(--info-ink)" }}>
                            <span className="vv-spinner" style={{ width: 9, height: 9 }} /> Retry 1/{job.retries}
                          </span>
                        </>
                      )}
                      {r.status === "ok-after-retry" && (
                        <>
                          <span className="pill" style={{ background: "rgba(220,38,38,0.12)", color: "#B91C1C" }}>✗ 500</span>
                          <span className="cp-run-arrow">→</span>
                          <span className="pill pill-good"><Icon name="check" size={10} stroke={3} /> Retry succeeded</span>
                          <span className="cp-run-ms">{r.ms}ms</span>
                        </>
                      )}
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </div>

            {totalRuns > 0 && (
              <div className="dx-result-card" style={{ borderLeftColor: "var(--ink-3)" }}>
                <div style={{ fontSize: 12.5 }}>
                  {totalRuns} executions, {retryCount} retry, {Math.round((successful / totalRuns) * 100)}% eventual success rate, avg {avgMs}ms
                </div>
              </div>
            )}

            <div className="dx-phase-footer">
              <ResetButton onClick={reset} label="Reconfigure job" />
            </div>
          </div>
        )}
      </DemoShell>
    </div>
  );
}
