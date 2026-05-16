import type { Tool, ToolListResponse } from "@/types/tool";

const CONVERTER_URL =
  process.env.NEXT_PUBLIC_CONVERTER_URL ?? "http://localhost:8080";

interface ConverterTool {
  id: string;
  slug: string;
  repo_url: string;
  name: string;
  language: string;
  description: string;
  endpoints: Array<{
    method: string;
    path: string;
    summary: string;
    request_body?: Record<string, string>;
    response_example?: Record<string, unknown>;
  }>;
  setup_notes: string;
  created_at: string;
}

function languageToCategory(lang: string): Tool["category"] {
  const l = lang.toLowerCase();
  if (l === "python" || l === "go" || l === "rust") return "automation";
  if (l === "javascript" || l === "typescript") return "automation";
  return "other";
}

function toTool(c: ConverterTool): Tool {
  return {
    id: c.id,
    seller_id: "converter",
    seller: { id: "converter", display_name: "Hackmarket Converter", avatar_url: null, username: "converter" },
    name: c.name,
    slug: c.slug,
    tagline: c.description.length > 120 ? c.description.slice(0, 117) + "…" : c.description,
    description: c.description,
    category: languageToCategory(c.language),
    status: "live",
    ownership_type: "royalty",
    input_type: "json",
    output_type: "json",
    input_schema: null,
    output_schema: null,
    price_per_request: null,
    demo_url: null,
    api_endpoint: null,
    docker_image_uri: null,
    github_url: c.repo_url,
    documentation: null,
    avg_response_time_ms: null,
    total_requests: 0,
    uptime_percentage: null,
    is_featured: false,
    view_count: 0,
    created_at: c.created_at,
    updated_at: c.created_at,
  };
}

export async function fetchConverterTools(
  limit = 20,
  offset = 0
): Promise<ToolListResponse> {
  const res = await fetch(
    `${CONVERTER_URL}/api/tools?limit=${limit}&offset=${offset}`,
    { cache: "no-store" }
  );
  if (!res.ok) throw new Error("Converter unavailable");
  const data = (await res.json()) as { tools: ConverterTool[]; total: number };
  return {
    items: data.tools.map(toTool),
    total: data.total,
    page: Math.floor(offset / limit) + 1,
    limit,
    pages: Math.ceil(data.total / limit),
  };
}

export async function fetchConverterTool(slug: string): Promise<Tool | null> {
  const res = await fetch(`${CONVERTER_URL}/api/tools/${slug}`, {
    cache: "no-store",
  });
  if (!res.ok) return null;
  const data = (await res.json()) as ConverterTool & {
    endpoints?: ConverterTool["endpoints"];
  };
  return toTool(data);
}
