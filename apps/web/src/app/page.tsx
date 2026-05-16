import type { Metadata } from "next";
import { api, buildQuery } from "@/lib/api";
import type { Tool, ToolListResponse } from "@/types/tool";
import { fetchConverterTools } from "@/lib/converterTools";
import LandingPage from "./LandingPage";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Hackmarket — AI Tool Marketplace",
  description:
    "Every hackathon builds tools that die on GitHub. Hackmarket brings them back to life. A curated API marketplace where developers sell their AI tools and companies use them with one API call.",
};

export default async function Home() {
  let featuredTools: Tool[] = [];

  // Try main API, fall back to converter (newest 4 tools)
  try {
    const data = await api.get<ToolListResponse>(
      `/tools${buildQuery({ is_featured: true, limit: 4, sort_by: "popular" })}`,
      { cache: "no-store" }
    );
    featuredTools = data.items;
  } catch {
    try {
      const data = await fetchConverterTools(4, 0);
      featuredTools = data.items;
    } catch {
      // both unavailable — show empty state
    }
  }

  return <LandingPage featuredTools={featuredTools} featuredToolsUnavailable={false} />;
}
