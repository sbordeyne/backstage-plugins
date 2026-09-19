/**
 * Every paginated list response in the kubespec API.
 *
 * Not `KubespecPage`, which would collide with the page component the frontend
 * exports under that name.
 */
export interface KubespecPaginated<T> {
  items: T[];
  /** Absent on the last page. */
  nextCursor?: string;
  totalCount?: number;
}
