/**
 * Standard Unified API Response Envelope
 */
export interface ApiResponse<T = any> {
  statusCode?: number;
  success: boolean;
  message?: string;
  data: T;
  timestamp: string;
}

/**
 * Standard Paginated Response
 */
export interface PaginatedResponse<T = any> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
