import type { Metadata } from "next";
import { api, buildQuery } from "@/lib/api";
import type { ToolListResponse } from "@/types/tool";
import MarketplaceClient from "./MarketplaceClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Marketplace — Hackmarket",
  description:
    "Discover, integrate, and scale with production-ready AI tools. Browse by category, filter by price, and start building in minutes.",
};

export default async function MarketplacePage() {
  let initialData: ToolListResponse | null = null;
  let initialFetchFailed = false;

  try {
    initialData = await api.get<ToolListResponse>(
      `/tools${buildQuery({ limit: 20, sort_by: "newest" })}`,
      { cache: "no-store" }
    );
  } catch {
    initialFetchFailed = true;
  }

  return <MarketplaceClient initialData={initialData} initialFetchFailed={initialFetchFailed} />;
}
