// Shared types and constants for Hackmarket
// Cross-app contract — frontend, API, and converter all import from here.

// ─── Generic envelopes ───

export type ApiResponse<T> =
  | {
      data: T;
      error: null;
    }
  | {
      data: null;
      error: string;
    };

export type PaginatedResponse<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};

// ─── Constants ───

export const CATEGORIES = [
  'Auth',
  'Payments',
  'Notifications',
  'Analytics',
  'AI/ML',
  'DevOps',
  'UI Components',
  'Data Pipelines',
] as const;

export type Category = (typeof CATEGORIES)[number];

export const MODULE_STATUSES = [
  'pending_sandbox_test',
  'sandbox_running',
  'sandbox_passed',
  'sandbox_failed',
  'pending_review',
  'approved',
  'rejected',
  'live',
] as const;

export type ModuleStatus = (typeof MODULE_STATUSES)[number];

export const PRICING_MODELS = ['buy', 'royalty'] as const;
export type PricingModel = (typeof PRICING_MODELS)[number];

export const COMPLEXITY_LEVELS = ['Easy', 'Medium', 'Advanced'] as const;
export type Complexity = (typeof COMPLEXITY_LEVELS)[number];

// ─── Core entity — generic "Module" shape used by the discovery / demo surface ───
// (Hackmarket's richer Tool type lives in apps/web/src/types/tool.ts and the
// FastAPI ToolResponse. This Module shape is the simpler contract the kc-style
// discovery + demo UI works with.)

export interface Module {
  id: string;
  githubUrl: string;
  submitterEmail: string;
  name: string;
  slug: string;
  description: string;
  category: Category;
  techStack: string[];
  inputContract: string;
  outputContract: string;
  pricingModel: PricingModel;
  price: number; // cents for buy, cents/month for royalty
  status: ModuleStatus;
  complexity: Complexity;
  rating: number | null;
  integrationCount: number;
  createdAt: string;
  updatedAt: string;
}

// ─── Discovery ───

export interface DiscoverRequest {
  query: string;
  categories?: Category[];
}

export interface ModuleMatch {
  module: Module;
  fitLine: string;
  matchScore: number;
  matchedKeywords: string[];
  source?: 'verified' | 'preview';
}

export interface DiscoverResponse {
  matches: ModuleMatch[];
  query: string;
}

// ─── Submit ───

export interface SubmitRequest {
  githubUrl: string;
  submitterEmail: string;
}

export interface SubmitResponse {
  module: Module;
  message: string;
}

export interface SubmitEditRequest {
  name?: string;
  description?: string;
  category?: Category;
  techStack?: string[];
  inputContract?: string;
  outputContract?: string;
  pricingModel?: PricingModel;
  price?: number;
}

export interface SubmitEditResponse {
  module: Module;
}

// ─── Proxy envelope (customer-facing) ───

export interface ProxyResponse<T = unknown> {
  success: boolean;
  data: T;
  module: string;
  version: string;
  requestId: string;
  error?: string;
}

// ─── Dashboard ───

export interface MonthlyEarning {
  month: string;
  amount: number;
}

export interface DashboardResponse {
  stats: {
    totalEarnings: number;
    liveModules: number;
    totalIntegrations: number;
    inReview: number;
  };
  modules: Module[];
  earnings: MonthlyEarning[];
}

// ─── Utilities ───

export function formatPrice(cents: number, model: PricingModel): string {
  const dollars = (cents / 100).toFixed(0);
  return model === 'buy' ? `$${dollars}` : `$${dollars}/mo`;
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}
