import { eq, like, or, sql, and } from "drizzle-orm";
import { db } from "../../../db";
import schema from '../../../shared/schema';
import { WhatsAppCreditModel } from '../whatsapp/credit-model.js';
import { LedgerModel } from '../ledgers/model';
import { 
  applySorting,
  applySearchFilter,
  normalizePaginationOptions,
  getCountWithSearch,
  buildPaginationMetadata
} from "../../utils/pagination";

const { tenants } = schema;
type Tenant = typeof schema.tenants.$inferSelect;
type InsertTenant = typeof schema.insertTenantSchema._input;
type PaginationOptions = typeof schema.PaginationOptions;
type PaginatedResult<T> = typeof schema.PaginatedResult<T>;

export class TenantModel {
  /**
   * Get a single tenant by ID
   */
  static async getTenant(id: string): Promise<Tenant | null> {
    const result = await db.select().from(tenants).where(eq(tenants.id, id)).limit(1);
    return result[0] || null;
  }

  /**
   * Get a tenant by slug
   */
  static async getTenantBySlug(slug: string): Promise<Tenant | null> {
    const result = await db.select().from(tenants).where(eq(tenants.slug, slug)).limit(1);
    return result[0] || null;
  }

  /**
   * Get tenant settings
   */
  static async getTenantSettings(tenantId: string): Promise<any> {
    const result = await db.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    const settings = result[0]?.settings || {};
    
    // Defense-in-depth: Strip legacy WhatsApp credentials from reads to ensure clients never receive them
    if ((settings as any).whatsapp) {
      const { accountSid, authToken, phoneNumber, ...cleanWhatsApp } = (settings as any).whatsapp;
      (settings as any).whatsapp = cleanWhatsApp;
    }
    
    return settings;
  }

  /**
   * Deep merge two objects
   */
  private static deepMerge(target: any, source: any): any {
    if (source === null || source === undefined) return target;
    if (target === null || target === undefined) return source;
    
    const result = { ...target };
    
    for (const key in source) {
      if (source.hasOwnProperty(key)) {
        if (typeof source[key] === 'object' && source[key] !== null && !Array.isArray(source[key])) {
          result[key] = this.deepMerge(target[key] || {}, source[key]);
        } else {
          result[key] = source[key];
        }
      }
    }
    
    return result;
  }

  /**
   * Update tenant settings with atomic JSON updates
   */
  static async updateTenantSettings(tenantId: string, newSettings: any, cashBalanceKnown?: string, tx?: any): Promise<Tenant | null> {
    const dbConnection = tx || db;
    
    // Get current settings first for proper deep merging
    const currentTenant = await this.getTenant(tenantId);
    const currentSettings = currentTenant?.settings || {};
    
    // Deep merge the new settings with current settings
    const mergedSettings = this.deepMerge(currentSettings, newSettings);
    
    // Clean up legacy credentials
    if (mergedSettings.whatsapp) {
      const { accountSid, authToken, phoneNumber, ...cleanWhatsApp } = mergedSettings.whatsapp;
      mergedSettings.whatsapp = cleanWhatsApp;
    }
    
    // Build where clause with optimistic concurrency check for cashBalance
    let whereClause = eq(tenants.id, tenantId);
    if (cashBalanceKnown !== undefined && 'cashBalance' in newSettings) {
      whereClause = and(
        eq(tenants.id, tenantId),
        sql`coalesce(${tenants.settings}->>'cashBalance','') = ${cashBalanceKnown}`
      )!;
    }
    
    const result = await dbConnection.update(tenants)
      .set({ settings: mergedSettings })
      .where(whereClause)
      .returning();
    
    // If optimistic concurrency check failed, throw error
    if (cashBalanceKnown !== undefined && 'cashBalance' in newSettings && result.length === 0) {
      throw new Error('Cash balance has been modified by another operation. Please refresh and try again.');
    }
    
    return result[0] || null;
  }

  /**
   * Set cash balance in tenant settings
   */
  static async setCashBalance(tx: any, tenantId: string, newBalance: string): Promise<void> {
    const dbc = tx || db;
    await dbc.update(tenants)
      .set({ 
        settings: sql`jsonb_set(coalesce(${tenants.settings}, '{}'::jsonb), '{cashBalance}', to_jsonb(${newBalance}::text), true)` 
      })
      .where(eq(tenants.id, tenantId));
  }

  /**
   * Get cash balance from tenant settings
   */
  static async getCashBalance(tenantId: string): Promise<number> {
    const settings = await this.getTenantSettings(tenantId);
    
    // If cashBalance is not set (legacy tenant), query latest cashbook entry as fallback
    if (!settings.cashBalance) {
      const ledgerModel = new LedgerModel();
      const latestEntry = await ledgerModel.getLatestCashbookEntry(tenantId);
      if (latestEntry) {
        const balance = parseFloat(latestEntry.balance || '0');
        return balance;
      }
      return 0;
    }
    
    return parseFloat(settings.cashBalance);
  }

  /**
   * Seed cash balance if missing - separate method for controlled migration
   */
  static async seedCashBalanceIfMissing(tenantId: string): Promise<boolean> {
    const settings = await this.getTenantSettings(tenantId);
    
    if (!settings.cashBalance) {
      const ledgerModel = new LedgerModel();
      const latestEntry = await ledgerModel.getLatestCashbookEntry(tenantId);
      if (latestEntry) {
        const balance = parseFloat(latestEntry.balance || '0');
        try {
          await this.setCashBalance(null, tenantId, balance.toFixed(2));
          return true;
        } catch (error) {
          console.error('Error seeding cash balance for legacy tenant:', error);
          return false;
        }
      }
    }
    
    return false;
  }



  /**
   * Get WhatsApp settings for a tenant, returning defaults when absent
   */
  static async getWhatsAppSettings(tenantId: string): Promise<any> {
    const settings = await this.getTenantSettings(tenantId);
    
    // Return defaults if WhatsApp settings don't exist
    const defaultWhatsAppSettings = {
      enabled: false,
      creditBalance: 0,
      lowCreditThreshold: 50,
      scheduler: {
        enabled: true,
        preferredSendHour: 9,
        reminderFrequency: 'daily',
        sendOnWeekends: true,
      },
      defaultTemplates: {
        paymentReminder: 'Dear {vendorName}, your payment of ₹{amount} for invoice {invoiceNumber} is due. Please clear the dues at the earliest.',
        invoiceNotification: 'Dear {vendorName}, invoice {invoiceNumber} for ₹{amount} has been generated. Please review and confirm.',
        welcomeMessage: 'Welcome! We are pleased to work with you.'
      }
    };

    const whatsappSettings = (settings as any).whatsapp || defaultWhatsAppSettings;
    
    // Additional defense: Ensure legacy credentials are never returned even if they somehow exist
    const { accountSid, authToken, phoneNumber, ...cleanWhatsAppSettings } = whatsappSettings;
    
    return cleanWhatsAppSettings;
  }

  /**
   * Update WhatsApp settings, merging into existing settings JSON
   */
  static async updateWhatsAppSettings(tenantId: string, partialSettings: any): Promise<Tenant | null> {
    const currentSettings = await this.getTenantSettings(tenantId);
    const currentWhatsAppSettings = await this.getWhatsAppSettings(tenantId);
    
    // Merge the partial settings into current WhatsApp settings
    const updatedWhatsAppSettings = {
      ...currentWhatsAppSettings,
      ...partialSettings
    };

    // Merge into the overall tenant settings
    const updatedSettings = {
      ...currentSettings,
      whatsapp: updatedWhatsAppSettings
    };

    return await this.updateTenantSettings(tenantId, updatedSettings);
  }

  /**
   * Get credit balance for a tenant
   */
  static async getCreditBalance(tenantId: string): Promise<number> {
    const creditModel = new WhatsAppCreditModel();
    return await creditModel.getCreditBalance(tenantId);
  }

  /**
   * Check if tenant has sufficient credits
   */
  static async checkCreditAvailability(tenantId: string, creditsRequired: number = 1): Promise<any> {
    const creditModel = new WhatsAppCreditModel();
    return await creditModel.checkCreditAvailability(tenantId, creditsRequired);
  }

  /**
   * Deduct WhatsApp credits for a tenant
   */
  static async deductWhatsAppCredits(tenantId: string, amount: number, referenceType: string, referenceId: string, notes?: string): Promise<any> {
    const creditModel = new WhatsAppCreditModel();
    return await creditModel.deductCredits(tenantId, amount, referenceType, referenceId, notes);
  }
}