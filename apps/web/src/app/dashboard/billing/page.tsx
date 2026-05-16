"use client";

import { useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";

import { api } from "@/lib/api";
import type { BillingInvoiceSummary, PaymentMethodSummary, SellerBalanceResponse, SetupPaymentResponse } from "@/types/billing";
import type { DashboardSummaryResponse } from "@/types/dashboard";

const stripePromise = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
  ? loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY)
  : null;

export default function BillingPage() {
  const { getToken, isLoaded } = useAuth();
  const [summary, setSummary] = useState<DashboardSummaryResponse | null>(null);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodSummary[]>([]);
  const [invoices, setInvoices] = useState<BillingInvoiceSummary[]>([]);
  const [sellerBalance, setSellerBalance] = useState<SellerBalanceResponse | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    if (!isLoaded) {
      return;
    }
    void loadBilling();
  }, [getToken, isLoaded]);

  async function loadBilling() {
    try {
      const token = await getToken();
      const [dashboard, methods, invoiceList, seller] = await Promise.all([
        api.get<DashboardSummaryResponse>("/dashboard/summary", { token }),
        api.get<PaymentMethodSummary[]>("/billing/payment-methods", { token }),
        api.get<BillingInvoiceSummary[]>("/billing/invoices", { token }),
        api.get<SellerBalanceResponse>("/billing/seller-balance", { token }),
      ]);
      setSummary(dashboard);
      setPaymentMethods(methods);
      setInvoices(invoiceList);
      setSellerBalance(seller);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load billing.");
    }
  }

  async function beginPaymentSetup() {
    setIsBusy(true);
    try {
      const token = await getToken();
      const response = await api.post<SetupPaymentResponse>("/billing/setup-payment", {}, { token });
      setClientSecret(response.client_secret);
      setError(null);
    } catch (setupError) {
      setError(setupError instanceof Error ? setupError.message : "Could not start payment setup.");
    } finally {
      setIsBusy(false);
    }
  }

  async function onboardSeller() {
    setIsBusy(true);
    try {
      const token = await getToken();
      const response = await api.post<{ onboarding_url: string }>("/billing/onboard-seller", {}, { token });
      window.location.href = response.onboarding_url;
    } catch (onboardError) {
      setError(onboardError instanceof Error ? onboardError.message : "Could not start seller onboarding.");
      setIsBusy(false);
    }
  }

  const role = summary?.role ?? "buyer";
  const isSeller = role === "seller" || role === "both" || role === "admin";

  const primaryCard = paymentMethods[0] ?? null;
  const estimatedBill = summary?.stats.total_spend_this_month ?? "0";
  const usageCalls = summary?.stats.total_api_calls_this_month ?? 0;

  const stripeOptions = useMemo(
    () => (clientSecret ? { clientSecret, appearance: { theme: "stripe" as const } } : null),
    [clientSecret]
  );

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 28, flexWrap: "wrap", gap: 12 }}>
        <div>
          <p style={{ fontSize: 10.5, fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: ".1em", color: "var(--faint)", marginBottom: 8 }}>Account</p>
          <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 26, color: "var(--text)", marginBottom: 6 }}>Billing</h1>
          <p style={{ fontSize: 13.5, color: "var(--muted)" }}>Credit balance, payment methods, and payouts.</p>
        </div>
        <Link href="/dashboard/usage" style={{
          padding: "10px 18px", borderRadius: "var(--radius-sm)",
          border: "1px solid var(--border)", color: "var(--muted)", fontSize: 13,
          fontFamily: "var(--font-mono)",
        }}>
          View usage →
        </Link>
      </div>

      {error && <div style={{ background: "rgba(220,38,38,.06)", border: "1px solid rgba(220,38,38,.2)", borderRadius: "var(--radius-sm)", padding: "10px 16px", marginBottom: 20, fontSize: 13, color: "var(--red)" }}>{error}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Panel title="Buyer summary">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <MetricCard label="API calls this month" value={formatInt(usageCalls)} />
              <MetricCard label="Estimated bill" value={formatCurrency(estimatedBill)} />
            </div>
          </Panel>

          <Panel title="Payment method">
            {primaryCard ? (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 500, color: "var(--text)" }}>
                    {primaryCard.brand ? capitalize(primaryCard.brand) : "Card"} ending in {primaryCard.last4 ?? "XXXX"}
                  </div>
                  <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 4 }}>
                    Expires {primaryCard.exp_month ?? "--"}/{primaryCard.exp_year ?? "--"}
                  </div>
                </div>
                <Btn onClick={() => void beginPaymentSetup()} disabled={isBusy}>Update card</Btn>
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
                <p style={{ fontSize: 13.5, color: "var(--muted)" }}>No saved payment method yet.</p>
                <Btn onClick={() => void beginPaymentSetup()} disabled={isBusy}>Add card</Btn>
              </div>
            )}
            {clientSecret && stripePromise && stripeOptions && (
              <div style={{ marginTop: 20, padding: 16, background: "var(--elevated)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)" }}>
                <Elements stripe={stripePromise} options={stripeOptions}>
                  <PaymentMethodForm onSuccess={() => void loadBilling()} />
                </Elements>
              </div>
            )}
          </Panel>

          <Panel title="Invoice history">
            <table className="data-table">
              <thead><tr><th>Date</th><th>Amount</th><th>Status</th><th>PDF</th></tr></thead>
              <tbody>
                {invoices.length ? invoices.map((inv) => (
                  <tr key={inv.id}>
                    <td style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{formatDate(inv.created_at)}</td>
                    <td style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--text)" }}>{formatCurrency(inv.amount_paid || inv.amount_due)}</td>
                    <td><StatusPill status={inv.status ?? "unknown"} /></td>
                    <td>{inv.invoice_pdf ? <a href={inv.invoice_pdf} target="_blank" rel="noreferrer" style={{ color: "var(--blue)", fontFamily: "var(--font-mono)", fontSize: 12 }}>Download</a> : "—"}</td>
                  </tr>
                )) : (
                  <tr><td colSpan={4} style={{ padding: "24px 16px", color: "var(--faint)", fontFamily: "var(--font-mono)", fontSize: 12 }}>No invoices yet.</td></tr>
                )}
              </tbody>
            </table>
          </Panel>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Panel title="Seller payouts">
            {isSeller ? (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
                  <MetricCard label="Current balance" value={formatCurrency(sellerBalance?.current_balance ?? "0")} />
                  <MetricCard label="Pending" value={formatCurrency(sellerBalance?.pending_payouts ?? "0")} />
                </div>
                {sellerBalance && sellerBalance.payout_history.length > 0 ? (
                  <table className="data-table">
                    <thead><tr><th>Date</th><th>Amount</th><th>Status</th></tr></thead>
                    <tbody>
                      {sellerBalance.payout_history.map((p, i) => (
                        <tr key={i}>
                          <td style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{formatDate(p.created_at)}</td>
                          <td style={{ fontFamily: "var(--font-mono)", fontSize: 13 }}>{formatCurrency(p.amount)}</td>
                          <td><StatusPill status={p.status ?? "pending"} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p style={{ fontSize: 13, color: "var(--faint)", fontFamily: "var(--font-mono)" }}>No payout history yet.</p>
                )}
                {Number(sellerBalance?.current_balance ?? "0") === 0 && Number(sellerBalance?.pending_payouts ?? "0") === 0 && (
                  <div style={{ marginTop: 16 }}>
                    <Btn onClick={() => void onboardSeller()} disabled={isBusy}>Set Up Payouts</Btn>
                  </div>
                )}
              </>
            ) : (
              <p style={{ fontSize: 13, color: "var(--muted)" }}>Switch to a seller account to enable payouts.</p>
            )}
          </Panel>

          <Panel title="Revenue by tool">
            {isSeller && sellerBalance?.revenue_by_tool.length ? (
              <table className="data-table">
                <thead><tr><th>Tool</th><th>Revenue</th><th>Fee</th><th>Payout</th></tr></thead>
                <tbody>
                  {sellerBalance.revenue_by_tool.map((item, i) => (
                    <tr key={i}>
                      <td style={{ color: "var(--text)", fontWeight: 500 }}>{item.tool_name}</td>
                      <td style={{ fontFamily: "var(--font-mono)", fontSize: 13 }}>{formatCurrency(item.revenue)}</td>
                      <td style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--faint)" }}>{formatCurrency(item.platform_fee)}</td>
                      <td style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--green)" }}>{formatCurrency(item.seller_payout)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p style={{ fontSize: 13, color: "var(--faint)", fontFamily: "var(--font-mono)" }}>Revenue by tool will appear once transactions clear.</p>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

function PaymentMethodForm({ onSuccess }: { onSuccess: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!stripe || !elements) { setMessage("Stripe has not finished loading yet."); return; }
    setIsSubmitting(true);
    setMessage(null);
    const result = await stripe.confirmSetup({
      elements,
      confirmParams: { return_url: `${window.location.origin}/dashboard/billing` },
      redirect: "if_required",
    });
    if (result.error) {
      setMessage(result.error.message ?? "Could not save the payment method.");
    } else {
      setMessage("Payment method saved.");
      onSuccess();
    }
    setIsSubmitting(false);
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <PaymentElement />
      {message && <div style={{ fontSize: 13, color: "var(--muted)" }}>{message}</div>}
      <Btn type="submit" disabled={!stripe || isSubmitting}>
        {isSubmitting ? "Saving…" : "Save payment method"}
      </Btn>
    </form>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", overflow: "hidden" }}>
      <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
        <p style={{ fontSize: 10.5, fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: ".1em", color: "var(--faint)" }}>{title}</p>
      </div>
      <div style={{ padding: 20 }}>{children}</div>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: "var(--elevated)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "14px 16px" }}>
      <p style={{ fontSize: 10.5, fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: ".1em", color: "var(--faint)", marginBottom: 10 }}>{label}</p>
      <p style={{ fontFamily: "var(--font-mono)", fontSize: 22, fontWeight: 700, color: "var(--text)" }}>{value}</p>
    </div>
  );
}

function Btn({ children, onClick, disabled, type = "button" }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean; type?: "button" | "submit" }) {
  return (
    <button type={type} onClick={onClick} disabled={disabled} style={{
      padding: "10px 22px", borderRadius: "var(--radius-sm)", background: "var(--blue)",
      color: "#fff", fontSize: 14, fontWeight: 600, border: "none", cursor: "pointer",
      opacity: disabled ? .6 : 1,
    }}>
      {children}
    </button>
  );
}

function StatusPill({ status }: { status: string }) {
  const color = status === "paid" || status === "succeeded" ? "var(--green)" : status === "pending" ? "var(--yellow)" : "var(--faint)";
  return <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color, textTransform: "uppercase", letterSpacing: ".07em" }}>{status}</span>;
}

function Table(props: { headers: string[]; rows: Array<Array<React.ReactNode>> }) {
  return (
    <div style={{ overflow: "hidden" }}>
      <div
        className="grid gap-4 bg-stone-900/80 px-5 py-3 text-xs uppercase tracking-[0.2em] text-stone-400"
        style={{ gridTemplateColumns: `repeat(${props.headers.length}, minmax(0, 1fr))` }}
      >
        {props.headers.map((header) => (
          <div key={header}>{header}</div>
        ))}
      </div>
      <div className="divide-y divide-stone-800">
        {props.rows.map((row, index) => (
          <div
            key={index}
            className="grid gap-4 px-5 py-4 text-sm text-stone-200"
            style={{ gridTemplateColumns: `repeat(${row.length}, minmax(0, 1fr))` }}
          >
            {row.map((cell, cellIndex) => (
              <div key={cellIndex}>{cell}</div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function formatCurrency(value: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(value || 0));
}

function formatInt(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatDate(value: string | null) {
  if (!value) {
    return "—";
  }
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
