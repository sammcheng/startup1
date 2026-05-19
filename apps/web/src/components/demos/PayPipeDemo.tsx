"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  DemoShell,
  Pipeline,
  ResetButton,
  SummaryLine,
  usePipelineRunner,
} from "./DemoShared";
import Icon from "./Icon";

const PHASES = [
  { id: "configure", label: "Configure" },
  { id: "creating", label: "Create plan" },
  { id: "customer", label: "Customer" },
];

const CREATE_STEPS = [
  { label: "Validating plan", ms: 200 },
  { label: "Creating Stripe product", ms: 700 },
  { label: "Activating plan", ms: 600 },
];
const SUB_STEPS = [
  { label: "Creating subscription", ms: 300 },
  { label: "Processing invoice", ms: 700 },
  { label: "Confirming payment", ms: 500 },
];
const USAGE_STEPS = [
  { label: "Recording event", ms: 35 },
  { label: "Updating meter", ms: 50 },
  { label: "Recalculating invoice", ms: 80 },
];

const CUSTOMER = { name: "Jane Cooper", email: "jane@startup.com", id: "cus_8a2f9c" };

interface Plan {
  name: string;
  price: number;
  cycle: "monthly" | "annual";
  metered: boolean;
  unitPrice: number;
}

interface Subscription {
  id: string;
  status: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  nextInvoiceAmount: string;
}

export default function PayPipeDemo() {
  const [phase, setPhase] = useState<string>("configure");
  const [plan, setPlan] = useState<Plan>({
    name: "Pro Plan",
    price: 49,
    cycle: "monthly",
    metered: false,
    unitPrice: 0.02,
  });
  const [createStep, setCreateStep] = useState<number>(-1);
  const [planLive, setPlanLive] = useState<boolean>(false);

  const [subBusy, setSubBusy] = useState<boolean>(false);
  const [subStep, setSubStep] = useState<number>(-1);
  const [subscription, setSubscription] = useState<Subscription | null>(null);

  const [usageBusy, setUsageBusy] = useState<boolean>(false);
  const [usageStep, setUsageStep] = useState<number>(-1);
  const [usageCount, setUsageCount] = useState<number>(0);

  const { run, clear } = usePipelineRunner();

  function createPlan() {
    setPlanLive(false);
    setPhase("creating");
    run(CREATE_STEPS, setCreateStep, () => {
      setPlanLive(true);
      setPhase("customer");
    });
  }

  function subscribe() {
    if (subBusy) return;
    setSubBusy(true);
    setSubscription(null);
    run(SUB_STEPS, setSubStep, () => {
      const now = new Date();
      const periodEnd = new Date(now);
      periodEnd.setMonth(periodEnd.getMonth() + 1);
      setSubscription({
        id: "sub_" + Math.random().toString(36).slice(2, 8),
        status: "active",
        currentPeriodStart: now.toISOString(),
        currentPeriodEnd: periodEnd.toISOString(),
        nextInvoiceAmount: "$" + plan.price,
      });
      setSubBusy(false);
    });
  }

  function recordUsage() {
    if (usageBusy) return;
    setUsageBusy(true);
    run(USAGE_STEPS, setUsageStep, () => {
      setUsageCount((c) => c + 1);
      setUsageBusy(false);
    });
  }

  function reset() {
    clear();
    setPhase("configure");
    setCreateStep(-1);
    setPlanLive(false);
    setSubStep(-1);
    setSubscription(null);
    setSubBusy(false);
    setUsageStep(-1);
    setUsageCount(0);
    setUsageBusy(false);
  }

  return (
    <div className="kc-demo-scope">
      <DemoShell phases={PHASES} currentPhase={phase} height={560}>
        {/* ── Phase 1: Configure ── */}
        {phase === "configure" && (
          <div className="vv-phase-body">
            <div className="dx-form">
              <div className="dx-field">
                <span className="dx-field-label">Plan name</span>
                <input
                  className="dx-field-input"
                  value={plan.name}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setPlan({ ...plan, name: e.target.value })
                  }
                />
              </div>
              <div className="dx-row">
                <div className="dx-field">
                  <span className="dx-field-label">
                    Price / {plan.cycle === "monthly" ? "month" : "year"} (USD)
                  </span>
                  <input
                    className="dx-field-input dx-field-mono"
                    type="number"
                    value={plan.price}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setPlan({ ...plan, price: Number(e.target.value) })
                    }
                  />
                </div>
                <div className="dx-field">
                  <span className="dx-field-label">Billing cycle</span>
                  <div className="dx-toggle">
                    <button
                      className={plan.cycle === "monthly" ? "active" : ""}
                      onClick={() => setPlan({ ...plan, cycle: "monthly" })}
                    >
                      Monthly
                    </button>
                    <button
                      className={plan.cycle === "annual" ? "active" : ""}
                      onClick={() => setPlan({ ...plan, cycle: "annual" })}
                    >
                      Annual
                    </button>
                  </div>
                </div>
              </div>
              <label
                className="dx-field"
                style={{ flexDirection: "row", alignItems: "center", gap: 10 }}
              >
                <input
                  type="checkbox"
                  checked={plan.metered}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setPlan({ ...plan, metered: e.target.checked })
                  }
                />
                <span style={{ fontSize: 13 }}>Enable usage metering</span>
              </label>
              {plan.metered && (
                <div className="dx-field">
                  <span className="dx-field-label">Price per unit (USD)</span>
                  <input
                    className="dx-field-input dx-field-mono"
                    type="number"
                    step="0.001"
                    value={plan.unitPrice}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setPlan({ ...plan, unitPrice: Number(e.target.value) })
                    }
                  />
                </div>
              )}
            </div>
            <div className="dx-phase-footer">
              <span className="dx-helper">
                Stripe-compatible, runs entirely in your tenant.
              </span>
              <button className="btn btn-vermillion" onClick={createPlan}>
                Create plan <Icon name="arrow-right" size={13} />
              </button>
            </div>
          </div>
        )}

        {/* ── Phase 2: Creating ── */}
        {phase === "creating" && (
          <div className="vv-phase-body">
            <SummaryLine
              k="Plan"
              v={`${plan.name} · $${plan.price}/${
                plan.cycle === "monthly" ? "mo" : "yr"
              }`}
            />
            <Pipeline
              steps={CREATE_STEPS}
              currentIdx={createStep}
              complete={planLive}
            />
          </div>
        )}

        {/* ── Phase 3: Customer ── */}
        {phase === "customer" && (
          <div className="vv-phase-body">
            <SummaryLine k="Plan" v={`${plan.name} · live`} success />

            <div className="pp-customer">
              <div className="pp-customer-avatar">JC</div>
              <div>
                <div className="pp-customer-name">{CUSTOMER.name}</div>
                <div className="pp-customer-email">
                  {CUSTOMER.email} · {CUSTOMER.id}
                </div>
              </div>
            </div>

            <div className="dx-row" style={{ gap: 8 }}>
              <button
                className="btn btn-vermillion"
                onClick={subscribe}
                disabled={subBusy}
              >
                {subBusy ? "Subscribing…" : "Subscribe customer"}
              </button>
              <button
                className="btn btn-ghost"
                onClick={recordUsage}
                disabled={!plan.metered || usageBusy}
              >
                {usageBusy
                  ? "Recording…"
                  : `Record usage event${plan.metered ? "" : " (metered off)"}`}
              </button>
            </div>

            {subStep >= 0 && (
              <div className="pp-mini">
                <div className="vv-summary-k" style={{ marginBottom: 4 }}>
                  Subscribe pipeline
                </div>
                <Pipeline
                  steps={SUB_STEPS}
                  currentIdx={subStep}
                  complete={Boolean(subscription)}
                />
              </div>
            )}

            <AnimatePresence>
              {subscription && (
                <motion.div
                  className="dx-result-card dx-result-good"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.28 }}
                >
                  <div className="dx-kv">
                    <span className="k">Status</span>
                    <span className="v" style={{ color: "var(--good)" }}>
                      {subscription.status}
                    </span>
                  </div>
                  <div className="dx-kv">
                    <span className="k">Subscription</span>
                    <span className="v">{subscription.id}</span>
                  </div>
                  <div className="dx-kv">
                    <span className="k">Period start</span>
                    <span className="v">
                      {subscription.currentPeriodStart.slice(0, 10)}
                    </span>
                  </div>
                  <div className="dx-kv">
                    <span className="k">Period end</span>
                    <span className="v">
                      {subscription.currentPeriodEnd.slice(0, 10)}
                    </span>
                  </div>
                  <div className="dx-kv">
                    <span className="k">Next invoice</span>
                    <span className="v">{subscription.nextInvoiceAmount}</span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {usageStep >= 0 && (
              <div className="pp-mini">
                <div className="vv-summary-k" style={{ marginBottom: 4 }}>
                  Usage pipeline
                </div>
                <Pipeline
                  steps={USAGE_STEPS}
                  currentIdx={usageStep}
                  complete={!usageBusy && usageCount > 0}
                />
              </div>
            )}

            {usageCount > 0 && plan.metered && (
              <div className="dx-result-card">
                <div className="dx-kv">
                  <span className="k">Events</span>
                  <span className="v">{usageCount} this cycle</span>
                </div>
                <div className="dx-kv">
                  <span className="k">Projected</span>
                  <span className="v">
                    ${(plan.price + usageCount * plan.unitPrice).toFixed(2)}
                  </span>
                </div>
              </div>
            )}

            <div className="dx-phase-footer">
              <ResetButton onClick={reset} label="Reset demo" />
            </div>
          </div>
        )}
      </DemoShell>
    </div>
  );
}
