import { eq, desc, asc, and, or, ilike, count, inArray, sum } from 'drizzle-orm';
import { db } from '../../../db';
import schema from '../../../shared/schema.js';

const { 
  retailers, 
  salesInvoices,
  salesInvoiceItems,
  salesPayments,
  crateTransactions,
  stockMovements,
  whatsappMessages
} = schema;

type Retailer = typeof schema.retailers.$inferSelect;
type InsertRetailer = typeof schema.insertRetailerSchema._input;
type PaginationOptions = typeof schema.PaginationOptions;
type PaginatedResult<T> = typeof schema.PaginatedResult<T>;
import { normalizePaginationOptions, buildPaginationMetadata, withTenantPagination } from '../../utils/pagination';
import { withTenant, ensureTenantInsert } from '../../utils/tenant-scope';
import { ValidationError, AppError, NotFoundError } from '../../types';
import { handleDatabaseError } from '../../utils/database-errors';

export class RetailerModel {
  async getRetailers(tenantId: string): Promise<Retailer[]> {
    return await db.select().from(retailers)
      .where(withTenant(retailers, tenantId, eq(retailers.isActive, true)))
      .orderBy(asc(retailers.name));
  }

  async getRetailer(tenantId: string, id: string): Promise<Retailer | undefined> {
    const [retailer] = await db.select().from(retailers)
      .where(withTenant(retailers, tenantId, eq(retailers.id, id)));
    return retailer || undefined;
  }

  async createRetailer(tenantId: string, insertRetailer: InsertRetailer): Promise<Retailer> {
    // Add business logic validation
    if (!insertRetailer.name || insertRetailer.name.trim().length === 0) {
      throw new ValidationError('Retailer name is required', {
        name: 'Name cannot be empty'
      });
    }

    if (insertRetailer.phone && insertRetailer.phone.trim().length < 10) {
      throw new ValidationError('Invalid phone number', {
        phone: 'Phone number must be at least 10 characters'
      });
    }

    try {
      const retailerWithTenant = ensureTenantInsert(insertRetailer, tenantId);
      const [retailer] = await db.insert(retailers).values(retailerWithTenant).returning();
      return retailer;
    } catch (error) {
      if (error instanceof AppError) throw error;
      handleDatabaseError(error);
    }
  }

  async updateRetailer(tenantId: string, id: string, insertRetailer: Partial<InsertRetailer>): Promise<Retailer | undefined> {
    // Add business logic validation
    if (insertRetailer.name !== undefined && (!insertRetailer.name || insertRetailer.name.trim().length === 0)) {
      throw new ValidationError('Retailer name is required', {
        name: 'Name cannot be empty'
      });
    }

    if (insertRetailer.phone !== undefined && insertRetailer.phone && insertRetailer.phone.trim().length < 10) {
      throw new ValidationError('Invalid phone number', {
        phone: 'Phone number must be at least 10 characters'
      });
    }

    // Filter out undefined values to preserve existing data
    const updateData = Object.fromEntries(
      Object.entries(insertRetailer).filter(([_, value]) => value !== undefined)
    ) as Partial<InsertRetailer>;

    try {
      const [retailer] = await db
        .update(retailers)
        .set(updateData)
        .where(withTenant(retailers, tenantId, eq(retailers.id, id)))
        .returning();
      return retailer || undefined;
    } catch (error) {
      if (error instanceof AppError) throw error;
      handleDatabaseError(error);
    }
  }

  async deleteRetailer(tenantId: string, id: string): Promise<boolean> {
    try {
      return await db.transaction(async (tx) => {
      // a. Delete whatsappMessages where recipientType='retailer' and recipientId=id
      await tx.delete(whatsappMessages)
        .where(and(
          withTenant(whatsappMessages, tenantId),
          eq(whatsappMessages.recipientType, 'retailer'),
          eq(whatsappMessages.recipientId, id)
        ));

      // b. Delete salesPayments where retailerId=id
      await tx.delete(salesPayments)
        .where(and(
          withTenant(salesPayments, tenantId),
          eq(salesPayments.retailerId, id)
        ));

      // c. Delete salesInvoiceItems - first get all salesInvoices IDs for this retailer
      const retailerInvoices = await tx.select({ id: salesInvoices.id })
        .from(salesInvoices)
        .where(and(
          withTenant(salesInvoices, tenantId),
          eq(salesInvoices.retailerId, id)
        ));

      const invoiceIds = retailerInvoices.map(invoice => invoice.id);
      
      if (invoiceIds.length > 0) {
        await tx.delete(salesInvoiceItems)
          .where(and(
            withTenant(salesInvoiceItems, tenantId),
            inArray(salesInvoiceItems.invoiceId, invoiceIds)
          ));
      }

      // d. Delete crateTransactions where retailerId=id
      await tx.delete(crateTransactions)
        .where(and(
          withTenant(crateTransactions, tenantId),
          eq(crateTransactions.retailerId, id)
        ));

      // e. Delete stockMovements where retailerId=id (retailerId is nullable)
      await tx.delete(stockMovements)
        .where(and(
          withTenant(stockMovements, tenantId),
          eq(stockMovements.retailerId, id)
        ));

      // f. Delete salesInvoices where retailerId=id
      await tx.delete(salesInvoices)
        .where(and(
          withTenant(salesInvoices, tenantId),
          eq(salesInvoices.retailerId, id)
        ));

      // g. Finally delete the retailer record itself
      const [deletedRetailer] = await tx.delete(retailers)
        .where(and(
          withTenant(retailers, tenantId),
          eq(retailers.id, id)
        ))
        .returning();

      return !!deletedRetailer;
    });
    } catch (error) {
      if (error instanceof AppError) throw error;
      handleDatabaseError(error);
    }
  }

  async getRetailersPaginated(tenantId: string, options?: PaginationOptions & {
    search?: string;
    status?: string;
  }): Promise<PaginatedResult<Retailer>> {
    const { page, limit, offset, tenantCondition } = withTenantPagination(retailers, tenantId, options || {});
    
    // Build WHERE conditions array starting with tenant filtering
    const whereConditions = [tenantCondition];
    
    // Filter by active retailers by default unless status is specified
    if (options?.status !== 'all') {
      whereConditions.push(eq(retailers.isActive, true));
    }
    
    // Handle search across name and phone fields
    if (options?.search) {
      const searchConditions = [
        ilike(retailers.name, `%${options.search}%`),
        ilike(retailers.phone, `%${options.search}%`)
      ];
      whereConditions.push(or(...searchConditions)!);
    }
    
    // Combine all conditions including tenant filtering
    const finalWhereCondition = and(...whereConditions)!;
    
    // Apply sorting
    const sortBy = options?.sortBy || 'createdAt';
    const sortOrder = options?.sortOrder || 'desc';
    
    // Build sorting order
    let orderByClause;
    if (sortBy === 'name') {
      orderByClause = sortOrder === 'asc' ? asc(retailers.name) : desc(retailers.name);
    } else if (sortBy === 'phone') {
      orderByClause = sortOrder === 'asc' ? asc(retailers.phone) : desc(retailers.phone);
    } else { // default to createdAt
      orderByClause = sortOrder === 'asc' ? asc(retailers.createdAt) : desc(retailers.createdAt);
    }
    
    // Build and execute paginated query with tenant filtering
    const retailersData = await db.select()
      .from(retailers)
      .where(finalWhereCondition)
      .orderBy(orderByClause)
      .limit(limit)
      .offset(offset);
    
    // Get total count with same conditions including tenant filtering
    const [{ count: total }] = await db.select({ count: count() })
      .from(retailers)
      .where(finalWhereCondition);
    
    const pagination = buildPaginationMetadata(page, limit, total);
    
    return { data: retailersData, pagination };
  }

  async getRetailerStats(tenantId: string): Promise<{ totalRetailers: number; totalUdhaar: string; totalShortfall: string; totalCrates: number }> {
    const [result] = await db.select({
      totalRetailers: count(),
      totalUdhaar: sum(retailers.udhaaarBalance),
      totalShortfall: sum(retailers.shortfallBalance),
      totalCrates: sum(retailers.crateBalance)
    })
    .from(retailers)
    .where(withTenant(retailers, tenantId, eq(retailers.isActive, true)));

    return {
      totalRetailers: result.totalRetailers,
      totalUdhaar: result.totalUdhaar || '0.00',
      totalShortfall: result.totalShortfall || '0.00',
      totalCrates: Number(result.totalCrates) || 0
    };
  }

  async toggleFavourite(tenantId: string, id: string) {
    try {
      // First, fetch the current retailer to get current isFavourite status
      const currentRetailer = await this.getRetailer(tenantId, id);
      if (!currentRetailer) {
        throw new NotFoundError('Retailer not found');
      }

      // Validate that the retailer is active before allowing favourite toggle
      if (!currentRetailer.isActive) {
        throw new ValidationError('Cannot mark inactive retailer as favourite', { 
          retailerId: 'Retailer must be active to be marked as favourite' 
        });
      }

      // Calculate new favourite status
      const newStatus = !currentRetailer.isFavourite;

      // Update the retailer
      const [updatedRetailer] = await db
        .update(retailers)
        .set({ isFavourite: newStatus })
        .where(withTenant(retailers, tenantId, eq(retailers.id, id)))
        .returning();

      return updatedRetailer;
    } catch (error) {
      handleDatabaseError(error);
    }
  }
}