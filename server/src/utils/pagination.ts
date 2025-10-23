import { eq, desc, asc, ilike, or, and, count } from "drizzle-orm";
import { db } from "../../db";
import schema from '../../shared/schema.js';
import type { PaginationOptions, PaginationMetadata, SortOrder } from '../../shared/schema';
import { withTenant } from "./tenant-scope";

// Pagination constants
const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 100;

// Pagination utility functions
function calculateOffset(page: number, limit: number): number {
  const safePage = Math.max(1, page);
  const safeLimit = Math.min(Math.max(1, limit), MAX_PAGE_SIZE);
  return (safePage - 1) * safeLimit;
}

export function buildPaginationMetadata(page: number, limit: number, total: number): PaginationMetadata {
  const safePage = Math.max(1, page);
  const safeLimit = Math.min(Math.max(1, limit), MAX_PAGE_SIZE);
  // Convention: totalPages is normalized to 1 when total is 0 to ensure consistent
  // pagination UI behavior (always shows at least 1 page even for empty results)
  const totalPages = total === 0 ? 1 : Math.ceil(total / safeLimit);
  
  return {
    page: safePage,
    limit: safeLimit,
    total,
    totalPages,
    hasNext: safePage < totalPages,
    hasPrevious: safePage > 1
  };
}

export function applySorting(query: any, sortBy: string, sortOrder: SortOrder | string, tableColumns: any): any {
  if (!sortBy || !tableColumns[sortBy]) {
    return query;
  }
  
  const column = tableColumns[sortBy];
  return (sortOrder === 'desc') ? query.orderBy(desc(column)) : query.orderBy(asc(column));
}

export function applySearchFilter(query: any, search: string, searchableColumns: any[], existingPredicate?: any): any {
  if (!search || !searchableColumns.length) {
    return query;
  }
  
  const searchConditions = searchableColumns.map(column => 
    ilike(column, `%${search}%`)
  );
  
  const searchPredicate = or(...searchConditions);

  // Compose with existing predicate if provided - handle tenant conditions gracefully
  if (existingPredicate) {
    return query.where(and(existingPredicate, searchPredicate));
  }

  return query.where(searchPredicate);
}

// Helper function to normalize pagination options
export function normalizePaginationOptions(options: PaginationOptions): {
  page: number;
  limit: number;
  offset: number;
} {
  const page = Math.max(1, options.page || 1);
  const limit = Math.min(Math.max(1, options.limit || DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
  const offset = calculateOffset(page, limit);
  
  return { page, limit, offset };
}

/**
 * Helper function that wraps existing pagination helpers with tenant filtering
 * @param table - The Drizzle table schema
 * @param tenantId - The tenant ID to filter by
 * @param options - Pagination options
 * @returns Normalized pagination options with tenant context
 */
export function withTenantPagination(table: any, tenantId: string, options: PaginationOptions) {
  const tenantCondition = withTenant(table, tenantId);
  return {
    ...normalizePaginationOptions(options),
    tenantCondition
  };
}

// Helper function to build count query with search - enhanced for tenant conditions
export async function getCountWithSearch(
  table: any, 
  searchableColumns?: any[], 
  search?: string, 
  additionalConditions?: any
): Promise<number> {
  const countQuery = db.select({ count: count() }).from(table);
  
  const conditions: any[] = [];
  
  // Ensure tenant conditions are properly applied in count queries
  if (additionalConditions) {
    conditions.push(additionalConditions);
  }
  
  if (search && searchableColumns?.length) {
    const searchConditions = searchableColumns.map(column => ilike(column, `%${search}%`));
    conditions.push(or(...searchConditions));
  }
  
  if (conditions.length > 0) {
    countQuery.where(conditions.length === 1 ? conditions[0] : and(...conditions));
  }
  
  const result = await countQuery;
  return result[0]?.count || 0;
}