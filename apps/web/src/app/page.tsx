import type { Metadata } from "next";
import { api, buildQuery } from "@/lib/api";
import type { Tool, ToolListResponse } from "@/types/tool";
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

  // Production must reflect live user-owned marketplace data. Converter fallback is local/dev only.
  try {
    const data = await api.get<ToolListResponse>(
      `/tools${buildQuery({ is_featured: true, limit: 4, sort_by: "popular" })}`,
      { cache: "no-store" }
    );
    featuredTools = data.items;
  } catch {
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

  return <LandingPage featuredTools={featuredTools} featuredToolsUnavailable={featuredToolsUnavailable} />;
}
