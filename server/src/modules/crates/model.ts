import { eq, desc, asc, and, or, gte, lte, ilike, inArray, count, sql } from 'drizzle-orm';
import { db } from '../../../db';
import schema from '../../../shared/schema.js';
import { z } from 'zod';

const { crateTransactions, retailers, vendors, CRATE_TRANSACTION_TYPES } = schema;

type CrateTransaction = typeof schema.crateTransactions.$inferSelect;
type InsertCrateTransaction = typeof schema.insertCrateTransactionSchema._input;
type CrateTransactionWithParty = CrateTransaction & {
  retailer: typeof schema.retailers.$inferSelect | null;
  vendor: typeof schema.vendors.$inferSelect | null;
};
type PaginationOptions = typeof schema.PaginationOptions;

export function PaginatedResult<T extends z.ZodTypeAny>(dataSchema: T) {
  return z.object({
    data: z.array(dataSchema),
    pagination: z.object({
      page: z.number(),
      limit: z.number(),
      total: z.number(),
      totalPages: z.number(),
      hasNext: z.boolean(),
      hasPrevious: z.boolean(),
    }),
  });
}

// ✅ Create a type alias for TypeScript usage
type PaginatedResultType<T extends z.ZodTypeAny> = z.infer<ReturnType<typeof PaginatedResult<T>>>;

import { normalizePaginationOptions, buildPaginationMetadata } from '../../utils/pagination';
import { withTenant, ensureTenantInsert } from '../../utils/tenant-scope';

export class CrateModel {
  async getCrateTransactions(tenantId: string): Promise<CrateTransactionWithParty[]> {
    const transactions = await db.select().from(crateTransactions)
      .where(withTenant(crateTransactions, tenantId))
      .orderBy(desc(crateTransactions.createdAt));

    if (transactions.length === 0) {
      return [];
    }

    // Batch fetch retailers and vendors for all transactions with tenant filtering
    const retailerIds = transactions.filter(tx => tx.retailerId).map(tx => tx.retailerId!);
    const vendorIds = transactions.filter(tx => tx.vendorId).map(tx => tx.vendorId!);
    
    const retailersData = retailerIds.length > 0 
      ? await db.select().from(retailers)
          .where(withTenant(retailers, tenantId, inArray(retailers.id, retailerIds)))
      : [];
    
    const vendorsData = vendorIds.length > 0
      ? await db.select().from(vendors)
          .where(withTenant(vendors, tenantId, inArray(vendors.id, vendorIds)))
      : [];
    
    // Create lookup maps
    const retailerMap = new Map(retailersData.map(r => [r.id, r]));
    const vendorMap = new Map(vendorsData.map(v => [v.id, v]));
    
    // Assemble final data with party relationships
    return transactions.map(transaction => ({
      ...transaction,
      retailer: transaction.retailerId ? retailerMap.get(transaction.retailerId) || null : null,
      vendor: transaction.vendorId ? vendorMap.get(transaction.vendorId) || null : null
    })) as CrateTransactionWithParty[];
  }

  async getCrateTransactionsPaginated(
    tenantId: string,
    options?: PaginationOptions & {
      search?: string;
      type?: 'given' | 'received' | 'returned';
      partyType?: 'retailer' | 'vendor';
      retailerId?: string;
      vendorId?: string;
      dateFrom?: string;
      dateTo?: string;
    }
  ): Promise<PaginatedResultType<z.ZodTypeAny>> { // ✅ fixed type
    const { page, limit, offset } = normalizePaginationOptions(options || {});
    
    // Build WHERE conditions array with tenant filtering
    const whereConditions = [withTenant(crateTransactions, tenantId)];
    
    // Apply party type filter
    if (options?.partyType) {
      whereConditions.push(eq(crateTransactions.partyType, options.partyType));
    }
    
    // Apply transaction type filter
    if (options?.type) {
      let transactionType;
      if (options.type === 'given') transactionType = CRATE_TRANSACTION_TYPES.GIVEN;
      else if (options.type === 'received') transactionType = CRATE_TRANSACTION_TYPES.RECEIVED;
      else transactionType = CRATE_TRANSACTION_TYPES.RETURNED;
      whereConditions.push(eq(crateTransactions.transactionType, transactionType));
    }
    
    if (options?.retailerId) whereConditions.push(eq(crateTransactions.retailerId, options.retailerId));
    if (options?.vendorId) whereConditions.push(eq(crateTransactions.vendorId, options.vendorId));
    if (options?.dateFrom) whereConditions.push(gte(crateTransactions.transactionDate, new Date(options.dateFrom)));
    if (options?.dateTo) whereConditions.push(lte(crateTransactions.transactionDate, new Date(options.dateTo)));
    
    if (options?.search) {
      const matchingRetailers = await db.select({ id: retailers.id })
        .from(retailers)
        .where(withTenant(retailers, tenantId, ilike(retailers.name, `%${options.search}%`)));
      const retailerIds = matchingRetailers.map(r => r.id);
      
      const matchingVendors = await db.select({ id: vendors.id })
        .from(vendors)
        .where(withTenant(vendors, tenantId, ilike(vendors.name, `%${options.search}%`)));
      const vendorIds = matchingVendors.map(v => v.id);
      
      const searchConditions = [
        ilike(crateTransactions.transactionType, `%${options.search}%`),
        ilike(crateTransactions.notes, `%${options.search}%`),
      ];
      
      if (retailerIds.length > 0) searchConditions.push(inArray(crateTransactions.retailerId, retailerIds));
      if (vendorIds.length > 0) searchConditions.push(inArray(crateTransactions.vendorId, vendorIds));
      
      whereConditions.push(or(...searchConditions)!);
    }
    
    const finalWhereCondition = whereConditions.length > 0 ? and(...whereConditions) : undefined;
    
    const sortBy = options?.sortBy || 'createdAt';
    const sortOrder = options?.sortOrder || 'desc';
    
    let orderByClause;
    if (sortBy === 'transactionDate') orderByClause = sortOrder === 'asc' ? asc(crateTransactions.transactionDate) : desc(crateTransactions.transactionDate);
    else if (sortBy === 'transactionType') orderByClause = sortOrder === 'asc' ? asc(crateTransactions.transactionType) : desc(crateTransactions.transactionType);
    else if (sortBy === 'quantity') orderByClause = sortOrder === 'asc' ? asc(crateTransactions.quantity) : desc(crateTransactions.quantity);
    else if (sortBy === 'partyName') orderByClause = sortOrder === 'asc' ? asc(retailers.name) : desc(retailers.name);
    else orderByClause = sortOrder === 'asc' ? asc(crateTransactions.createdAt) : desc(crateTransactions.createdAt);
    
    const transactionsData = await db.select({
        transaction: crateTransactions,
        retailer: retailers,
        vendor: vendors
      })
      .from(crateTransactions)
      .leftJoin(retailers, eq(crateTransactions.retailerId, retailers.id))
      .leftJoin(vendors, eq(crateTransactions.vendorId, vendors.id))
      .where(finalWhereCondition)
      .orderBy(orderByClause)
      .limit(limit)
      .offset(offset);
    
    const data = transactionsData.map(({ transaction, retailer, vendor }) => ({
      ...transaction,
      retailer: retailer || null,
      vendor: vendor || null
    })) as CrateTransactionWithParty[];
    
    const [{ count: total }] = await db.select({ count: count() })
      .from(crateTransactions)
      .leftJoin(retailers, eq(crateTransactions.retailerId, retailers.id))
      .leftJoin(vendors, eq(crateTransactions.vendorId, vendors.id))
      .where(finalWhereCondition);
    
    const pagination = buildPaginationMetadata(page, limit, total);
    
    return { data, pagination };
  }


  async getCrateTransactionsByRetailer(tenantId: string, retailerId: string): Promise<CrateTransactionWithParty[]> {
    const transactions = await db.select().from(crateTransactions)
      .where(withTenant(crateTransactions, tenantId, eq(crateTransactions.retailerId, retailerId)))
      .orderBy(desc(crateTransactions.createdAt));

    if (transactions.length === 0) {
      return [];
    }

    // Get the retailer with tenant filtering
    const [retailer] = await db.select().from(retailers)
      .where(withTenant(retailers, tenantId, eq(retailers.id, retailerId)));
    
    if (!retailer) {
      return [];
    }
    
    // Assemble final data with retailer relationship
    const result = transactions.map(transaction => ({
      ...transaction,
      retailer,
      vendor: null
    }));

    return result;
  }

  async getCrateTransactionsByVendor(tenantId: string, vendorId: string): Promise<CrateTransactionWithParty[]> {
    const transactions = await db.select().from(crateTransactions)
      .where(withTenant(crateTransactions, tenantId, eq(crateTransactions.vendorId, vendorId)))
      .orderBy(desc(crateTransactions.createdAt));

    if (transactions.length === 0) {
      return [];
    }

    // Get the vendor with tenant filtering
    const [vendor] = await db.select().from(vendors)
      .where(withTenant(vendors, tenantId, eq(vendors.id, vendorId)));
    
    if (!vendor) {
      return [];
    }
    
    // Assemble final data with vendor relationship
    const result = transactions.map(transaction => ({
      ...transaction,
      retailer: null,
      vendor
    }));

    return result;
  }

  async createCrateTransaction(tenantId: string, transactionData: InsertCrateTransaction, externalTx?: any): Promise<CrateTransactionWithParty> {
    const executeTransaction = async (tx: any) => {
      const transactionWithTenant = ensureTenantInsert(transactionData, tenantId);
      const [transaction] = await tx.insert(crateTransactions).values(transactionWithTenant).returning();
      
      let retailer = null;
      let vendor = null;
      
      // Handle retailer transactions
      if (transaction.partyType === 'retailer' && transaction.retailerId) {
        // Update retailer crate balance atomically
        // 'Given' increases balance (we give crates to retailer)
        // 'Returned' decreases balance (retailer returns crates to us)
        const balanceChange = transaction.transactionType === CRATE_TRANSACTION_TYPES.GIVEN 
          ? transaction.quantity 
          : -transaction.quantity;
        
        await tx.update(retailers)
          .set({ 
            crateBalance: sql`COALESCE(${retailers.crateBalance}, 0) + ${balanceChange}`
          })
          .where(withTenant(retailers, tenantId, eq(retailers.id, transaction.retailerId)));
        
        // Get the retailer with tenant filtering for return value
        const [fetchedRetailer] = await tx.select().from(retailers)
          .where(withTenant(retailers, tenantId, eq(retailers.id, transaction.retailerId)));
        
        if (!fetchedRetailer) {
          throw new Error('Retailer not found');
        }
        
        retailer = fetchedRetailer;
      }
      
      // Handle vendor transactions
      if (transaction.partyType === 'vendor' && transaction.vendorId) {
        // Update vendor crate balance atomically
        // 'Received' increases balance (we receive crates from vendor)
        // 'Returned' decreases balance (we return crates to vendor)
        const balanceChange = transaction.transactionType === CRATE_TRANSACTION_TYPES.RECEIVED 
          ? transaction.quantity 
          : -transaction.quantity;
        
        await tx.update(vendors)
          .set({ 
            crateBalance: sql`COALESCE(${vendors.crateBalance}, 0) + ${balanceChange}`
          })
          .where(withTenant(vendors, tenantId, eq(vendors.id, transaction.vendorId)));
        
        // Get the vendor with tenant filtering for return value
        const [fetchedVendor] = await tx.select().from(vendors)
          .where(withTenant(vendors, tenantId, eq(vendors.id, transaction.vendorId)));
        
        if (!fetchedVendor) {
          throw new Error('Vendor not found');
        }
        
        vendor = fetchedVendor;
      }
      
      return {
        ...transaction,
        retailer,
        vendor
      };
    };

    if (externalTx) {
      return executeTransaction(externalTx);
    } else {
      return await db.transaction(executeTransaction);
    }
  }
}