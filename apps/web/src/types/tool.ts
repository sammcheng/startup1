export type ToolCategory =
  | "nlp"
  | "computer_vision"
  | "data_analysis"
  | "automation"
  | "generation"
  | "other";

export type ToolStatus =
  | "draft"
  | "processing"
  | "live"
  | "paused"
  | "rejected";

export type OwnershipType = "royalty" | "full_sale";
export type InputType = "text" | "image" | "json" | "csv" | "url" | "file";
export type OutputType = "json" | "text" | "image" | "csv" | "file";

export interface SellerInfo {
  id: string;
  display_name: string;
  avatar_url: string | null;
  username: string;
}

export interface Tool {
  id: string;
  seller_id: string;
  seller: SellerInfo;
  name: string;
  slug: string;
  tagline: string;
  description: string;
  category: ToolCategory;
  status: ToolStatus;
  ownership_type: OwnershipType;
  input_type: InputType | null;
  output_type: OutputType | null;
  input_schema: Record<string, unknown> | null;
  output_schema: Record<string, unknown> | null;
  environment_variables?: Array<{ key: string; value: string }> | null;
  source_file_tree?: string[] | null;
  /** Decimal serialised as string from Python */
  price_per_request: string | null;
  one_time_price: string | null;
  demo_url: string | null;
  api_endpoint: string | null;
  docker_image_uri: string | null;
  github_url: string | null;
  source_s3_key?: string | null;
  config_s3_key?: string | null;
  entry_command?: string | null;
  port?: number;
  processing_error?: string | null;
  documentation: string | null;
  avg_response_time_ms: number | null;
  total_requests: number;
  uptime_percentage: string | null;
  is_featured: boolean;
  view_count: number;
  created_at: string;
  updated_at: string;
}

export interface ToolListResponse {
  items: Tool[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export interface MarketplaceStats {
  live_tools: number;
  active_sellers: number;
  api_calls_served: number;
  avg_response_time_ms: number | null;
}

export type SortBy = "popular" | "newest" | "price_low" | "price_high";

export interface ToolFilters {
  category?: ToolCategory;
  min_price?: number;
  max_price?: number;
  search?: string;
  sort_by?: SortBy;
}

export interface ToolUploadResponse {
  tool_id: string;
  job_id: string | null;
  status: ToolStatus;
  status_url: string;
  source_file_tree: string[] | null;
}

export interface ToolStatusResponse {
  tool_id: string;
  status: ToolStatus;
  error_message: string | null;
  api_endpoint: string | null;
  source_file_tree: string[] | null;
}
