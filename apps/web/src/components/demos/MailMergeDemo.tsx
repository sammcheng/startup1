"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { DemoShell, Pipeline, ResetButton, usePipelineRunner } from "./DemoShared";
import Icon from "./Icon";

interface Template {
  label: string;
  subject: string;
  body: string;
  vars: Record<string, string>;
}

interface TrackingEvent {
  type: "opened" | "clicked";
  label: string;
  at: string;
}

interface RenderPart {
  t: string;
  v: boolean;
}

const PHASES = [
  { id: "compose", label: "Compose" },
  { id: "send", label: "Send" },
  { id: "track", label: "Track" },
];

const SEND_STEPS = [
  { label: "Rendering template", ms: 500 },
  { label: "Connecting to SMTP", ms: 800 },
  { label: "Dispatching and confirming delivery", ms: 900 },
];

const TEMPLATES: Record<string, Template> = {
  invoice: {
    label: "Invoice",
    subject: "Your invoice for {{amount}}",
    body: `Hi {{name}},

Your invoice #{{invoice_id}} for {{amount}} is attached.
Payment is due by {{due_date}}.

Thanks,
{{company_name}}`,
    vars: { name: "Jane Cooper", amount: "$2,400", invoice_id: "INV-0042", due_date: "June 15, 2026", company_name: "Acme Corp" },
  },
  welcome: {
    label: "Welcome",
    subject: "Welcome to {{company_name}}, {{name}}!",
    body: `Hi {{name}},

Welcome aboard! Your account is ready at {{app_url}}.
If you need anything, reach out at {{support_email}}.

— The {{company_name}} team`,
    vars: { name: "Jane Cooper", company_name: "Acme", app_url: "app.acme.com", support_email: "help@acme.com" },
  },
  password: {
    label: "Password Reset",
    subject: "Reset your password",
    body: `Hi {{name}},

Click the link below to reset your password:
{{reset_link}}

This link expires in {{expiry}}.`,
    vars: { name: "Jane Cooper", reset_link: "acme.com/reset/abc123", expiry: "30 minutes" },
  },
  shipped: {
    label: "Order Shipped",
    subject: "Your order #{{order_id}} is on its way",
    body: `Hi {{name}},

Good news — your order #{{order_id}} shipped today.
Estimated delivery: {{eta}}.
Track it: {{tracking_url}}`,
    vars: { name: "Jane Cooper", order_id: "ORD-9912", eta: "Tue May 20", tracking_url: "ups.com/track/1Z9..." },
  },
};

// Render template by replacing {{var}} with current value, and return a list
// of (text, isVar) segments so the UI can highlight variables.
function renderTemplate(text: string, vars: Record<string, string>): RenderPart[] {
  const parts: RenderPart[] = [];
  let lastIdx = 0;
  const re = /\{\{(\w+)\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIdx) parts.push({ t: text.slice(lastIdx, m.index), v: false });
    const value = vars[m[1]];
    parts.push({ t: value ?? `{{${m[1]}}}`, v: true });
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < text.length) parts.push({ t: text.slice(lastIdx), v: false });
  return parts;
}

export default function MailMergeDemo() {
  const [phase, setPhase] = useState<string>("compose");
  const [templateId, setTemplateId] = useState<string>("invoice");
  const tpl = TEMPLATES[templateId];
  const [vars, setVars] = useState<Record<string, string>>(tpl.vars);
  const [recipient, setRecipient] = useState<string>("jane@startup.com");

  const [sStep, setSStep] = useState<number>(-1);
  const [delivered, setDelivered] = useState<boolean>(false);
  const [events, setEvents] = useState<TrackingEvent[]>([]);

  const { run, clear } = usePipelineRunner();
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => { setVars(tpl.vars); }, [templateId]);
  useEffect(() => () => { timersRef.current.forEach(clearTimeout); clear(); }, []);

  function send() {
    setDelivered(false); setEvents([]);
    setPhase("send");
    run(SEND_STEPS, setSStep, () => {
      setDelivered(true);
      setPhase("track");
      // Simulate open + click events arriving after delivery
      timersRef.current.push(setTimeout(() => {
        setEvents((e) => [...e, { type: "opened", label: `${recipient} opened the email`, at: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) }]);
      }, 1500));
      timersRef.current.push(setTimeout(() => {
        setEvents((e) => [...e, { type: "clicked", label: "Clicked: View Invoice link", at: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) }]);
      }, 2500));
    });
  }

  function reset() {
    timersRef.current.forEach(clearTimeout); timersRef.current = []; clear();
    setPhase("compose"); setSStep(-1); setDelivered(false); setEvents([]);
  }

  const subjectParts = renderTemplate(tpl.subject, vars);
  const bodyParts = renderTemplate(tpl.body, vars);
  const messageId = "msg_" + Math.random().toString(36).slice(2, 10);

  return (
    <div className="kc-demo-scope">
      <DemoShell phases={PHASES} currentPhase={phase} height={620}>
        {phase === "compose" && (
          <div className="vv-phase-body">
            <div className="dx-row">
              <div className="dx-field">
                <span className="dx-field-label">Template</span>
                <select className="dx-field-select" value={templateId} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setTemplateId(e.target.value)}>
                  {Object.entries(TEMPLATES).map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}
                </select>
              </div>
              <div className="dx-field">
                <span className="dx-field-label">Recipient</span>
                <input className="dx-field-input dx-field-mono" value={recipient} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRecipient(e.target.value)} />
              </div>
            </div>

            <div className="mm-preview">
              <div className="mm-preview-head">Subject</div>
              <div className="mm-subject">{subjectParts.map((p, i) => p.v ? <span key={i} className="mm-var">{p.t}</span> : <span key={i}>{p.t}</span>)}</div>
              <div className="mm-preview-head" style={{ marginTop: 10 }}>Body</div>
              <pre className="mm-body">{bodyParts.map((p, i) => p.v ? <span key={i} className="mm-var">{p.t}</span> : <span key={i}>{p.t}</span>)}</pre>
            </div>

            <div className="dx-field">
              <span className="dx-field-label">Variables</span>
              <div className="dx-form" style={{ gap: 6 }}>
                {Object.entries(vars).map(([k, v]) => (
                  <div key={k} className="dx-row" style={{ gridTemplateColumns: "140px 1fr", gap: 8 }}>
                    <input className="dx-field-input dx-field-mono" value={k} readOnly style={{ background: "var(--bg-soft)", color: "var(--ink-3)" }} />
                    <input className="dx-field-input" value={v} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setVars({ ...vars, [k]: e.target.value })} />
                  </div>
                ))}
              </div>
            </div>

            <div className="dx-phase-footer">
              <span className="dx-helper">Open + click tracking on by default</span>
              <button className="btn btn-vermillion" onClick={send}>
                Send email <Icon name="arrow-right" size={13} />
              </button>
            </div>
          </div>
        )}

        {phase === "send" && (
          <div className="vv-phase-body">
            <Pipeline steps={SEND_STEPS} currentIdx={sStep} complete={delivered} />
          </div>
        )}

        {phase === "track" && (
          <div className="vv-phase-body">
            <div className="dx-result-card dx-result-good">
              <div className="dx-kv"><span className="k">Status</span><span className="v" style={{ color: "var(--good)" }}>Delivered ✓</span></div>
              <div className="dx-kv"><span className="k">Message ID</span><span className="v">{messageId}</span></div>
              <div className="dx-kv"><span className="k">To</span><span className="v">{recipient}</span></div>
              <div className="dx-kv"><span className="k">Tracking</span><span className="v">Open + click enabled</span></div>
            </div>

            <div>
              <div className="vv-summary-k" style={{ marginBottom: 6 }}>Tracking events</div>
              <div className="mm-events">
                <AnimatePresence initial={false}>
                  {events.length === 0 ? (
                    <motion.div key="waiting" className="mm-event mm-event-waiting"
                      initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                    >
                      <span className="vv-spinner" />
                      <span>Waiting for events…</span>
                    </motion.div>
                  ) : null}
                  {events.map((e, i) => (
                    <motion.div key={i} className="mm-event"
                      initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28 }}
                    >
                      <span className={`mm-event-icon ${e.type}`}>
                        {e.type === "opened" ? "👁" : "↗"}
                      </span>
                      <span style={{ flex: 1, fontSize: 12.5 }}>{e.label}</span>
                      <span className="dx-helper" style={{ marginTop: 0 }}>{e.at}</span>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
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
