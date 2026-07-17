// Minimal reference object used for relation fields across all entities.
// Rich enough for badge display, avoids extra fetches on modal open.
export interface IRelationRef {
  id: number
  slug: string
  displayName: string
}

// Typed wrapper for paginated list responses from the API.
// The backend interceptor sets { data, message, count, pagination } at the top level.
export interface IPaginatedApiResponse<T> {
  data: T
  message?: string
  count?: number
  pagination?: {
    total: number
    page: number
    pageSize: number
    totalPages?: number
  }
}
