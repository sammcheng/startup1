"use client";

import { useEffect, useRef, useState } from "react";
import { DemoShell, Pipeline, ResetButton } from "./DemoShared";
import Icon from "./Icon";

const PHASES = [
  { id: "compose", label: "Compose" },
  { id: "delivery", label: "Delivery" },
  { id: "report", label: "Report" },
];

interface TemplateVar {
  k: string;
  v: string;
}

interface Template {
  label: string;
  vars: TemplateVar[];
}

const TEMPLATES: Record<string, Template> = {
  welcome: {
    label: "Welcome Email",
    vars: [
      { k: "name", v: "Jane" },
      { k: "company", v: "Acme" },
    ],
  },
  order: {
    label: "Order Confirmation",
    vars: [
      { k: "order_id", v: "ORD-4821" },
      { k: "total", v: "$124.00" },
    ],
  },
  password: {
    label: "Password Reset",
    vars: [
      { k: "name", v: "Jane" },
      { k: "link", v: "/reset/abc123" },
    ],
  },
  alert: {
    label: "Alert Notification",
    vars: [
      { k: "metric", v: "p95_latency" },
      { k: "value", v: "842ms" },
    ],
  },
};

interface ChannelDef {
  label: string;
  icon: string;
  steps: { label: string; ms: number }[];
}

const CHANNEL_DEFS: Record<string, ChannelDef> = {
  email: {
    label: "Email",
    icon: "✉️",
    steps: [
      { label: "Rendering template", ms: 80 },
      { label: "Connecting SMTP", ms: 180 },
      { label: "Delivered", ms: 60 },
    ],
  },
  sms: {
    label: "SMS",
    icon: "📱",
    steps: [
      { label: "Formatting message", ms: 50 },
      { label: "Twilio API", ms: 190 },
      { label: "Delivered", ms: 40 },
    ],
  },
  push: {
    label: "Push",
    icon: "🔔",
    steps: [
      { label: "Resolving device token", ms: 70 },
      { label: "FCM dispatch", ms: 90 },
      { label: "Delivered", ms: 30 },
    ],
  },
  inapp: {
    label: "In-App",
    icon: "💬",
    steps: [
      { label: "Writing to inbox", ms: 18 },
      { label: "WebSocket push", ms: 17 },
      { label: "Read", ms: 10 },
    ],
  },
};

interface ChannelProgress {
  step: number;
  done: boolean;
}

function stableDemoId(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36).padStart(8, "0").slice(0, 8);
}

export default function NotifyStackDemo() {
  const [phase, setPhase] = useState<string>("compose");
  const [recipient, setRecipient] = useState<string>("user-42");
  const [templateId, setTemplateId] = useState<string>("welcome");
  const [channels, setChannels] = useState<Record<string, boolean>>({
    email: true,
    sms: true,
    push: true,
    inapp: true,
  });
  const [vars, setVars] = useState<TemplateVar[]>(TEMPLATES.welcome.vars);

  const selectedChannels = Object.keys(channels).filter((k) => channels[k]);
  const [progress, setProgress] = useState<Record<string, ChannelProgress>>({});
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    setVars(TEMPLATES[templateId].vars);
  }, [templateId]);

  function clearTimers() {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  }
  useEffect(() => () => clearTimers(), []);

  function send() {
    if (selectedChannels.length === 0) return;
    clearTimers();
    const init: Record<string, ChannelProgress> = {};
    selectedChannels.forEach((c) => {
      init[c] = { step: 0, done: false };
    });
    setProgress(init);
    setPhase("delivery");

    selectedChannels.forEach((c) => {
      const steps = CHANNEL_DEFS[c].steps;
      let cumulative = 0;
      steps.forEach((s, i) => {
        cumulative += s.ms;
        timersRef.current.push(
          setTimeout(() => {
            setProgress((prev) => ({
              ...prev,
              [c]: { ...prev[c], step: i + 1 },
            }));
          }, cumulative),
        );
      });
      timersRef.current.push(
        setTimeout(() => {
          setProgress((prev) => ({
            ...prev,
            [c]: { step: steps.length, done: true },
          }));
        }, cumulative + 80),
      );
    });

    // Advance to report once all channels report done
    const longest = Math.max(
      ...selectedChannels.map((c) =>
        CHANNEL_DEFS[c].steps.reduce((s, x) => s + x.ms, 0),
      ),
    );
    timersRef.current.push(setTimeout(() => setPhase("report"), longest + 400));
  }

  function reset() {
    clearTimers();
    setPhase("compose");
    setProgress({});
  }

  const messageId = `msg_${stableDemoId(
    `${recipient}:${templateId}:${selectedChannels.join(",")}`,
  )}`;
  const totalMs =
    selectedChannels.length > 0
      ? Math.max(
          ...selectedChannels.map((c) =>
            CHANNEL_DEFS[c].steps.reduce((s, x) => s + x.ms, 0),
          ),
        )
      : 0;

  return (
    <div className="kc-demo-scope">
      <DemoShell phases={PHASES} currentPhase={phase} height={560}>
        {phase === "compose" && (
          <div className="vv-phase-body">
            <div className="dx-form">
              <div className="dx-row">
                <div className="dx-field">
                  <span className="dx-field-label">Recipient ID</span>
                  <input
                    className="dx-field-input dx-field-mono"
                    value={recipient}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setRecipient(e.target.value)
                    }
                  />
                </div>
                <div className="dx-field">
                  <span className="dx-field-label">Template</span>
                  <select
                    className="dx-field-select"
                    value={templateId}
                    onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                      setTemplateId(e.target.value)
                    }
                  >
                    {Object.entries(TEMPLATES).map(([k, t]) => (
                      <option key={k} value={k}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="dx-field">
                <span className="dx-field-label">Channels</span>
                <div className="dx-chip-multi">
                  {Object.entries(CHANNEL_DEFS).map(([k, c]) => (
                    <button
                      key={k}
                      className={channels[k] ? "on" : ""}
                      onClick={() =>
                        setChannels({ ...channels, [k]: !channels[k] })
                      }
                    >
                      <span>{c.icon}</span>
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="dx-field">
                <span className="dx-field-label">Variables</span>
                <div className="dx-form" style={{ gap: 6 }}>
                  {vars.map((v, i) => (
                    <div
                      key={v.k}
                      className="dx-row"
                      style={{ gridTemplateColumns: "120px 1fr", gap: 8 }}
                    >
                      <input
                        className="dx-field-input dx-field-mono"
                        value={v.k}
                        readOnly
                        style={{
                          background: "var(--bg-soft)",
                          color: "var(--ink-3)",
                        }}
                      />
                      <input
                        className="dx-field-input"
                        value={v.v}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                          const next = [...vars];
                          next[i] = { ...v, v: e.target.value };
                          setVars(next);
                        }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="dx-phase-footer">
              <span className="dx-helper">
                {selectedChannels.length} channel
                {selectedChannels.length === 1 ? "" : "s"} selected
              </span>
              <button
                className="btn btn-vermillion"
                onClick={send}
                disabled={selectedChannels.length === 0}
              >
                Send notification <Icon name="arrow-right" size={13} />
              </button>
            </div>
          </div>
        )}

        {phase === "delivery" && (
          <div className="vv-phase-body">
            <div className="ns-channels">
              {selectedChannels.map((c) => {
                const def = CHANNEL_DEFS[c];
                const p = progress[c] || { step: 0, done: false };
                return (
                  <div key={c} className="ns-channel">
                    <div className="ns-channel-head">
                      <span style={{ fontSize: 14 }}>{def.icon}</span>
                      <span className="ns-channel-name">{def.label}</span>
                    </div>
                    <Pipeline
                      steps={def.steps}
                      currentIdx={p.step}
                      complete={p.done}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {phase === "report" && (
          <div className="vv-phase-body">
            <div className="dx-result-card dx-result-good">
              <div className="dx-kv">
                <span className="k">Message ID</span>
                <span className="v">{messageId}</span>
              </div>
              <div className="dx-kv">
                <span className="k">Recipient</span>
                <span className="v">{recipient}</span>
              </div>
              <div className="dx-kv">
                <span className="k">Template</span>
                <span className="v">{TEMPLATES[templateId].label}</span>
              </div>
              <div className="dx-kv">
                <span className="k">Total time</span>
                <span className="v">{totalMs}ms (slowest channel)</span>
              </div>
            </div>

            <div className="ns-summary">
              {selectedChannels.map((c) => {
                const def = CHANNEL_DEFS[c];
                const ms = def.steps.reduce((s, x) => s + x.ms, 0);
                const ts = new Date(
                  Date.now() - (totalMs - ms),
                ).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                });
                return (
                  <div key={c} className="ns-summary-row">
                    <span>{def.icon}</span>
                    <span style={{ fontWeight: 500, flex: 1 }}>{def.label}</span>
                    <span className="pill pill-good">
                      {c === "inapp" ? "Read" : "Delivered"}
                    </span>
                    <span className="dx-helper" style={{ marginTop: 0 }}>
                      {ts}
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="dx-phase-footer">
              <ResetButton onClick={reset} label="Send another" icon="plus" />
            </div>
          </div>
        )}
      </DemoShell>
    </div>
  );
}
