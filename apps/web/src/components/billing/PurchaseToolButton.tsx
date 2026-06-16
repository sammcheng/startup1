"use client";

import Link from "next/link";
import { useState } from "react";

import { useCurrentAccount } from "@/hooks/useAuth";
import { api, ApiError } from "@/lib/api";
import type { ToolPurchaseResponse } from "@/types/billing";

interface PurchaseToolButtonProps {
  toolId: string;
}

export default function PurchaseToolButton({ toolId }: PurchaseToolButtonProps) {
  const account = useCurrentAccount();
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  if (!account.isLoaded || !account.isSignedIn) {
    return (
      <Link
        href="/sign-in"
        className="flex items-center justify-center gap-2 w-full rounded-lg py-2.5 text-sm font-semibold transition-all hover:opacity-90 active:scale-[0.98]"
        style={{ background: "var(--blue)", color: "#fff" }}
      >
        Sign in to add tool
        <span>→</span>
      </Link>
    );
  }

  async function purchaseTool() {
    setStatus("saving");
    setMessage(null);
    try {
      const token = await account.getToken();
      const purchase = await api.post<ToolPurchaseResponse>(`/billing/tools/${toolId}/purchase`, undefined, { token });
      if (purchase.checkout_url) {
        window.location.assign(purchase.checkout_url);
        return;
      }
      if (purchase.status === "pending") {
        setStatus("error");
        setMessage("Checkout is already pending. Refresh and try again if Stripe did not open.");
        return;
      }
      setStatus("saved");
      setMessage("Added to your buyer dashboard.");
    } catch (error) {
      setStatus("error");
      if (error instanceof ApiError && error.status === 403) {
        setMessage("You cannot add your own seller tool.");
      } else {
        setMessage("Could not add this tool yet. Try again in a moment.");
      }
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => void purchaseTool()}
        disabled={status === "saving"}
        className="flex items-center justify-center gap-2 w-full rounded-lg py-2.5 text-sm font-semibold transition-all hover:opacity-90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
        style={{ background: "var(--blue)", color: "#fff" }}
      >
        {status === "saving" ? "Adding..." : status === "saved" ? "Added" : "Add to dashboard"}
        <span>{status === "saved" ? "✓" : "→"}</span>
      </button>
      {message ? (
        <p
          style={{
            color: status === "error" ? "#dc2626" : "var(--green)",
            fontSize: 12,
            marginTop: 8,
            textAlign: "center",
          }}
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
