import { eq, and, sql } from 'drizzle-orm';
import { db } from '../../../db.js';
import crypto from 'crypto';
import schema from '../../../shared/schema.js';
import { withTenant, ensureTenantInsert } from '../../utils/tenant-scope.js';

const {
  invoiceShareLinks,
  purchaseInvoices,
  salesInvoices,
  vendors,
  retailers,
  invoiceItems,
  salesInvoiceItems,
  payments,
  salesPayments,
  tenants,
  items
} = schema;

type InvoiceShareLink = typeof schema.invoiceShareLinks.$inferSelect;
type InsertInvoiceShareLink = typeof schema.insertInvoiceShareLinkSchema._input;
type PublicInvoiceData = typeof schema.PublicInvoiceData;

export class InvoiceShareLinkModel {
  /**
   * Generate a cryptographically secure token for share links
   */
  private static generateSecureToken(): string {
    return crypto.randomBytes(32).toString('base64url');
  }

  /**
   * Create or get an existing share link for an invoice
   */
  async createOrGetShareLink(
    tenantId: string,
    invoiceId: string,
    invoiceType: 'purchase' | 'sales'
  ): Promise<InvoiceShareLink> {
    try {
      // Check if a share link already exists for this invoice
      const existingLinks = await db
        .select()
        .from(invoiceShareLinks)
        .where(
          and(
            eq(invoiceShareLinks.tenantId, tenantId),
            eq(invoiceShareLinks.invoiceId, invoiceId),
            eq(invoiceShareLinks.invoiceType, invoiceType)
          )
        )
        .limit(1);

      if (existingLinks.length > 0) {
        return existingLinks[0];
      }

      // Generate a new token and create the share link
      const token = InvoiceShareLinkModel.generateSecureToken();
      const insertData = ensureTenantInsert(
        {
          token,
          invoiceId,
          invoiceType,
        },
        tenantId
      );

      const newLinks = await db
        .insert(invoiceShareLinks)
        .values(insertData)
        .returning();

      return newLinks[0];
    } catch (error) {
      console.error('Error creating share link:', error);
      throw new Error('Failed to create share link');
    }
  }

  /**
   * Get share link by token and update access tracking
   */
  async getShareLinkByToken(token: string): Promise<InvoiceShareLink | null> {
    try {
      const shareLinks = await db
        .select()
        .from(invoiceShareLinks)
        .where(eq(invoiceShareLinks.token, token))
        .limit(1);

      if (shareLinks.length === 0) {
        return null;
      }

      const shareLink = shareLinks[0];

      // Update access count and last accessed timestamp
      await db
        .update(invoiceShareLinks)
        .set({
          accessCount: sql`${invoiceShareLinks.accessCount} + 1`,
          lastAccessedAt: new Date(),
        })
        .where(eq(invoiceShareLinks.id, shareLink.id));

      return shareLink;
    } catch (error) {
      console.error('Error getting share link by token:', error);
      throw new Error('Failed to retrieve share link');
    }
  }

  /**
   * Get complete public invoice data by share token
   */
  async getPublicInvoiceData(token: string): Promise<PublicInvoiceData | null> {
    try {
      // Get the share link
      const shareLink = await this.getShareLinkByToken(token);
      if (!shareLink) {
        return null;
      }

      const { tenantId, invoiceId, invoiceType } = shareLink;

      // Fetch tenant data
      const tenantResults = await db
        .select()
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .limit(1);

      if (tenantResults.length === 0 || !tenantResults[0].isActive) {
        return null;
      }

      const tenant = tenantResults[0];

      if (invoiceType === 'purchase') {
        // Fetch purchase invoice with vendor and items
        const invoiceResults = await db
          .select()
          .from(purchaseInvoices)
          .where(
            withTenant(
              purchaseInvoices,
              tenantId,
              eq(purchaseInvoices.id, invoiceId)
            )
          )
          .limit(1);

        if (invoiceResults.length === 0) {
          return null;
        }

        const invoice = invoiceResults[0];

        // Fetch vendor
        const vendorResults = await db
          .select()
          .from(vendors)
          .where(
            withTenant(
              vendors,
              tenantId,
              eq(vendors.id, invoice.vendorId)
            )
          )
          .limit(1);

        // Fetch items with item details
        const itemsWithDetails = await db
          .select({
            invoiceItem: invoiceItems,
            item: items
          })
          .from(invoiceItems)
          .innerJoin(items, eq(invoiceItems.itemId, items.id))
          .where(
            withTenant(
              invoiceItems,
              tenantId,
              eq(invoiceItems.invoiceId, invoiceId)
            )
          );

        // Map the results to include item details in the invoice item objects
        const itemsData = itemsWithDetails.map(({ invoiceItem, item }) => ({
          ...invoiceItem,
          item: `${item.name} - ${item.quality}`, // Format as "Name - Quality"
          itemName: item.name,
          itemQuality: item.quality,
          itemUnit: item.unit
        }));

        // Fetch payments
        const paymentsData = await db
          .select()
          .from(payments)
          .where(
            withTenant(
              payments,
              tenantId,
              eq(payments.invoiceId, invoiceId)
            )
          );

        return {
          invoice,
          items: itemsData,
          payments: paymentsData,
          vendor: vendorResults[0] || undefined,
          tenant: {
            name: tenant.name,
            slug: tenant.slug,
            settings: tenant.settings,
          },
          invoiceType: 'purchase',
        };
      } else {
        // Fetch sales invoice with retailer and items
        const invoiceResults = await db
          .select()
          .from(salesInvoices)
          .where(
            withTenant(
              salesInvoices,
              tenantId,
              eq(salesInvoices.id, invoiceId)
            )
          )
          .limit(1);

        if (invoiceResults.length === 0) {
          return null;
        }

        const invoice = invoiceResults[0];

        // Fetch retailer
        const retailerResults = await db
          .select()
          .from(retailers)
          .where(
            withTenant(
              retailers,
              tenantId,
              eq(retailers.id, invoice.retailerId)
            )
          )
          .limit(1);

        // Fetch items with item details
        const itemsWithDetails = await db
          .select({
            invoiceItem: salesInvoiceItems,
            item: items
          })
          .from(salesInvoiceItems)
          .innerJoin(items, eq(salesInvoiceItems.itemId, items.id))
          .where(
            withTenant(
              salesInvoiceItems,
              tenantId,
              eq(salesInvoiceItems.invoiceId, invoiceId)
            )
          );

        // Map the results to include item details in the invoice item objects
        const itemsData = itemsWithDetails.map(({ invoiceItem, item }) => ({
          ...invoiceItem,
          item: `${item.name} - ${item.quality}`, // Format as "Name - Quality"
          itemName: item.name,
          itemQuality: item.quality,
          itemUnit: item.unit
        }));

        // Fetch sales payments
        const paymentsData = await db
          .select()
          .from(salesPayments)
          .where(
            withTenant(
              salesPayments,
              tenantId,
              eq(salesPayments.invoiceId, invoiceId)
            )
          );

        return {
          invoice,
          items: itemsData,
          payments: paymentsData,
          retailer: retailerResults[0] || undefined,
          tenant: {
            name: tenant.name,
            slug: tenant.slug,
            settings: tenant.settings,
          },
          invoiceType: 'sales',
        };
      }
    } catch (error) {
      console.error('Error getting public invoice data:', error);
      throw new Error('Failed to retrieve public invoice data');
    }
  }
}