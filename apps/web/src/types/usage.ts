export type UsageGranularity = "hour" | "day" | "month";

export interface UsageTimeBucket {
  period_start: string;
  tool_id: string;
  tool_name: string;
  total_requests: number;
  total_cost: string;
  avg_response_time: number | null;
  unique_users: number | null;
  total_revenue: string | null;
}

export interface UsageToolBreakdown {
  tool_id: string;
  tool_name: string;
  total_requests: number;
  total_cost: string;
  total_revenue: string | null;
}

export interface UsageSummaryResponse {
  granularity: UsageGranularity;
  start_date: string;
  end_date: string;
  total_requests: number;
  total_cost: string;
  avg_response_time: number | null;
  total_revenue: string | null;
  unique_users: number | null;
  buckets: UsageTimeBucket[];
  by_tool: UsageToolBreakdown[];
}
