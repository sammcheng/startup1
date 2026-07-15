import type { Metadata } from "next";
import { api, buildQuery } from "@/lib/api";
import type { MarketplaceStats, Tool, ToolListResponse } from "@/types/tool";
import { fetchConverterTools } from "@/lib/converterTools";
import { ALLOW_CONVERTER_CATALOG_FALLBACK } from "@/lib/env";
import LandingPage from "./LandingPage";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Hackmarket — AI Tool Marketplace",
  description:
    "Every hackathon builds tools that die on GitHub. Hackmarket brings them back to life. A curated API marketplace where developers sell their AI tools and companies use them with one API call.",
};

export default async function Home() {
  let featuredTools: Tool[] = [];
  let featuredToolsUnavailable = false;
  let marketplaceStats: MarketplaceStats | null = null;
  let marketplaceStatsUnavailable = false;

  // Production must reflect live user-owned marketplace data. Converter fallback is local/dev only.
  const [toolsResult, statsResult] = await Promise.allSettled([
    api.get<ToolListResponse>(
      `/tools${buildQuery({ is_featured: true, limit: 4, sort_by: "popular" })}`,
      { next: { revalidate: 60 } },
    ),
    api.get<MarketplaceStats>("/tools/stats", { next: { revalidate: 60 } }),
  ]);

  if (toolsResult.status === "fulfilled") {
    featuredTools = toolsResult.value.items;
  } else {
    featuredToolsUnavailable = true;
    if (ALLOW_CONVERTER_CATALOG_FALLBACK) {
      try {
        const data = await fetchConverterTools(4, 0);
        featuredTools = data.items;
        featuredToolsUnavailable = false;
      } catch {
        // both unavailable — show empty state
      }
    }
  }

  if (statsResult.status === "fulfilled") {
    marketplaceStats = statsResult.value;
  } else {
    marketplaceStatsUnavailable = true;
  }

  return (
    <LandingPage
      featuredTools={featuredTools}
      featuredToolsUnavailable={featuredToolsUnavailable}
      marketplaceStats={marketplaceStats}
      marketplaceStatsUnavailable={marketplaceStatsUnavailable}
    />
  );
}
