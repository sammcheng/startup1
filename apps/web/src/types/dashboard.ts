export interface DashboardStats {
  total_api_calls_this_month: number;
  total_spend_this_month: string;
  total_earned_this_month: string;
  active_tools: number;
}

export interface DashboardActivityItem {
  id: string;
  tool_id: string;
  tool_name: string;
  request_timestamp: string;
  status_code: number;
  response_time_ms: number;
  cost: string;
  error_message: string | null;
}

export interface DashboardPurchasedTool {
  tool_id: string;
  tool_name: string;
  slug: string;
  category: string;
  calls_this_month: number;
  spend_this_month: string;
  last_used_at: string | null;
}

export interface DashboardUsagePoint {
  date: string;
  calls: number;
  spend: string;
}

export interface DashboardSummaryResponse {
  display_name: string;
  role: string;
  stats: DashboardStats;
  active_api_keys: number;
  purchased_tools: DashboardPurchasedTool[];
  recent_activity: DashboardActivityItem[];
  usage_chart_data: DashboardUsagePoint[];
}
