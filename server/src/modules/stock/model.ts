import { eq, desc, asc, and, or, count, ilike, lte, inArray, isNull, ne } from "drizzle-orm";
import schema from '../../../shared/schema.js';

const { 
  stock,
  stockMovements,
  items,
  vendors
} = schema;

type Stock = typeof schema.stock.$inferSelect;
type InsertStock = typeof schema.insertStockSchema._input;
type StockMovement = typeof schema.stockMovements.$inferSelect;
type InsertStockMovement = typeof schema.insertStockMovementSchema._input;
type StockWithItem = typeof schema.StockWithItem;
type PaginationOptions = typeof schema.PaginationOptions;
type PaginatedResult<T> = typeof schema.PaginatedResult<T>;
import { db } from "../../../db";
import {
  normalizePaginationOptions,
  buildPaginationMetadata,
  withTenantPagination
} from "../../utils/pagination";
import { withTenant, ensureTenantInsert } from "../../utils/tenant-scope";
import { assertSameTenant } from "../../utils/tenant";
import { ValidationError, AppError } from "../../types";
import { handleDatabaseError } from "../../utils/database-errors";

export class StockModel {
  async getStock(tenantId: string): Promise<StockWithItem[]> {
    // Use JOINs to avoid N+1 queries, matching the approach in getStockPaginated
    const stockData = await db.select({
      stock: stock,
      item: items,
      vendor: vendors
    })
    .from(stock)
    .leftJoin(items, eq(stock.itemId, items.id))
    .leftJoin(vendors, eq(items.vendorId, vendors.id))
    .where(and(
      withTenant(stock, tenantId),
      withTenant(items, tenantId),
      withTenant(vendors, tenantId)
    ));
    
    // Assemble final data - ensure response payload remains identical
    const result = stockData
      .filter(record => record.item && record.vendor) // Filter out records without valid item/vendor
      .map(record => ({
        ...record.stock,
        item: { ...record.item!, vendor: record.vendor! }
      })) as StockWithItem[];
    
    return result;
  }

  async getStockPaginated(tenantId: string, options?: PaginationOptions & {
    search?: string;
    lowStock?: boolean;
  }): Promise<PaginatedResult<StockWithItem>> {
    const { page, limit, offset, tenantCondition } = withTenantPagination(stock, tenantId, options || {});
    
    // Build WHERE conditions array starting with tenant filtering
    const whereConditions = [
      withTenant(stock, tenantId),
      withTenant(items, tenantId),
      withTenant(vendors, tenantId)
    ];
    
    // Filter by active items only
    whereConditions.push(eq(items.isActive, true));
    
    // Apply low stock filter
    if (options?.lowStock) {
      whereConditions.push(or(
        lte(stock.quantityInCrates, '5'),
        lte(stock.quantityInBoxes, '10'),
        lte(stock.quantityInKgs, '50')
      )!);
    }
    
    // Handle search by getting matching item/vendor IDs with tenant filtering
    if (options?.search) {
      // Get item IDs that match search with tenant filtering
      const matchingItems = await db.select({ id: items.id })
        .from(items)
        .where(withTenant(items, tenantId, ilike(items.name, `%${options.search}%`)));
      const itemIds = matchingItems.map(i => i.id);
      
      // Get vendor IDs that match search with tenant filtering
      const matchingVendors = await db.select({ id: vendors.id })
        .from(vendors)
        .where(withTenant(vendors, tenantId, ilike(vendors.name, `%${options.search}%`)));
      const vendorIds = matchingVendors.map(v => v.id);
      
      // Build search conditions
      const searchConditions = [];
      
      if (itemIds.length > 0) {
        searchConditions.push(inArray(items.id, itemIds));
      }
      
      if (vendorIds.length > 0) {
        searchConditions.push(inArray(items.vendorId, vendorIds));
      }
      
      if (searchConditions.length > 0) {
        whereConditions.push(or(...searchConditions)!);
      }
    }
    
    // Combine all conditions
    const finalWhereCondition = whereConditions.length > 0 ? and(...whereConditions) : undefined;
    
    // Apply sorting
    const sortBy = options?.sortBy || 'lastUpdated';
    const sortOrder = options?.sortOrder || 'desc';
    
    // Build sorting order
    let orderByClause;
    if (sortBy === 'itemName') {
      orderByClause = sortOrder === 'asc' ? asc(items.name) : desc(items.name);
    } else if (sortBy === 'vendorName') {
      orderByClause = sortOrder === 'asc' ? asc(vendors.name) : desc(vendors.name);
    } else if (sortBy === 'quantityInCrates') {
      orderByClause = sortOrder === 'asc' ? asc(stock.quantityInCrates) : desc(stock.quantityInCrates);
    } else if (sortBy === 'quantityInBoxes') {
      orderByClause = sortOrder === 'asc' ? asc(stock.quantityInBoxes) : desc(stock.quantityInBoxes);
    } else if (sortBy === 'quantityInKgs') {
      orderByClause = sortOrder === 'asc' ? asc(stock.quantityInKgs) : desc(stock.quantityInKgs);
    } else { // default to lastUpdated
      orderByClause = sortOrder === 'asc' ? asc(stock.lastUpdated) : desc(stock.lastUpdated);
    }
    
    // Build and execute paginated query with JOINs
    const stockData = await (
      finalWhereCondition
        ? db.select({
            stock: stock,
            item: items,
            vendor: vendors
          })
          .from(stock)
          .leftJoin(items, eq(stock.itemId, items.id))
          .leftJoin(vendors, eq(items.vendorId, vendors.id))
          .where(finalWhereCondition)
          .orderBy(orderByClause)
          .limit(limit)
          .offset(offset)
        : db.select({
            stock: stock,
            item: items,
            vendor: vendors
          })
          .from(stock)
          .leftJoin(items, eq(stock.itemId, items.id))
          .leftJoin(vendors, eq(items.vendorId, vendors.id))
          .orderBy(orderByClause)
          .limit(limit)
          .offset(offset)
    );
    
    // Assemble final data
    const data = stockData
      .filter(record => record.item && record.vendor) // Filter out records without valid item/vendor
      .map(record => ({
        ...record.stock,
        item: { ...record.item!, vendor: record.vendor! }
      })) as StockWithItem[];
    
    // Get total count with same conditions
    const [{ count: total }] = await (
      finalWhereCondition
        ? db.select({ count: count() })
          .from(stock)
          .leftJoin(items, eq(stock.itemId, items.id))
          .leftJoin(vendors, eq(items.vendorId, vendors.id))
          .where(finalWhereCondition)
        : db.select({ count: count() })
          .from(stock)
          .leftJoin(items, eq(stock.itemId, items.id))
          .leftJoin(vendors, eq(items.vendorId, vendors.id))
    );
    
    const pagination = buildPaginationMetadata(page, limit, total);
    
    return { data, pagination };
  }

  async getStockByItem(tenantId: string, itemId: string, externalTx?: any): Promise<Stock | undefined> {
    const dbToUse = externalTx || db;
    const [stockItem] = await dbToUse.select().from(stock)
      .where(withTenant(stock, tenantId, eq(stock.itemId, itemId)));
    return stockItem || undefined;
  }

  async updateStock(tenantId: string, itemId: string, insertStock: Partial<InsertStock>, externalTx?: any): Promise<Stock> {
    // Add business logic validation
    if (insertStock.quantityInCrates !== undefined) {
      const cratesQty = parseFloat(insertStock.quantityInCrates || '0');
      if (isNaN(cratesQty) || cratesQty < 0) {
        throw new ValidationError('Invalid quantity in crates', {
          quantityInCrates: 'Quantity in crates must be a non-negative number'
        });
      }
    }

    if (insertStock.quantityInBoxes !== undefined) {
      const boxesQty = parseFloat(insertStock.quantityInBoxes || '0');
      if (isNaN(boxesQty) || boxesQty < 0) {
        throw new ValidationError('Invalid quantity in boxes', {
          quantityInBoxes: 'Quantity in boxes must be a non-negative number'
        });
      }
    }

    if (insertStock.quantityInKgs !== undefined) {
      const kgsQty = parseFloat(insertStock.quantityInKgs || '0');
      if (isNaN(kgsQty) || kgsQty < 0) {
        throw new ValidationError('Invalid quantity in kgs', {
          quantityInKgs: 'Quantity in kgs must be a non-negative number'
        });
      }
    }

    try {
      const dbToUse = externalTx || db;
      const existing = await this.getStockByItem(tenantId, itemId, externalTx);
      if (existing) {
        const [updated] = await dbToUse
          .update(stock)
          .set({ ...insertStock, lastUpdated: new Date() })
          .where(withTenant(stock, tenantId, eq(stock.itemId, itemId)))
          .returning();
        return updated;
      } else {
        const [created] = await dbToUse.insert(stock)
          .values(ensureTenantInsert({ ...insertStock, itemId }, tenantId))
          .returning();
        return created;
      }
    } catch (error) {
      if (error instanceof AppError) throw error;
      handleDatabaseError(error);
    }
  }

  // Stock movement management
  async getStockMovements(tenantId: string): Promise<StockMovement[]> {
    return await db.select().from(stockMovements)
      .where(withTenant(stockMovements, tenantId))
      .orderBy(desc(stockMovements.createdAt));
  }

  async getStockMovementsByItem(tenantId: string, itemId: string): Promise<any[]> {
    const movements = await db.select().from(stockMovements)
      .where(withTenant(stockMovements, tenantId, eq(stockMovements.itemId, itemId)))
      .orderBy(desc(stockMovements.createdAt));
    
    const result = [];
    for (const movement of movements) {
      const [item] = await db.select().from(items)
        .where(withTenant(items, tenantId, eq(items.id, movement.itemId)));
      if (item) {
        const [vendor] = await db.select().from(vendors)
          .where(withTenant(vendors, tenantId, eq(vendors.id, item.vendorId!)));
        result.push({
          ...movement,
          item: { ...item, vendor: vendor || null }
        });
      }
    }
    return result;
  }

  async getAvailableStockOutEntriesByVendor(tenantId: string, vendorId: string): Promise<any[]> {
    // Get stock movements of type "OUT" for items owned by the vendor
    // Exclude wastage entries as they should not be included in purchase invoices
    const movements = await db.select().from(stockMovements)
      .innerJoin(items, eq(stockMovements.itemId, items.id))
      .where(
        and(
          withTenant(stockMovements, tenantId),
          withTenant(items, tenantId),
          eq(items.vendorId, vendorId),
          eq(stockMovements.movementType, "OUT"),
          isNull(stockMovements.purchaseInvoiceId),
          ne(stockMovements.referenceType, "WASTAGE") // Exclude wastage entries
        )
      )
      .orderBy(desc(stockMovements.createdAt));
    
    const result = [];
    for (const movement of movements) {
      result.push({
        ...movement.stock_movements,
        item: movement.items
      });
    }
    return result;
  }

  async createStockMovement(tenantId: string, insertMovement: InsertStockMovement, externalTx?: any): Promise<StockMovement> {
    // Add business logic validation
    if (!insertMovement.itemId) {
      throw new ValidationError('Item is required', {
        itemId: 'Item must be selected'
      });
    }

    if (!insertMovement.movementType || !['IN', 'OUT'].includes(insertMovement.movementType)) {
      throw new ValidationError('Invalid movement type', {
        movementType: 'Movement type must be IN or OUT'
      });
    }

    const cratesQty = parseFloat(insertMovement.quantityInCrates || '0');
    if (isNaN(cratesQty) || cratesQty < 0) {
      throw new ValidationError('Invalid quantity in crates', {
        quantityInCrates: 'Quantity in crates must be a non-negative number'
      });
    }

    const boxesQty = parseFloat(insertMovement.quantityInBoxes || '0');
    if (isNaN(boxesQty) || boxesQty < 0) {
      throw new ValidationError('Invalid quantity in boxes', {
        quantityInBoxes: 'Quantity in boxes must be a non-negative number'
      });
    }

    const kgsQty = parseFloat(insertMovement.quantityInKgs);
    if (isNaN(kgsQty) || kgsQty < 0) {
      throw new ValidationError('Invalid quantity in kgs', {
        quantityInKgs: 'Quantity in kgs must be a non-negative number'
      });
    }

    const rate = parseFloat(insertMovement.rate || '0');
    if (isNaN(rate) || rate < 0) {
      throw new ValidationError('Invalid rate', {
        rate: 'Rate must be a non-negative number'
      });
    }

    try {
      const executeTransaction = async (tx: any) => {
        const [movement] = await tx.insert(stockMovements)
          .values(ensureTenantInsert(insertMovement, tenantId))
          .returning();
        
        // Update stock balance after movement
        const balance = await this.calculateStockBalance(tenantId, insertMovement.itemId, tx);
        await this.updateStock(tenantId, insertMovement.itemId, {
          quantityInCrates: balance.crates.toString(),
          quantityInBoxes: balance.boxes.toString(),
          quantityInKgs: balance.kgs.toString()
        }, tx);
        
        return movement;
      };

      if (externalTx) {
        return await executeTransaction(externalTx);
      } else {
        return await db.transaction(executeTransaction);
      }
    } catch (error) {
      if (error instanceof AppError) throw error;
      handleDatabaseError(error);
    }
  }

  async calculateStockBalance(tenantId: string, itemId: string, externalTx?: any): Promise<{ crates: number; kgs: number; boxes: number }> {
    const dbToUse = externalTx || db;
    const movements = await dbToUse.select().from(stockMovements)
      .where(withTenant(stockMovements, tenantId, eq(stockMovements.itemId, itemId)));
    
    let totalCrates = 0;
    let totalKgs = 0;
    let totalBoxes = 0;
    
    movements.forEach((movement: any) => {
      const cratesQty = parseFloat(movement.quantityInCrates);
      const kgsQty = parseFloat(movement.quantityInKgs);
      const boxesQty = parseFloat(movement.quantityInBoxes || "0");
      
      if (movement.movementType === "IN") {
        totalCrates += cratesQty;
        totalKgs += kgsQty;
        totalBoxes += boxesQty;
      } else {
        totalCrates -= cratesQty;
        totalKgs -= kgsQty;
        totalBoxes -= boxesQty;
      }
    });
    
    return { 
      crates: Math.max(0, totalCrates), 
      kgs: Math.max(0, totalKgs),
      boxes: Math.max(0, totalBoxes)
    };
  }
}