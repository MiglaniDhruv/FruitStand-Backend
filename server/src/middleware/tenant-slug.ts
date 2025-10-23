import { Response, NextFunction } from "express";
import { TenantModel } from "../modules/tenants/model";
import { AuthenticatedRequest, NotFoundError, ForbiddenError, InternalServerError, AppError, BadRequestError } from "../types";
import { SYSTEM_ROUTES } from "../constants/routes";

// Simple in-memory cache for tenant slugs to avoid repeated DB hits
interface TenantCacheEntry {
  tenant: any;
  timestamp: number;
}

const tenantCache = new Map<string, TenantCacheEntry>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Middleware to extract and validate tenant slug from URL path
 * Supports patterns like /{slug}/login, /{slug}/api/auth/login
 * Optimized to avoid DB overhead on static assets and cached tenant lookups
 * All requests must have valid tenant context in tenant-only system
 */
export const extractTenantSlug = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const path = req.path;

    // Check if it is a frontend path or backend API path
    const isApiPath = path.startsWith("/api/");
    if (!isApiPath) {
      return next();
    }

    // Early return unless path contains /api/ or matches specific patterns like /{slug}/login
    // This avoids DB overhead on static assets and other non-tenant routes
    const shouldProcessTenant =
      path.includes("/api/") ||
      path.match(/^\/[^\/]+\/(login|dashboard|auth)/) !== null ||
      path.match(/^\/[^\/]+$/) !== null; // Root tenant path

    if (!shouldProcessTenant) {
      return next();
    }

    // Extract tenant slug from URL patterns
    // Supports: /{slug}/*, /{slug}/api/*, etc.
    const slugMatch = req.originalUrl.match(/^\/([^\/]+)/);

    if (!slugMatch || !slugMatch[1]) {
      // No slug found in URL - continue without tenant context
      return next();
    }

    const slug = slugMatch[1];

    // Skip if this looks like a system route (api, admin, etc.)
    if (SYSTEM_ROUTES.has(slug)) {
      return next();
    }

    // Set flag indicating a tenant slug was provided in the URL
    req.slugProvided = true; // Now type-safe!

    // Check cache first
    const cacheEntry = tenantCache.get(slug);
    const now = Date.now();

    if (cacheEntry && now - cacheEntry.timestamp < CACHE_TTL) {
      // Use cached tenant
      req.tenant = cacheEntry.tenant;
      req.tenantId = cacheEntry.tenant.id;
      return next();
    }

    // Validate tenant existence and status from database
    const tenant = await TenantModel.getTenantBySlug(slug);

    if (!tenant) {
      throw new NotFoundError(`Tenant '${slug}'`);
    }

    if (!tenant.isActive) {
      throw new ForbiddenError("This organization's access has been suspended");
    }

    // Cache the tenant for future requests
    tenantCache.set(slug, { tenant, timestamp: now });

    // Clean up expired cache entries periodically
    if (tenantCache.size > 100) {
      // Prevent unlimited growth
      const keysToDelete: string[] = [];
      tenantCache.forEach((entry, key) => {
        if (now - entry.timestamp >= CACHE_TTL) {
          keysToDelete.push(key);
        }
      });
      keysToDelete.forEach((key) => tenantCache.delete(key));
    }

    // Attach tenant context to request
    req.tenant = tenant;
    req.tenantId = tenant.id;

    next();
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new InternalServerError('Failed to validate tenant context');
  }
};

/**
 * Middleware to require tenant context (for tenant-specific routes)
 */
export const requireTenantContext = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void => {
  if (!req.tenant) {
    throw new BadRequestError('This endpoint requires a valid tenant slug in the URL');
  }

  next();
};