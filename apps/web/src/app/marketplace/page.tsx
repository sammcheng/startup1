import type { Metadata } from "next";
import { api, buildQuery } from "@/lib/api";
import type { ToolListResponse } from "@/types/tool";
import { fetchConverterTools } from "@/lib/converterTools";
import MarketplaceClient from "./MarketplaceClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Marketplace — Hackmarket",
  description:
    "Discover, integrate, and scale with production-ready AI tools. Browse by category, filter by price, and start building in minutes.",
};

export default async function MarketplacePage() {
  let initialData: ToolListResponse | null = null;

  // Try main API, then the live converter service. Empty means empty.
  try {
    const apiResp = await api.get<ToolListResponse>(
      `/tools${buildQuery({ limit: 20, sort_by: "newest" })}`,
      { cache: "no-store" }
    );
    if (apiResp.items.length > 0) {
      initialData = apiResp;
    }
  } catch {
    // fall through
  }

  if (!initialData) {
    try {
      const conv = await fetchConverterTools(20, 0);
      if (conv.items.length > 0) initialData = conv;
    } catch {
      // fall through
    }
  }

  return <MarketplaceClient initialData={initialData} initialFetchFailed={false} />;
}
