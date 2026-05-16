import type { Metadata } from "next";
import { api, buildQuery } from "@/lib/api";
import type { Tool, ToolListResponse } from "@/types/tool";
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

  try {
    const data = await api.get<ToolListResponse>(
      `/tools${buildQuery({ is_featured: true, limit: 4, sort_by: "popular" })}`,
      { cache: "no-store" }
    );
    featuredTools = data.items;
  } catch {
    featuredToolsUnavailable = true;
  }

  return <LandingPage featuredTools={featuredTools} featuredToolsUnavailable={featuredToolsUnavailable} />;
}
