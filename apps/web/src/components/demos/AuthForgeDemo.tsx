"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import Icon from "./Icon";

// ─── Pipeline definitions per transition ──────────────────────────────────
//
// Each step has a label and a simulated elapsed time. The total of each
// sequence is shown at the bottom of the pipeline panel.

interface AfStep {
  label: string;
  ms: number;
}

const SEND_LINK_PIPELINE: AfStep[] = [
  { label: 'Validating email format',     ms: 12 },
  { label: 'Checking user exists',        ms: 45 },
  { label: 'Generating magic link token', ms: 23 },
  { label: 'Sending email via SendGrid',  ms: 180 },
  { label: 'Session created (expires 24h)', ms: 8 },
];

const VERIFY_LINK_PIPELINE: AfStep[] = [
  { label: 'Verifying magic link token', ms: 34 },
  { label: 'Token valid, not expired',   ms: 12 },
  { label: 'Creating JWT session',       ms: 18 },
  { label: 'Setting refresh cookie',     ms: 4 },
];

const JWT_DISPLAY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1XzhhMmYzIiwiZW1haWwiOiJ1c2VyQGV4YW1wbGUuY29tIiwic2NvcGVzIjpbInJlYWQiLCJ3cml0ZSJdfQ.s1g_4f9eX7nQ_kpXVCJ9';

type Screen = 'login' | 'sent' | 'dashboard';
type PipelineKind = 'send' | 'verify' | null;

export default function AuthForgeDemo() {
  const [screen, setScreen] = useState<Screen>('login');         // login | sent | dashboard
  const [email, setEmail] = useState<string>('user@example.com');

  // Pipeline state: which sequence is running and where in it we are.
  const [pipelineKind, setPipelineKind] = useState<PipelineKind>(null); // null | 'send' | 'verify'
  const [pipelineStep, setPipelineStep] = useState<number>(0);

  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  function clearTimers() {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  }

  useEffect(() => () => clearTimers(), []);

  function runPipeline(kind: 'send' | 'verify', onComplete: () => void) {
    clearTimers();
    setPipelineKind(kind);
    setPipelineStep(0);

    const steps = kind === 'send' ? SEND_LINK_PIPELINE : VERIFY_LINK_PIPELINE;
    let cumulative = 0;
    steps.forEach((s, i) => {
      cumulative += s.ms;
      // Add a small floor so very fast steps still show a flash of spinner
      const tickMs = Math.max(180, cumulative);
      timersRef.current.push(
        setTimeout(() => setPipelineStep(i + 1), tickMs)
      );
    });
    // Finish 350ms after the last step's nominal completion
    timersRef.current.push(
      setTimeout(onComplete, Math.max(180 * steps.length, cumulative) + 350)
    );
  }

  function sendMagicLink() {
    runPipeline('send', () => setScreen('sent'));
  }

  function openMagicLink() {
    runPipeline('verify', () => setScreen('dashboard'));
  }

  function reset() {
    clearTimers();
    setPipelineKind(null);
    setPipelineStep(0);
    setScreen('login');
  }

  const steps: AfStep[] = pipelineKind === 'send' ? SEND_LINK_PIPELINE
              : pipelineKind === 'verify' ? VERIFY_LINK_PIPELINE
              : [];
  const totalElapsed = steps.slice(0, pipelineStep).reduce((sum, s) => sum + s.ms, 0);

  const url = screen === 'dashboard' ? 'yourapp.com/dashboard' : 'yourapp.com/login';

  return (
    <div className="kc-demo-scope af-demo">
      <div className="af-row">
        {/* ── Mock app window ──────────────────────────────── */}
        <div className="af-window">
          <div className="af-window-chrome">
            <div className="af-window-dots">
              <span className="af-dot af-dot-r" />
              <span className="af-dot af-dot-y" />
              <span className="af-dot af-dot-g" />
            </div>
            <div className="af-window-url">
              <Icon name="shield" size={11} color="var(--good)" />
              <span>{url}</span>
            </div>
          </div>

          <div className="af-window-body">
            <AnimatePresence mode="wait">
              {screen === 'login' && (
                <motion.div
                  key="login"
                  className="af-screen"
                  initial={{ opacity: 0, x: 16 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -16 }}
                  transition={{ duration: 0.28, ease: [0.2, 0.7, 0.2, 1] }}
                >
                  <div className="af-screen-title">Welcome back</div>
                  <div className="af-screen-sub">Sign in with your work email.</div>

                  <label className="af-field">
                    <span className="af-field-label">Email</span>
                    <input
                      className="af-input"
                      value={email}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
                      placeholder="you@company.com"
                      type="email"
                    />
                  </label>

                  <button className="af-btn af-btn-primary" onClick={sendMagicLink} disabled={pipelineKind === 'send' || !email}>
                    Continue with email <Icon name="arrow-right" size={14} />
                  </button>

                  <div className="af-divider"><span>or</span></div>

                  <button className="af-btn af-btn-secondary" disabled>
                    <span className="af-oauth-dot" style={{ background: '#4285F4' }} />
                    Continue with Google
                  </button>
                  <button className="af-btn af-btn-secondary" disabled>
                    <Icon name="github" size={14} color="var(--ink)" />
                    Continue with GitHub
                  </button>
                </motion.div>
              )}

              {screen === 'sent' && (
                <motion.div
                  key="sent"
                  className="af-screen af-screen-center"
                  initial={{ opacity: 0, x: 16 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -16 }}
                  transition={{ duration: 0.28, ease: [0.2, 0.7, 0.2, 1] }}
                >
                  <div className="af-envelope">
                    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="5" width="18" height="14" rx="2" />
                      <path d="M3 7l9 6 9-6" />
                    </svg>
                  </div>
                  <div className="af-screen-title">Check your email</div>
                  <div className="af-screen-sub">
                    We sent a magic link to <b style={{ color: 'var(--ink)' }}>{email}</b>
                  </div>
                  <button className="af-btn af-btn-primary" onClick={openMagicLink} disabled={pipelineKind === 'verify'}>
                    Open magic link <Icon name="arrow-right" size={14} />
                  </button>
                  <div className="af-sim-note">(simulates clicking the link in your inbox)</div>
                </motion.div>
              )}

              {screen === 'dashboard' && (
                <motion.div
                  key="dashboard"
                  className="af-screen"
                  initial={{ opacity: 0, x: 16 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -16 }}
                  transition={{ duration: 0.28, ease: [0.2, 0.7, 0.2, 1] }}
                >
                  <div className="af-screen-title">
                    Welcome, {email} <span style={{ marginLeft: 4 }}>👋</span>
                  </div>
                  <div className="af-screen-sub">You're signed in. Here's your session token.</div>

                  <div className="af-session">
                    <div className="af-session-row">
                      <span className="af-session-k">JWT</span>
                      <code className="af-session-v af-jwt">{JWT_DISPLAY.slice(0, 18)}…{JWT_DISPLAY.slice(-12)}</code>
                    </div>
                    <div className="af-session-row">
                      <span className="af-session-k">Expires</span>
                      <span className="af-session-v">24h from now</span>
                    </div>
                    <div className="af-session-row">
                      <span className="af-session-k">Refresh</span>
                      <span className="af-session-v" style={{ color: 'var(--good)' }}>
                        <Icon name="check" size={12} stroke={2.6} color="var(--good)" /> auto-renew
                      </span>
                    </div>
                    <div className="af-session-row">
                      <span className="af-session-k">Scopes</span>
                      <span className="af-session-v">
                        <span className="pill pill-line">read</span>
                        <span className="pill pill-line" style={{ marginLeft: 4 }}>write</span>
                      </span>
                    </div>
                  </div>

                  <div className="af-actions">
                    <button className="af-btn af-btn-secondary" onClick={reset}>Log out</button>
                    <button className="af-btn af-btn-primary" onClick={reset}>
                      Try again <Icon name="arrow-right" size={14} />
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* ── Pipeline panel ───────────────────────────────── */}
        <div className="af-pipeline">
          <div className="demo-eyebrow">AuthForge Pipeline</div>
          {!pipelineKind && (
            <div className="af-pipeline-empty">
              Run the flow on the left — each action shows the verification, token, and session steps in real time.
            </div>
          )}
          {pipelineKind && (
            <>
              <div className="af-pipeline-list">
                {steps.map((s, i) => {
                  const done = i < pipelineStep;
                  const active = i === pipelineStep;
                  return (
                    <motion.div
                      key={pipelineKind + '-' + s.label}
                      className={`af-step ${active ? 'active' : ''} ${done ? 'done' : ''}`}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.04, duration: 0.25 }}
                    >
                      <span className="af-step-icon">
                        {done
                          ? <span className="af-check"><Icon name="check" size={10} stroke={3} /></span>
                          : active ? <span className="af-spinner" />
                          : <span className="af-dot-pending" />}
                      </span>
                      <span className="af-step-label">{s.label}</span>
                      <span className="af-step-time">{done ? `${s.ms}ms` : (active ? '…' : '')}</span>
                    </motion.div>
                  );
                })}
              </div>
              <div className="af-total">
                <span>Total</span>
                <span className="af-total-ms">{totalElapsed}ms</span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
