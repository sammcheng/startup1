import type { Tool, ToolListResponse } from "@/types/tool";
import { shouldSkipBuildTimeFetch } from "@/lib/api";
import { CONVERTER_ENABLED, CONVERTER_URL } from "@/lib/env";

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
  qa_inputs?: Record<string, unknown>;
  qa_avg_ms?: number | null;
  qa_certified?: boolean;
  review_status?: string;
}

function languageToCategory(lang: string, description: string): Tool["category"] {
  const d = description.toLowerCase();
  if (d.includes("nlp") || d.includes("language model") || d.includes("text") || d.includes("sentiment") || d.includes("summariz")) return "nlp";
  if (d.includes("image") || d.includes("vision") || d.includes("object detect") || d.includes("ocr")) return "computer_vision";
  if (d.includes("data") || d.includes("analytics") || d.includes("forecast") || d.includes("ml") || d.includes("machine learn")) return "data_analysis";
  if (d.includes("generat") || d.includes("diffusion") || d.includes("music") || d.includes("art") || d.includes("create content")) return "generation";
  return "automation";
}

function buildInputSchema(c: ConverterTool): Record<string, unknown> | null {
  const first = c.endpoints?.[0];
  const hasFields = first?.request_body && Object.keys(first.request_body).length > 0;
  if (!hasFields && !c.qa_certified && !c.qa_inputs) return null;

  const schema: Record<string, unknown> = {};

  if (hasFields && first?.request_body) {
    schema.fields = Object.entries(first.request_body).map(([name, typeDesc]) => ({
      name,
      type: typeDesc.toLowerCase().includes("file") ? "file"
            : typeDesc.toLowerCase().includes("url") ? "url"
            : typeDesc.toLowerCase().includes("number") || typeDesc.toLowerCase().includes("int") ? "number"
            : "string",
      label: name.replace(/_/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase()),
      placeholder: typeDesc.split("—")[0]?.split("–")[0]?.trim() ?? name,
      required: true,
    }));
  }

  if (c.qa_inputs) schema.qa_inputs = c.qa_inputs;
  if (c.qa_certified !== undefined) schema.qa_certified = c.qa_certified;
  if (c.qa_avg_ms != null) schema.qa_avg_ms = c.qa_avg_ms;
  if (c.review_status) schema.review_status = c.review_status;

  return schema;
}

function toTool(c: ConverterTool): Tool {
  const inputSchema = buildInputSchema(c);
  const firstResponse = c.endpoints?.[0]?.response_example ?? null;

  return {
    id: c.id,
    seller_id: "converter",
    seller: { id: "converter", display_name: c.name ?? c.slug, avatar_url: null, username: c.slug },
    name: c.name ?? (c as unknown as Record<string, unknown>).repo_name as string ?? c.slug,
    slug: c.slug,
    tagline: (c.description?.length ?? 0) > 120 ? c.description.slice(0, 117) + "…" : (c.description ?? c.slug),
    description: c.description ?? "",
    category: languageToCategory(c.language, c.description),
    status: "live",
    ownership_type: "royalty",
    input_type: inputSchema ? "json" : "text",
    output_type: "json",
    input_schema: inputSchema,
    output_schema: firstResponse ? { example_output: firstResponse } : null,
    price_per_request: null,
    demo_url: null,
    api_endpoint: `${CONVERTER_URL}/api/tools/${c.slug}/demo`,
    docker_image_uri: null,
    github_url: c.repo_url,
    documentation: c.endpoints.length > 0
      ? `## Endpoints\n\n${c.endpoints.map(ep => `### ${ep.method} ${ep.path}\n${ep.summary}`).join("\n\n")}`
      : null,
    avg_response_time_ms: c.qa_avg_ms ?? 180,
    total_requests: 0,
    uptime_percentage: "99.9",
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
  if (!CONVERTER_ENABLED) {
    throw new Error("Converter service is not configured.");
  }
  if (shouldSkipBuildTimeFetch(CONVERTER_URL)) {
    throw new Error("Skipping local converter fetch during production build.");
  }

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
  if (!CONVERTER_ENABLED) {
    return null;
  }
  if (shouldSkipBuildTimeFetch(CONVERTER_URL)) {
    return null;
  }

  const res = await fetch(`${CONVERTER_URL}/api/tools/${slug}`, {
    cache: "no-store",
  });
  if (!res.ok) return null;
  const data = (await res.json()) as ConverterTool & {
    endpoints?: ConverterTool["endpoints"];
  };
  return toTool(data);
}
