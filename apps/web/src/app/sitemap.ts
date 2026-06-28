import type { MetadataRoute } from "next";
import { API_BASE, shouldSkipBuildTimeFetch } from "@/lib/api";
import { APP_URL } from "@/lib/env";

interface ToolSummary {
  slug: string;
  updated_at: string;
}

interface ToolListResponse {
  items: ToolSummary[];
}

async function fetchLiveToolSlugs(): Promise<ToolSummary[]> {
  if (shouldSkipBuildTimeFetch(API_BASE)) return [];

  try {
    const res = await fetch(`${API_BASE}/tools?limit=100`, {
      next: { revalidate: 3600 },
    });
    if (!res.ok) return [];
    const data: ToolListResponse = await res.json();
    return data.items ?? [];
  } catch {
    return [];
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const tools = await fetchLiveToolSlugs();

  const staticPages: MetadataRoute.Sitemap = [
    {
      url: APP_URL,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${APP_URL}/marketplace`,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 0.9,
    },
    {
      url: `${APP_URL}/docs`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      url: `${APP_URL}/pricing`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      url: `${APP_URL}/support`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.6,
    },
    {
      url: `${APP_URL}/terms`,
      lastModified: new Date(),
      changeFrequency: "yearly",
      priority: 0.4,
    },
    {
      url: `${APP_URL}/privacy`,
      lastModified: new Date(),
      changeFrequency: "yearly",
      priority: 0.4,
    },
    {
      url: `${APP_URL}/seller-agreement`,
      lastModified: new Date(),
      changeFrequency: "yearly",
      priority: 0.4,
    },
  ];

  const toolPages: MetadataRoute.Sitemap = tools.map((t) => ({
    url: `${APP_URL}/tools/${t.slug}`,
    lastModified: t.updated_at ? new Date(t.updated_at) : new Date(),
    changeFrequency: "weekly" as const,
    priority: 0.8,
  }));

  return [...staticPages, ...toolPages];
}
