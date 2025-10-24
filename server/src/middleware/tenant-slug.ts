import { Request, Response, NextFunction } from "express";
import { TenantModel } from "../modules/tenants/model";
import {
  NotFoundError,
  ForbiddenError,
  InternalServerError,
  AppError,
  BadRequestError
} from "../types";
import { SYSTEM_ROUTES } from "../constants/routes";

// Simple in-memory cache for tenant slugs
interface TenantCacheEntry {
  tenant: any;
  timestamp: number;
}

const tenantCache = new Map<string, TenantCacheEntry>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export const extractTenantSlug = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const path = req.path;
    const originalUrl = req.originalUrl;

    const isApiPath = path.startsWith("/api/");
    if (!isApiPath) return next();

    const shouldProcessTenant =
      path.includes("/api/") ||
      path.match(/^\/[^\/]+\/(login|dashboard|auth)/) !== null ||
      path.match(/^\/[^\/]+$/) !== null;

    if (!shouldProcessTenant) return next();

    const slugMatch = originalUrl.match(/^\/([^\/]+)/);
    if (!slugMatch || !slugMatch[1]) return next();

    const slug = slugMatch[1];

    if (SYSTEM_ROUTES.has(slug)) return next();

    req.slugProvided = true;

    const cacheEntry = tenantCache.get(slug);
    const now = Date.now();

    if (cacheEntry && now - cacheEntry.timestamp < CACHE_TTL) {
      req.tenant = cacheEntry.tenant;
      req.tenantId = cacheEntry.tenant.id;
      return next();
    }

    const tenant = await TenantModel.getTenantBySlug(slug);
    if (!tenant) throw new NotFoundError(`Tenant '${slug}'`);
    if (!tenant.isActive) throw new ForbiddenError("This organization's access has been suspended");

    tenantCache.set(slug, { tenant, timestamp: now });

    // Cleanup expired entries
    if (tenantCache.size > 100) {
      const keysToDelete: string[] = [];
      tenantCache.forEach((entry, key) => {
        if (now - entry.timestamp >= CACHE_TTL) keysToDelete.push(key);
      });
      keysToDelete.forEach((key) => tenantCache.delete(key));
    }

    req.tenant = tenant;
    req.tenantId = tenant.id;

    next();
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new InternalServerError("Failed to validate tenant context");
  }
};

export const requireTenantContext = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  if (!req.tenant) {
    throw new BadRequestError("This endpoint requires a valid tenant slug in the URL");
  }
  next();
};
