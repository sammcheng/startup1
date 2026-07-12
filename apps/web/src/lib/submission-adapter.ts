import type { Tool, ToolStatus } from "@/types/tool";
import type { SubmissionMetrics, SubmissionRecord, SubmissionStage } from "@/lib/submissions";
import type { ToolProcessingJob } from "@/types/seller";

function zeroMetrics(lastCommit: string): SubmissionMetrics {
  return {
    confidence: 0,
    endpoints_total: 0,
    endpoints_passing: 0,
    avg_response_ms: 0,
    p50_response_ms: 0,
    p95_response_ms: 0,
    p99_response_ms: 0,
    io_match_pct: 0,
    security: { critical: 0, medium: 0, low: 0 },
    docs_quality: "Good",
    test_coverage_pct: 0,
    deps_total: 0,
    deps_outdated: 0,
    deps_vulnerable: 0,
    rate_limiting: false,
    consistent_errors: false,
    rest_conventions: false,
    loc: 0,
    files: 0,
    license: null,
    last_commit: lastCommit,
  };
}

function toSubmissionStage(status: ToolStatus, job?: ToolProcessingJob | null): SubmissionStage {
  if (job) {
    if (job.status === "queued" || job.status === "running" || job.status === "retrying") {
      return "testing";
    }
    if (job.status === "failed") {
      return "rejected";
    }
  }

  switch (status) {
    case "processing":
      return "testing";
    case "live":
      return "listed";
    case "rejected":
      return "rejected";
    case "paused":
      return "revoked";
    case "draft":
    default:
      return "manual_review";
  }
}

function inferLanguage(tool: Tool): string {
  const source = `${tool.entry_command ?? ""} ${tool.documentation ?? ""}`.toLowerCase();
  if (source.includes("python")) return "Python";
  if (source.includes("node") || source.includes("typescript") || source.includes("javascript")) return "TypeScript";
  if (source.includes("go")) return "Go";
  if (source.includes("rust")) return "Rust";
  return "Unknown";
}

function inferTechStack(tool: Tool): string[] {
  const source = `${tool.entry_command ?? ""} ${tool.documentation ?? ""}`.toLowerCase();
  const stack: string[] = [];
  if (source.includes("python")) stack.push("Python");
  if (source.includes("fastapi")) stack.push("FastAPI");
  if (source.includes("flask")) stack.push("Flask");
  if (source.includes("node")) stack.push("Node.js");
  if (source.includes("typescript")) stack.push("TypeScript");
  if (source.includes("javascript")) stack.push("JavaScript");
  if (source.includes("redis")) stack.push("Redis");
  return stack;
}

function describeContract(
  schema: Record<string, unknown> | null,
  valueType: string | null,
): string {
  if (schema && Object.keys(schema).length > 0) {
    return JSON.stringify(schema, null, 2);
  }
  return valueType ? `${valueType} value` : "Not provided";
}

export function toolToSubmissionRecord(tool: Tool, job?: ToolProcessingJob | null): SubmissionRecord {
  const submittedAt = tool.created_at;
  const updatedAt = tool.updated_at;
  const stage = toSubmissionStage(tool.status, job);
  const language = inferLanguage(tool);
  const techStack = inferTechStack(tool);

  return {
    id: tool.id,
    name: tool.name,
    slug: tool.slug,
    github_url: tool.github_url ?? "",
    submitter_email: tool.seller.username,
    language,
    category: tool.category,
    tech_stack: techStack,
    description: tool.description,
    inputs: describeContract(tool.input_schema, tool.input_type),
    outputs: describeContract(tool.output_schema, tool.output_type),
    pricing_model: tool.ownership_type === "full_sale" ? "buy" : "royalty",
    price_cents: Math.round(Number(tool.one_time_price ?? tool.price_per_request ?? "0") * 100),
    submitted_at: submittedAt,
    stage,
    testing_started_at: stage === "testing" ? job?.started_at ?? job?.enqueued_at ?? updatedAt : undefined,
    metrics: zeroMetrics(updatedAt),
    metrics_available: false,
    live: stage === "listed" || stage === "revoked"
      ? {
          api_calls_total: tool.total_requests,
          last_updated_at: updatedAt,
          uptime_pct:
            tool.uptime_percentage === null
              ? undefined
              : Number(tool.uptime_percentage),
        }
      : undefined,
    processing_job: job
      ? {
          id: job.id,
          status: job.status,
          attempts: job.attempts,
          max_attempts: job.max_attempts,
          trigger: job.trigger,
          last_error: job.last_error,
          enqueued_at: job.enqueued_at,
          started_at: job.started_at,
          finished_at: job.finished_at,
        }
      : undefined,
    rejection_reason: job?.last_error ?? tool.processing_error ?? undefined,
    reviewer_notes: job?.last_error ?? tool.processing_error ?? undefined,
  };
}
