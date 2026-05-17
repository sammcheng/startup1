import type { Metadata } from "next";
import { api, buildQuery } from "@/lib/api";
import type { ToolListResponse } from "@/types/tool";
import { fetchConverterTools } from "@/lib/converterTools";
import { buildKcCatalogResponse } from "@/lib/kcMockModules";
import MarketplaceClient from "./MarketplaceClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Marketplace — Hackmarket",
  description:
    "Discover, integrate, and scale with production-ready AI tools. Browse by category, filter by price, and start building in minutes.",
};

export default async function MarketplacePage() {
  let initialData: ToolListResponse | null = null;

  // Try main API → converter → kc catalog. Treat an *empty* response from
  // an earlier source the same as a failure so the marketplace never
  // renders an empty browse view while we have catalog data ready.
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

  if (!initialData) {
    // The 10 kc modules — same source the discovery search uses, so the
    // browse view always shows the AI tools the user expects to see.
    initialData = buildKcCatalogResponse(1, 20);
  }

  return <MarketplaceClient initialData={initialData} initialFetchFailed={false} />;
}
