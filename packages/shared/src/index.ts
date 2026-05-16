// Shared types and constants for Hackmarket

export type ApiResponse<T> = {
  data: T;
  error: null;
} | {
  data: null;
  error: string;
};

export type PaginatedResponse<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};
