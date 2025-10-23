import { Request, Response } from "express";
import { z } from "zod";
import { TenantModel } from "./model";
import schema from '../../../shared/schema.js';

const { insertTenantSchema, tenantSettingsSchema } = schema;
import { BaseController } from "../../utils/base";
import { AuthenticatedRequest } from "../../types";
import { ForbiddenError, BadRequestError, NotFoundError } from "../../types";

export class TenantController extends BaseController {
  constructor() {
    super();
  }

  /**
   * Get current user's tenant
   */
  async getCurrent(req: AuthenticatedRequest, res: Response) {
    if (!req.user?.tenantId) {
      throw new ForbiddenError("No tenant context found");
    }

    const tenant = await TenantModel.getTenant(req.user.tenantId);
    this.ensureResourceExists(tenant, 'Tenant');
    
    // Always return 200 with full tenant payload, including isActive status
    // Let client handle inactive tenant logic
    return res.status(200).json(tenant);
  }

  /**
   * Get tenants accessible to current user
   * Only return current tenant for tenant-only system
   */
  async getAccessible(req: AuthenticatedRequest, res: Response) {
    if (!req.user?.tenantId) {
      throw new ForbiddenError("No tenant context found");
    }

    // Only return current tenant in tenant-only system
    const currentTenant = await TenantModel.getTenant(req.user.tenantId);
    if (!currentTenant) {
      return res.json([]);
    }

    return res.json([{
      id: currentTenant.id,
      name: currentTenant.name,
      slug: currentTenant.slug,
      isActive: currentTenant.isActive,
      role: req.user.role
    }]);
  }

  /**
   * Get current tenant's settings
   */
  async getSettings(req: AuthenticatedRequest, res: Response) {
    if (!req.tenantId) {
      throw new ForbiddenError("No tenant context found");
    }

    const settings = await TenantModel.getTenantSettings(req.tenantId);
    return res.json(settings || {});
  }

  /**
   * Update current tenant's settings
   */
  async updateSettings(req: AuthenticatedRequest, res: Response) {
    if (!req.tenantId) {
      throw new ForbiddenError("No tenant context found");
    }

    try {
      // Use BaseController validateZodSchema method instead of safeParse
      const validatedSettings = this.validateZodSchema(tenantSettingsSchema, req.body);

      // Sanitize validated settings to prevent creditBalance updates and strip legacy credentials
      const sanitizedSettings = JSON.parse(JSON.stringify(validatedSettings)) as any;

      // Guard against stale cashBalance overwrites
      const includeCashBalance = req.body?.__updateCashBalance === true;
      if (!includeCashBalance && 'cashBalance' in sanitizedSettings) {
        delete (sanitizedSettings as any).cashBalance;
      }

      if (sanitizedSettings.whatsapp) {
        // Ensure whatsapp is a proper object
        if (typeof sanitizedSettings.whatsapp !== 'object' || sanitizedSettings.whatsapp === null) {
          throw new BadRequestError("Invalid WhatsApp settings format");
        }
        
        // Prevent creditBalance updates
        if ('creditBalance' in sanitizedSettings.whatsapp) {
          delete sanitizedSettings.whatsapp.creditBalance;
        }
        // Strip legacy credential keys to reduce risk
        delete sanitizedSettings.whatsapp.accountSid;
        delete sanitizedSettings.whatsapp.authToken;
        delete sanitizedSettings.whatsapp.phoneNumber;
        
        // Ensure scheduler object has proper structure if it exists
        if (sanitizedSettings.whatsapp.scheduler && typeof sanitizedSettings.whatsapp.scheduler !== 'object') {
          throw new BadRequestError("Invalid WhatsApp scheduler settings format");
        }
        
        // Ensure defaultTemplates object has proper structure if it exists
        if (sanitizedSettings.whatsapp.defaultTemplates && typeof sanitizedSettings.whatsapp.defaultTemplates !== 'object') {
          throw new BadRequestError("Invalid WhatsApp template settings format");
        }
      }
      
      // Handle optimistic concurrency for cashBalance updates
      const cashBalanceKnown = req.body?.__cashBalanceKnown;
      
      const updatedTenant = await this.wrapDatabaseOperation(async () => {
        return await TenantModel.updateTenantSettings(req.tenantId!, sanitizedSettings, cashBalanceKnown);
      });
      
      this.ensureResourceExists(updatedTenant, 'Tenant');
      
      return res.json(updatedTenant!.settings || {});
    } catch (error) {
      if (error instanceof Error && error.message.includes('Cash balance has been modified')) {
        return res.status(409).json({ error: error.message });
      }
      throw error;
    }
  }

  /**
   * Get tenant by slug (public endpoint)
   */
  async getBySlug(req: Request, res: Response) {
    const slug = req.params.slug;
    
    if (!slug) {
      throw new BadRequestError("Tenant slug is required");
    }

    const tenant = await TenantModel.getTenantBySlug(slug);
    this.ensureResourceExists(tenant, 'Tenant');
    
    // Return only essential fields for public access
    return res.status(200).json({
      slug: tenant!.slug,
      name: tenant!.name,
      status: tenant!.isActive,
      id: tenant!.id
    });
  }
}