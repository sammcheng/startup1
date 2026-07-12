export type SubmissionStage =
  | "submitted"
  | "testing"
  | "manual_review"
  | "listed"
  | "rejected"
  | "revoked";

export interface SubmissionMetrics {
  confidence: number;
  endpoints_total: number;
  endpoints_passing: number;
  avg_response_ms: number;
  p50_response_ms: number;
  p95_response_ms: number;
  p99_response_ms: number;
  io_match_pct: number;
  security: {
    critical: number;
    medium: number;
    low: number;
  };
  docs_quality: "Good" | "Fair" | "Poor";
  test_coverage_pct: number;
  deps_total: number;
  deps_outdated: number;
  deps_vulnerable: number;
  rate_limiting: boolean;
  consistent_errors: boolean;
  rest_conventions: boolean;
  loc: number;
  files: number;
  license: string | null;
  last_commit: string;
}

export interface LiveMonitoring {
  api_calls_total: number;
  last_updated_at: string;
  uptime_pct?: number;
  uptime_window_days?: number;
  health?: "healthy" | "degraded" | "outage" | "unknown";
}

export interface EndpointTestResult {
  method: string;
  path: string;
  status: number;
  latency_ms: number;
  passed: boolean;
  expected_keys: string[];
  actual_sample: Record<string, unknown>;
  failure_reason?: string;
}

export interface SubmissionRecord {
  id: string;
  name: string;
  slug: string;
  github_url: string;
  submitter_email: string;
  language: string;
  category: string;
  tech_stack: string[];
  description: string;
  inputs: string;
  outputs: string;
  pricing_model: "buy" | "royalty";
  price_cents: number;
  submitted_at: string;
  stage: SubmissionStage;
  metrics: SubmissionMetrics;
  metrics_available?: boolean;
  endpoint_results?: EndpointTestResult[];
  reviewer_notes?: string;
  rejection_reason?: string;
  live?: LiveMonitoring;
  testing_started_at?: string;
  processing_job?: {
    id: string;
    status: "queued" | "running" | "retrying" | "succeeded" | "failed";
    attempts: number;
    max_attempts: number;
    trigger: string;
    last_error: string | null;
    enqueued_at: string | null;
    started_at: string | null;
    finished_at: string | null;
  };
}

export interface SandboxLine {
  text: string;
  indent?: number;
  style?: "neutral" | "ok" | "warn" | "err" | "header";
}

/**
 * Strip markup and collapse whitespace before rendering repository-derived names.
 */
export function sanitizeName(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .replace(/<[^>]*>/g, "")
    .replace(/&[a-z0-9#]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}
