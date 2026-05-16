export interface SellerRevenuePoint {
  date: string;
  amount: string;
}

export interface SellerRequestsPoint {
  date: string;
  count: number;
}

export interface SellerToolSummary {
  tool_id: string;
  tool_name: string;
  slug: string;
  status: "draft" | "processing" | "live" | "paused" | "rejected";
  requests_this_month: number;
  revenue_this_month: string;
  avg_response_time_ms: number | null;
}

export interface SellerTopTool {
  tool_id: string;
  tool_name: string;
  revenue_this_month: string;
}

export interface SellerDashboardResponse {
  total_tools: number;
  total_revenue_all_time: string;
  total_revenue_this_month: string;
  previous_month_revenue: string;
  total_requests_this_month: number;
  active_tools: number;
  avg_response_time_ms: number | null;
  top_tool: SellerTopTool | null;
  revenue_chart_data: SellerRevenuePoint[];
  tools: SellerToolSummary[];
}

export interface SellerErrorSummary {
  error_message: string;
  count: number;
}

export interface SellerErrorLogItem {
  timestamp: string;
  error_message: string | null;
  status_code: number;
  input_size_bytes: number;
  output_size_bytes: number;
  response_time_ms: number;
}

export interface SellerAnalyticsResponse {
  period: "7d" | "30d" | "90d" | "all";
  requests_over_time: SellerRequestsPoint[];
  revenue_over_time: SellerRevenuePoint[];
  unique_users: number;
  avg_response_time_ms: number | null;
  error_rate: number;
  top_errors: SellerErrorSummary[];
  geographic_distribution: Array<Record<string, string | number>>;
  p50_response_time_ms: number | null;
  p95_response_time_ms: number | null;
  p99_response_time_ms: number | null;
  recent_errors: SellerErrorLogItem[];
}
