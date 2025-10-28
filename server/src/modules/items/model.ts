import { eq, asc, and, or, gt, count } from "drizzle-orm";
import schema from '../../../shared/schema.js';

const { 
  items,
  vendors,
  stock
} = schema;

type Item = typeof schema.items.$inferSelect;
type InsertItem = typeof schema.insertItemSchema._input;
type ItemWithVendor = typeof schema.ItemWithVendor;
type PaginationOptions = typeof schema.PaginationOptions;
type PaginatedResult<T> = typeof schema.PaginatedResult<T>;
import { db } from "../../../db";
import {
  normalizePaginationOptions,
  applySorting,
  applySearchFilter,
  getCountWithSearch,
  buildPaginationMetadata,
  withTenantPagination
} from "../../utils/pagination";
import { withTenant, ensureTenantInsert } from "../../utils/tenant-scope";
import { ValidationError, ConflictError, AppError } from "../../types";
import { handleDatabaseError } from "../../utils/database-errors";

export class ItemModel {
  async getItems(tenantId: string, isActive?: string): Promise<ItemWithVendor[]> {
    // Build conditions array starting with tenant filtering
    const conditions = [];
    
    // Add isActive filter conditionally
    if (isActive === 'true') {
      conditions.push(eq(items.isActive, true));
    } else if (isActive === 'false') {
      conditions.push(eq(items.isActive, false));
    }
    // If isActive is undefined, don't add any isActive filter (show all items)
    
    const whereCondition = conditions.length > 0 
      ? withTenant(items, tenantId, and(...conditions))
      : withTenant(items, tenantId);
    
    const results = await db.select({ item: items, vendor: vendors }).from(items)
      .leftJoin(vendors, and(eq(items.vendorId, vendors.id), eq(vendors.tenantId, tenantId)))
      .where(whereCondition)
      .orderBy(asc(items.name));
    
    return results.map(record => ({
      ...record.item,
      vendor: record.vendor
    }));
  }

  async getItemsByVendor(tenantId: string, vendorId: string, isActive?: string): Promise<Item[]> {
    // Build conditions array starting with vendor filtering
    const conditions = [eq(items.vendorId, vendorId)];
    
    // Add isActive filter conditionally
    if (isActive === 'true') {
      conditions.push(eq(items.isActive, true));
    } else if (isActive === 'false') {
      conditions.push(eq(items.isActive, false));
    }
    // If isActive is undefined, don't add any isActive filter (show all items)
    
    return await db.select().from(items)
      .where(withTenant(items, tenantId, and(...conditions)))
      .orderBy(asc(items.name));
  }

  async getItem(tenantId: string, id: string): Promise<Item | undefined> {
    const [item] = await db.select().from(items)
      .where(withTenant(items, tenantId, eq(items.id, id)));
    return item || undefined;
  }

  async createItem(tenantId: string, insertItem: InsertItem): Promise<Item> {
    // Add business logic validation
    if (!insertItem.name || insertItem.name.trim().length === 0) {
      throw new ValidationError('Item name is required', {
        name: 'Name cannot be empty'
      });
    }

    if (!insertItem.vendorId) {
      throw new ValidationError('Vendor is required', {
        vendorId: 'Vendor must be selected'
      });
    }

    // Note: Unit validation is handled by Zod schema (allows: KG, GRAM, LITRE, PIECE, BOX, CRATE - uppercased)
    // The schema automatically transforms units to uppercase before reaching this point

    try {
      return await db.transaction(async (tx) => {
        const itemWithTenant = ensureTenantInsert(insertItem, tenantId);
        // Type assertion: Zod schema ensures all required fields are present and transformed
        const [item] = await tx.insert(items).values(itemWithTenant as typeof items.$inferInsert).returning();
        const stockWithTenant = ensureTenantInsert({ itemId: item.id }, tenantId);
        await tx.insert(stock).values(stockWithTenant);
        return item;
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      handleDatabaseError(error);
    }
  }

  async updateItem(tenantId: string, id: string, insertItem: Partial<InsertItem>): Promise<Item | undefined> {
    // Add business logic validation
    if (insertItem.name !== undefined && (!insertItem.name || insertItem.name.trim().length === 0)) {
      throw new ValidationError('Item name is required', {
        name: 'Name cannot be empty'
      });
    }

    // Note: Unit validation is handled by Zod schema (allows: KG, GRAM, LITRE, PIECE, BOX, CRATE - uppercased)
    // The schema automatically transforms units to uppercase before reaching this point

    try {
      const [item] = await db
        .update(items)
        // Type assertion: Zod schema ensures all fields are properly typed and transformed
        .set(insertItem as Partial<typeof items.$inferInsert>)
        .where(withTenant(items, tenantId, eq(items.id, id)))
        .returning();
      return item || undefined;
    } catch (error) {
      if (error instanceof AppError) throw error;
      handleDatabaseError(error);
    }
  }

  async deleteItem(tenantId: string, id: string): Promise<{ success: boolean; error?: string }> {
    try {
      return await db.transaction(async (tx) => {
        // Check if item has any stock quantities > 0 inside transaction with tenant filtering
        const stockEntries = await tx.select().from(stock)
          .where(withTenant(stock, tenantId, eq(stock.itemId, id)));
        
        for (const stockEntry of stockEntries) {
          const hasStock = 
            parseFloat(stockEntry.quantityInCrates || "0") > 0 ||
            parseFloat(stockEntry.quantityInBoxes || "0") > 0 ||
            parseFloat(stockEntry.quantityInKgs || "0") > 0;
          
          if (hasStock) {
            throw new ConflictError('Cannot delete item with existing stock quantities. Please clear stock first.');
          }
        }
        
        // Proceed with soft deletion if no stock exists with tenant filtering
        const [item] = await tx
          .update(items)
          .set({ isActive: false })
          .where(withTenant(items, tenantId, eq(items.id, id)))
          .returning();
        
        return { success: !!item };
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      handleDatabaseError(error);
    }
  }

  async getItemsPaginated(tenantId: string, options: PaginationOptions & { isActive?: 'true' | 'false' }): Promise<PaginatedResult<ItemWithVendor>> {
    const { page, limit, offset, tenantCondition } = withTenantPagination(items, tenantId, options);
    
    // Define table columns for sorting and searching
    const tableColumns = {
      name: items.name,
      quality: items.quality,
      unit: items.unit,
      createdAt: items.createdAt
    };
    
    const searchableColumns = [items.name];
    
    // Build WHERE conditions array starting with tenant filtering
    const whereConditions = [tenantCondition];
    
    // Add isActive filter conditionally based on options.isActive
    if (options.isActive === 'true') {
      whereConditions.push(eq(items.isActive, true));
    } else if (options.isActive === 'false') {
      whereConditions.push(eq(items.isActive, false));
    }
    // If options.isActive is undefined, don't add any isActive filter (show all items)
    
    const combinedCondition = and(...whereConditions)!;
    
    // Build base query with left join to vendors
    let query = db.select({ item: items, vendor: vendors }).from(items)
      .leftJoin(vendors, and(eq(items.vendorId, vendors.id), eq(vendors.tenantId, tenantId)))
      .where(combinedCondition);
    
    // Apply search filter using helper
    if (options.search) {
      query = applySearchFilter(query, options.search, searchableColumns, combinedCondition);
    }
    
    // Apply sorting using helper
    query = applySorting(query, options.sortBy || 'name', options.sortOrder || 'asc', tableColumns);
    
    // Apply pagination and execute
    const results = await query.limit(limit).offset(offset);
    
    // Map results to ItemWithVendor format
    const data = results.map(record => ({
      ...record.item,
      vendor: record.vendor
    })) as ItemWithVendor[];
    
    // Get total count with same joins and filtering
    let countQuery = db.select({ count: count() }).from(items)
      .leftJoin(vendors, and(eq(items.vendorId, vendors.id), eq(vendors.tenantId, tenantId)))
      .where(combinedCondition);
    
    if (options.search) {
      countQuery = applySearchFilter(countQuery, options.search, searchableColumns, combinedCondition);
    }
    
    const [{ count: total }] = await countQuery;
    
    const pagination = buildPaginationMetadata(page, limit, total);
    
    return { data, pagination };
  }
}