import { eq, desc, asc, and, or, gte, lte, ilike, inArray, count, sql, isNull } from 'drizzle-orm';
import { db } from '../../../db';
import { normalizePaginationOptions, buildPaginationMetadata, withTenantPagination } from '../../utils/pagination';
import { withTenant, ensureTenantInsert } from '../../utils/tenant-scope';
import { assertSameTenant } from '../../utils/tenant';
import { InvoiceShareLinkModel } from '../invoice-share-links/model';
import { NotFoundError, ValidationError, BadRequestError, ConflictError, AppError } from '../../types';
import { handleDatabaseError } from '../../utils/database-errors';
import schema from '../../../shared/schema.js';

const { 
  purchaseInvoices, 
  invoiceItems, 
  vendors, 
  items, 
  invoiceShareLinks, 
  stockMovements, 
  payments, 
  crateTransactions, 
  CRATE_TRANSACTION_TYPES, 
  INVOICE_STATUS 
} = schema;

type PurchaseInvoice = typeof schema.purchaseInvoices.$inferSelect;
type InsertPurchaseInvoice = typeof schema.insertPurchaseInvoiceSchema._input;
type InsertInvoiceItem = typeof schema.insertInvoiceItemSchema._input;
type InsertCrateTransaction = typeof schema.insertCrateTransactionSchema._input;
type InvoiceWithItems = typeof schema.InvoiceWithItems;
type PaginationOptions = typeof schema.PaginationOptions;
type PaginatedResult<T> = typeof schema.PaginatedResult<T>;
type InvoiceShareLink = typeof schema.invoiceShareLinks.$inferSelect;
type CrateTransaction = typeof schema.crateTransactions.$inferSelect;


// Local type that extends InvoiceWithItems to include optional crate transaction
type InvoiceWithItemsAndCrate = InvoiceWithItems & {
  crateTransaction?: CrateTransaction | null;
};

export class PurchaseInvoiceModel {
  private shareModel = new InvoiceShareLinkModel();

  async createShareLink(tenantId: string, invoiceId: string): Promise<InvoiceShareLink> {
    // Verify the invoice exists and belongs to this tenant
    const invoice = await this.getPurchaseInvoice(tenantId, invoiceId);
    if (!invoice) {
      throw new NotFoundError('Purchase invoice');
    }
    
    return await this.shareModel.createOrGetShareLink(tenantId, invoiceId, 'purchase');
  }

  async getPurchaseInvoices(tenantId: string): Promise<InvoiceWithItems[]> {
    const invoices = await db.select().from(purchaseInvoices)
      .where(withTenant(purchaseInvoices, tenantId))
      .orderBy(desc(purchaseInvoices.createdAt));

    if (invoices.length === 0) {
      return [];
    }

    // Batch fetch vendors and items for all invoices with tenant filtering
    const vendorIdsSet = new Set(invoices.map(inv => inv.vendorId));
    const vendorIds = Array.from(vendorIdsSet);
    const invoiceIds = invoices.map(inv => inv.id);
    
    const [vendorsData, itemsDataWithDetails] = await Promise.all([
      vendorIds.length > 0 ? db.select().from(vendors).where(withTenant(vendors, tenantId, inArray(vendors.id, vendorIds))) : [],
      invoiceIds.length > 0 ? db.select({
        invoiceItem: invoiceItems,
        item: items
      })
      .from(invoiceItems)
      .innerJoin(items, eq(invoiceItems.itemId, items.id))
      .where(withTenant(invoiceItems, tenantId, inArray(invoiceItems.invoiceId, invoiceIds))) : []
    ]);
    
    // Create lookup maps
    const vendorMap = new Map(vendorsData.map(v => [v.id, v]));
    const itemsMap = new Map<string, any[]>();
    itemsDataWithDetails.forEach(({ invoiceItem, item }) => {
      if (!itemsMap.has(invoiceItem.invoiceId)) {
        itemsMap.set(invoiceItem.invoiceId, []);
      }
      // Map the results to include item details in the invoice item objects
      itemsMap.get(invoiceItem.invoiceId)!.push({
        ...invoiceItem,
        item: `${item.name} - ${item.quality}`, // Format as "Name - Quality"
        itemName: item.name,
        itemQuality: item.quality,
        itemUnit: item.unit
      });
    });
    
    // Assemble final data - filter out invoices without vendors to maintain type integrity
    const result = invoices
      .map(invoice => {
        const vendor = vendorMap.get(invoice.vendorId);
        if (!vendor) return null;
        return {
          ...invoice,
          vendor,
          items: itemsMap.get(invoice.id) || []
        };
      })
      .filter(invoice => invoice !== null) as InvoiceWithItems[];

    return result;
  }

  async getPurchaseInvoice(tenantId: string, id: string): Promise<InvoiceWithItems | undefined> {
    const [invoice] = await db.select().from(purchaseInvoices)
      .where(withTenant(purchaseInvoices, tenantId, eq(purchaseInvoices.id, id)));

    if (!invoice) {
      return undefined;
    }

    const [vendor] = await db.select().from(vendors)
      .where(withTenant(vendors, tenantId, eq(vendors.id, invoice.vendorId)));
    
    if (!vendor) {
      throw new NotFoundError('Vendor');
    }
    
    // Join with items table to get item details including name, quality, and unit
    const itemsListWithDetails = await db.select({
      invoiceItem: invoiceItems,
      item: items
    })
    .from(invoiceItems)
    .innerJoin(items, eq(invoiceItems.itemId, items.id))
    .where(withTenant(invoiceItems, tenantId, eq(invoiceItems.invoiceId, invoice.id)));

    // Map the results to include item details in the invoice item objects
    const itemsList = itemsListWithDetails.map(({ invoiceItem, item }) => ({
      ...invoiceItem,
      item: `${item.name} - ${item.quality}`, // Format as "Name - Quality"
      itemName: item.name,
      itemQuality: item.quality,
      itemUnit: item.unit
    }));

    return { ...invoice, vendor, items: itemsList };
  }

  async createPurchaseInvoice(
    tenantId: string, 
    invoiceData: InsertPurchaseInvoice, 
    itemsData: InsertInvoiceItem[],
    crateTransactionData?: InsertCrateTransaction,
    stockOutEntryIds?: string[]
  ): Promise<InvoiceWithItemsAndCrate> {
    // Add business logic validation
    if (!itemsData || itemsData.length === 0) {
      throw new ValidationError('Invoice must contain at least one item', {
        items: 'At least one item is required'
      });
    }

    const netAmount = parseFloat(invoiceData.netAmount);
    if (isNaN(netAmount) || netAmount <= 0) {
      throw new ValidationError('Invalid invoice amount', {
        netAmount: 'Net amount must be a positive number'
      });
    }

    // Validate vendor ID is provided
    if (!invoiceData.vendorId) {
      throw new ValidationError('Vendor is required', {
        vendorId: 'Vendor must be selected'
      });
    }

    // Add preflight validation for stockOutEntryIds format
    if (stockOutEntryIds && stockOutEntryIds.some(id => !id || typeof id !== 'string' || id.trim().length === 0)) {
      throw new ValidationError('Invalid stock movement IDs provided', {
        stockOutEntryIds: 'All stock movement IDs must be non-empty strings'
      });
    }

    try {
      return await db.transaction(async (tx) => {
      // Validate tenant references
      await assertSameTenant(tx, tenantId, [
        { table: 'vendors', id: invoiceData.vendorId }
      ]);
      
      // Generate invoice number with PI prefix + compact timestamp suffix
      const invoiceNumber = `PI${String(Date.now()).slice(-6)}`;
      
      const invoiceWithTenant = ensureTenantInsert({
        ...invoiceData,
        invoiceNumber,
        balanceAmount: invoiceData.netAmount,
        status: INVOICE_STATUS.UNPAID
      }, tenantId);
      
      const [invoice] = await tx.insert(purchaseInvoices).values(invoiceWithTenant).returning();
      
      // Link selected stock OUT entries to this purchase invoice
      if (stockOutEntryIds && stockOutEntryIds.length > 0) {
        // Fetch selected movements with their items to validate
        const selectedMovements = await tx.select({
          movement: stockMovements,
          item: items
        })
        .from(stockMovements)
        .innerJoin(items, eq(stockMovements.itemId, items.id))
        .where(
          and(
            withTenant(stockMovements, tenantId),
            inArray(stockMovements.id, stockOutEntryIds)
          )
        );
        
        // Validate all movements exist
        if (selectedMovements.length !== stockOutEntryIds.length) {
          throw new ValidationError('Some selected stock movements not found', {
            stockOutEntryIds: 'One or more stock movement IDs are invalid'
          });
        }
        
        // Validate none are already allocated
        const alreadyAllocated = selectedMovements.filter(sm => sm.movement.purchaseInvoiceId !== null);
        if (alreadyAllocated.length > 0) {
          throw new ConflictError('Some selected stock movements are already allocated to another purchase invoice');
        }
        
        // Validate all belong to the correct vendor
        const wrongVendor = selectedMovements.filter(sm => sm.item.vendorId !== invoiceData.vendorId);
        if (wrongVendor.length > 0) {
          throw new ValidationError('Some selected stock movements do not belong to the selected vendor', {
            stockOutEntryIds: 'All stock movements must belong to the selected vendor'
          });
        }
        
        // Validate all movements are of type OUT
        const nonOutMovements = selectedMovements.filter(sm => sm.movement.movementType !== 'OUT');
        if (nonOutMovements.length > 0) {
          throw new ValidationError('Some selected stock movements are not of type OUT', {
            stockOutEntryIds: 'Only OUT type stock movements can be linked to purchase invoices'
          });
        }
        
        // Link movements to this invoice with concurrent protection
        const updatedMovements = await tx.update(stockMovements)
          .set({ purchaseInvoiceId: invoice.id })
          .where(
            and(
              withTenant(stockMovements, tenantId),
              inArray(stockMovements.id, stockOutEntryIds),
              isNull(stockMovements.purchaseInvoiceId)
            )
          )
          .returning();
        
        // Verify all movements were updated (protect against concurrent allocation)
        if (updatedMovements.length !== stockOutEntryIds.length) {
          throw new ConflictError('Some stock movements were concurrently allocated to another purchase invoice. Please refresh and try again.');
        }
      }
      
      const itemsWithInvoiceIdAndTenant = itemsData.map(item => 
        ensureTenantInsert({
          ...item,
          invoiceId: invoice.id
        }, tenantId)
      );
      
      const createdItems = await tx.insert(invoiceItems).values(itemsWithInvoiceIdAndTenant).returning();
      
      const [vendor] = await tx.select().from(vendors)
        .where(withTenant(vendors, tenantId, eq(vendors.id, invoice.vendorId)));
      
      if (!vendor) {
        throw new NotFoundError('Vendor');
      }
      
      // Create crate transaction if provided
      let crateTransaction: CrateTransaction | null = null;
      if (crateTransactionData) {
        // Link crate transaction to the created invoice and ensure it references the same vendor
        const crateDataWithInvoice = ensureTenantInsert({
          ...crateTransactionData,
          purchaseInvoiceId: invoice.id,
          partyType: 'vendor',
          vendorId: invoice.vendorId,
          retailerId: null,
        }, tenantId);
        
        // Insert crate transaction within the same transaction
        const [createdCrateTransaction] = await tx.insert(crateTransactions)
          .values(crateDataWithInvoice)
          .returning();
        
        crateTransaction = createdCrateTransaction;
        
        // Update vendor crate balance
        // 'Received' increases balance (we receive crates from vendor)
        // 'Returned' decreases balance (we return crates to vendor)
        const balanceChange = crateTransactionData.transactionType === 'Received' 
          ? crateTransactionData.quantity 
          : -crateTransactionData.quantity;
        
        await tx.update(vendors)
          .set({ 
            crateBalance: sql`COALESCE(${vendors.crateBalance}, 0) + ${balanceChange}`
          })
          .where(withTenant(vendors, tenantId, eq(vendors.id, invoice.vendorId)));
      }
      
      // Update vendor balance - increase by netAmount since we now owe them more
      await tx.update(vendors)
        .set({ 
          balance: sql`COALESCE(${vendors.balance}, 0) + ${invoice.netAmount}`
        })
        .where(withTenant(vendors, tenantId, eq(vendors.id, invoice.vendorId)));
      
      return { 
        ...invoice, 
        vendor, 
        items: createdItems,
        crateTransaction 
      };
    });
    } catch (error) {
      if (error instanceof AppError) throw error;
      handleDatabaseError(error);
    }
  }

  async updatePurchaseInvoice(
    tenantId: string, 
    invoiceId: string,
    invoiceData: InsertPurchaseInvoice, 
    itemsData: InsertInvoiceItem[],
    crateTransactionData?: InsertCrateTransaction,
    stockOutEntryIds?: string[]
  ): Promise<InvoiceWithItemsAndCrate> {
    // Add business logic validation
    if (!itemsData || itemsData.length === 0) {
      throw new ValidationError('Invoice must contain at least one item', {
        items: 'At least one item is required'
      });
    }

    const netAmount = parseFloat(invoiceData.netAmount);
    if (isNaN(netAmount) || netAmount <= 0) {
      throw new ValidationError('Invalid invoice amount', {
        netAmount: 'Net amount must be a positive number'
      });
    }

    // Add preflight validation for stockOutEntryIds format
    if (stockOutEntryIds && stockOutEntryIds.some(id => !id || typeof id !== 'string' || id.trim().length === 0)) {
      throw new ValidationError('Invalid stock movement IDs provided', {
        stockOutEntryIds: 'All stock movement IDs must be non-empty strings'
      });
    }

    try {
      return await db.transaction(async (tx) => {
        // Phase 1: Validation - Fetch existing invoice
        const [oldInvoice] = await tx.select().from(purchaseInvoices)
          .where(withTenant(purchaseInvoices, tenantId, eq(purchaseInvoices.id, invoiceId)));
        
        if (!oldInvoice) {
          throw new NotFoundError('Purchase invoice');
        }

        // Validate invoice status is UNPAID
        if (oldInvoice.status !== INVOICE_STATUS.UNPAID) {
          throw new BadRequestError('Only unpaid invoices can be edited');
        }

        // Phase 2: Reverse old vendor monetary balance
        const [vendor] = await tx.select().from(vendors)
          .where(and(
            withTenant(vendors, tenantId),
            eq(vendors.id, oldInvoice.vendorId)
          ));
        
        if (!vendor) {
          throw new NotFoundError('Vendor');
        }

        await tx.update(vendors)
          .set({
            balance: sql`COALESCE(${vendors.balance}, 0) - ${oldInvoice.netAmount}`
          })
          .where(and(
            withTenant(vendors, tenantId),
            eq(vendors.id, oldInvoice.vendorId)
          ));

        // Phase 3: Delete old crate transactions and reverse crate balance
        const crateTransactionsList = await tx.select().from(crateTransactions)
          .where(and(
            withTenant(crateTransactions, tenantId),
            eq(crateTransactions.purchaseInvoiceId, invoiceId)
          ));
        
        if (crateTransactionsList.length > 0) {
          // Calculate total reverse balance change for all crate transactions
          let totalReverseChange = 0;
          for (const crateTransaction of crateTransactionsList) {
            // Received: was added, so subtract to reverse
            // Returned: was subtracted, so add back to reverse
            if (crateTransaction.transactionType === CRATE_TRANSACTION_TYPES.RECEIVED) {
              totalReverseChange -= crateTransaction.quantity;
            } else if (crateTransaction.transactionType === CRATE_TRANSACTION_TYPES.RETURNED) {
              totalReverseChange += crateTransaction.quantity;
            }
          }
          
          // Update vendor crate balance
          await tx.update(vendors)
            .set({
              crateBalance: sql`COALESCE(${vendors.crateBalance}, 0) + ${totalReverseChange}`
            })
            .where(and(
              withTenant(vendors, tenantId),
              eq(vendors.id, oldInvoice.vendorId)
            ));
          
          // Delete all crate transactions
          await tx.delete(crateTransactions)
            .where(and(
              withTenant(crateTransactions, tenantId),
              eq(crateTransactions.purchaseInvoiceId, invoiceId)
            ));
        }

        // Phase 4: Unlink old stock movements
        await tx.update(stockMovements)
          .set({ purchaseInvoiceId: null })
          .where(withTenant(stockMovements, tenantId, eq(stockMovements.purchaseInvoiceId, invoiceId)));

        // Phase 5: Delete old invoice items
        await tx.delete(invoiceItems)
          .where(withTenant(invoiceItems, tenantId, eq(invoiceItems.invoiceId, invoiceId)));

        // Validate tenant references for updated vendorId
        await assertSameTenant(tx, tenantId, [
          { table: 'vendors', id: invoiceData.vendorId }
        ]);

        // Phase 6: Update invoice with new data
        const invoiceWithTenant = ensureTenantInsert({
          ...invoiceData,
          invoiceNumber: oldInvoice.invoiceNumber,
          balanceAmount: invoiceData.netAmount,
          status: INVOICE_STATUS.UNPAID
        }, tenantId);

        const [updatedInvoice] = await tx.update(purchaseInvoices)
          .set(invoiceWithTenant)
          .where(withTenant(purchaseInvoices, tenantId, eq(purchaseInvoices.id, invoiceId)))
          .returning();

        // Phase 7: Link new stock OUT entries (if provided)
        if (stockOutEntryIds && stockOutEntryIds.length > 0) {
          // Fetch selected movements with their items to validate
          const selectedMovements = await tx.select({
            movement: stockMovements,
            item: items
          })
          .from(stockMovements)
          .innerJoin(items, eq(stockMovements.itemId, items.id))
          .where(
            and(
              withTenant(stockMovements, tenantId),
              inArray(stockMovements.id, stockOutEntryIds)
            )
          );
          
          // Validate all movements exist
          if (selectedMovements.length !== stockOutEntryIds.length) {
            throw new ValidationError('Some selected stock movements not found', {
              stockOutEntryIds: 'One or more stock movement IDs are invalid'
            });
          }
          
          // Validate none are already allocated
          const alreadyAllocated = selectedMovements.filter(sm => sm.movement.purchaseInvoiceId !== null);
          if (alreadyAllocated.length > 0) {
            throw new ConflictError('Some selected stock movements are already allocated to another purchase invoice');
          }
          
          // Validate all belong to the correct vendor
          const wrongVendor = selectedMovements.filter(sm => sm.item.vendorId !== updatedInvoice.vendorId);
          if (wrongVendor.length > 0) {
            throw new ValidationError('Some selected stock movements do not belong to the selected vendor', {
              stockOutEntryIds: 'All stock movements must belong to the selected vendor'
            });
          }
          
          // Validate all movements are of type OUT
          const nonOutMovements = selectedMovements.filter(sm => sm.movement.movementType !== 'OUT');
          if (nonOutMovements.length > 0) {
            throw new ValidationError('Some selected stock movements are not of type OUT', {
              stockOutEntryIds: 'Only OUT type stock movements can be linked to purchase invoices'
            });
          }
          
          // Link movements to this invoice with concurrent protection
          const updatedMovements = await tx.update(stockMovements)
            .set({ purchaseInvoiceId: updatedInvoice.id })
            .where(
              and(
                withTenant(stockMovements, tenantId),
                inArray(stockMovements.id, stockOutEntryIds),
                isNull(stockMovements.purchaseInvoiceId)
              )
            )
            .returning();
          
          // Verify all movements were updated (protect against concurrent allocation)
          if (updatedMovements.length !== stockOutEntryIds.length) {
            throw new ConflictError('Some stock movements were concurrently allocated to another purchase invoice. Please refresh and try again.');
          }
        }

        // Phase 8: Create new invoice items
        const itemsWithInvoiceIdAndTenant = itemsData.map(item => 
          ensureTenantInsert({
            ...item,
            invoiceId: invoiceId
          }, tenantId)
        );
        
        const createdItems = await tx.insert(invoiceItems).values(itemsWithInvoiceIdAndTenant).returning();

        // Phase 9: Apply new vendor monetary balance
        const [freshVendor] = await tx.select().from(vendors)
          .where(withTenant(vendors, tenantId, eq(vendors.id, updatedInvoice.vendorId)));
        
        if (!freshVendor) {
          throw new NotFoundError('Vendor');
        }

        await tx.update(vendors)
          .set({ 
            balance: sql`COALESCE(${vendors.balance}, 0) + ${updatedInvoice.netAmount}`
          })
          .where(withTenant(vendors, tenantId, eq(vendors.id, updatedInvoice.vendorId)));

        // Phase 10: Create new crate transaction (if provided)
        let crateTransaction: CrateTransaction | null = null;
        if (crateTransactionData) {
          // Link crate transaction to the updated invoice and ensure it references the same vendor
          const crateDataWithInvoice = ensureTenantInsert({
            ...crateTransactionData,
            purchaseInvoiceId: invoiceId,
            partyType: 'vendor',
            vendorId: updatedInvoice.vendorId,
            retailerId: null,
          }, tenantId);
          
          // Insert crate transaction within the same transaction
          const [createdCrateTransaction] = await tx.insert(crateTransactions)
            .values(crateDataWithInvoice)
            .returning();
          
          crateTransaction = createdCrateTransaction;
          
          // Update vendor crate balance
          // 'Received' increases balance (we receive crates from vendor)
          // 'Returned' decreases balance (we return crates to vendor)
          const balanceChange = crateTransactionData.transactionType === 'Received' 
            ? crateTransactionData.quantity 
            : -crateTransactionData.quantity;
          
          await tx.update(vendors)
            .set({ 
              crateBalance: sql`COALESCE(${vendors.crateBalance}, 0) + ${balanceChange}`
            })
            .where(withTenant(vendors, tenantId, eq(vendors.id, updatedInvoice.vendorId)));
        }

        // Phase 11: Fetch fresh vendor with updated balances and return result
        const [finalVendor] = await tx.select().from(vendors)
          .where(withTenant(vendors, tenantId, eq(vendors.id, updatedInvoice.vendorId)));
        
        if (!finalVendor) {
          throw new NotFoundError('Vendor');
        }

        return { 
          ...updatedInvoice, 
          vendor: finalVendor, 
          items: createdItems,
          crateTransaction 
        };
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      handleDatabaseError(error);
    }
  }

  async getPurchaseInvoicesPaginated(tenantId: string, options?: PaginationOptions & {
    search?: string;
    status?: 'paid' | 'unpaid';
    vendorId?: string;
    dateRange?: { from?: string; to?: string };
  }): Promise<PaginatedResult<InvoiceWithItems>> {
    const { page, limit, offset, tenantCondition } = withTenantPagination(purchaseInvoices, tenantId, options || {});
    
    // Build WHERE conditions array starting with tenant filtering
    const whereConditions = [tenantCondition];
    
    // Apply status filter
    if (options?.status === 'paid') {
      whereConditions.push(eq(purchaseInvoices.status, INVOICE_STATUS.PAID));
    } else if (options?.status === 'unpaid') {
      whereConditions.push(or(
        eq(purchaseInvoices.status, INVOICE_STATUS.UNPAID),
        eq(purchaseInvoices.status, INVOICE_STATUS.PARTIALLY_PAID)
      )!);
    }
    
    // Apply vendor filter
    if (options?.vendorId) {
      whereConditions.push(eq(purchaseInvoices.vendorId, options.vendorId));
    }
    
    // Apply date range filter
    if (options?.dateRange?.from) {
      whereConditions.push(gte(purchaseInvoices.invoiceDate, new Date(options.dateRange.from)));
    }
    if (options?.dateRange?.to) {
      whereConditions.push(lte(purchaseInvoices.invoiceDate, new Date(options.dateRange.to)));
    }
    
    // Handle search by getting matching vendor IDs or invoice numbers/status
    if (options?.search) {
      // Get vendor IDs that match search with tenant filtering
      const matchingVendors = await db.select({ id: vendors.id })
        .from(vendors)
        .where(withTenant(vendors, tenantId, ilike(vendors.name, `%${options.search}%`)));
      const vendorIds = matchingVendors.map(v => v.id);
      
      // Build search conditions
      const searchConditions = [];
      
      // Search in invoice number
      searchConditions.push(ilike(purchaseInvoices.invoiceNumber, `%${options.search}%`));
      
      // Search in status
      searchConditions.push(ilike(purchaseInvoices.status, `%${options.search}%`));
      
      // Search in matching vendor IDs
      if (vendorIds.length > 0) {
        searchConditions.push(inArray(purchaseInvoices.vendorId, vendorIds));
      }
      
      if (searchConditions.length > 0) {
        whereConditions.push(or(...searchConditions)!);
      }
    }
    
    // Combine all conditions
    const finalWhereCondition = whereConditions.length > 0 ? and(...whereConditions) : undefined;
    
    // Apply sorting
    const sortBy = options?.sortBy || 'createdAt';
    const sortOrder = options?.sortOrder || 'desc';
    
    // Build sorting order
    let orderByClause;
    if (sortBy === 'invoiceDate') {
      orderByClause = sortOrder === 'asc' ? asc(purchaseInvoices.invoiceDate) : desc(purchaseInvoices.invoiceDate);
    } else if (sortBy === 'invoiceNumber') {
      orderByClause = sortOrder === 'asc' ? asc(purchaseInvoices.invoiceNumber) : desc(purchaseInvoices.invoiceNumber);
    } else if (sortBy === 'totalAmount') {
      orderByClause = sortOrder === 'asc' ? asc(purchaseInvoices.netAmount) : desc(purchaseInvoices.netAmount);
    } else if (sortBy === 'status') {
      orderByClause = sortOrder === 'asc' ? asc(purchaseInvoices.status) : desc(purchaseInvoices.status);
    } else { // default to createdAt
      orderByClause = sortOrder === 'asc' ? asc(purchaseInvoices.createdAt) : desc(purchaseInvoices.createdAt);
    }
    
    // Build and execute paginated query
    const invoicesData = await (
      finalWhereCondition
        ? db.select()
          .from(purchaseInvoices)
          .where(finalWhereCondition)
          .orderBy(orderByClause)
          .limit(limit)
          .offset(offset)
        : db.select()
          .from(purchaseInvoices)
          .orderBy(orderByClause)
          .limit(limit)
          .offset(offset)
    );
    
    // Batch fetch vendors and items for all invoices with tenant filtering
    const vendorIdsSet = new Set(invoicesData.map(inv => inv.vendorId));
    const vendorIds = Array.from(vendorIdsSet);
    const invoiceIds = invoicesData.map(inv => inv.id);
    
    const [vendorsData, itemsDataWithDetails] = await Promise.all([
      vendorIds.length > 0 ? db.select().from(vendors).where(withTenant(vendors, tenantId, inArray(vendors.id, vendorIds))) : [],
      invoiceIds.length > 0 ? db.select({
        invoiceItem: invoiceItems,
        item: items
      })
      .from(invoiceItems)
      .innerJoin(items, eq(invoiceItems.itemId, items.id))
      .where(withTenant(invoiceItems, tenantId, inArray(invoiceItems.invoiceId, invoiceIds))) : []
    ]);
    
    // Create lookup maps
    const vendorMap = new Map(vendorsData.map(v => [v.id, v]));
    const itemsMap = new Map<string, any[]>();
    itemsDataWithDetails.forEach(({ invoiceItem, item }) => {
      if (!itemsMap.has(invoiceItem.invoiceId)) {
        itemsMap.set(invoiceItem.invoiceId, []);
      }
      // Map the results to include item details in the invoice item objects
      itemsMap.get(invoiceItem.invoiceId)!.push({
        ...invoiceItem,
        item: `${item.name} - ${item.quality}`, // Format as "Name - Quality"
        itemName: item.name,
        itemQuality: item.quality,
        itemUnit: item.unit
      });
    });
    
    // Assemble final data - filter out invoices without vendors to maintain type integrity
    const data = invoicesData
      .map(invoice => {
        const vendor = vendorMap.get(invoice.vendorId);
        if (!vendor) return null;
        return {
          ...invoice,
          vendor,
          items: itemsMap.get(invoice.id) || []
        };
      })
      .filter(invoice => invoice !== null) as InvoiceWithItems[];
    
    // Get total count with same conditions
    const [{ count: total }] = await (
      finalWhereCondition
        ? db.select({ count: count() })
          .from(purchaseInvoices)
          .where(finalWhereCondition)
        : db.select({ count: count() })
          .from(purchaseInvoices)
    );
    
    const pagination = buildPaginationMetadata(page, limit, total);
    
    return { data, pagination };
  }

  async deletePurchaseInvoice(tenantId: string, id: string): Promise<boolean> {
    try {
      return await db.transaction(async (tx) => {
      // Step 1: Fetch the invoice before deletion
      const [invoice] = await tx.select().from(purchaseInvoices)
        .where(and(
          withTenant(purchaseInvoices, tenantId),
          eq(purchaseInvoices.id, id)
        ));
      
      if (!invoice) {
        return false;
      }

      // Status validation: only allow deletion of unpaid invoices
      if (invoice.status !== INVOICE_STATUS.UNPAID) {
        return false;
      }
      
      // Step 2: Fetch all associated crate transactions
      const crateTransactionsList = await tx.select().from(crateTransactions)
        .where(and(
          withTenant(crateTransactions, tenantId),
          eq(crateTransactions.purchaseInvoiceId, id)
        ));
      
      // Step 3: Calculate total reverse balance change for all crate transactions
      let totalReverseChange = 0;
      for (const crateTransaction of crateTransactionsList) {
        // Calculate reverse balance change per transaction
        // Received: was added, so subtract to reverse
        // Returned: was subtracted, so add back to reverse
        if (crateTransaction.transactionType === CRATE_TRANSACTION_TYPES.RECEIVED) {
          totalReverseChange -= crateTransaction.quantity;
        } else if (crateTransaction.transactionType === CRATE_TRANSACTION_TYPES.RETURNED) {
          totalReverseChange += crateTransaction.quantity;
        }
      }
      
      // Step 4: Update vendor crate balance once with total reverse change
      if (crateTransactionsList.length > 0) {
        await tx.update(vendors)
          .set({
            crateBalance: sql`COALESCE(${vendors.crateBalance}, 0) + ${totalReverseChange}`
          })
          .where(and(
            withTenant(vendors, tenantId),
            eq(vendors.id, invoice.vendorId)
          ));
      }
      
      // Step 5: Delete all crate transactions for this invoice
      if (crateTransactionsList.length > 0) {
        await tx.delete(crateTransactions)
          .where(and(
            withTenant(crateTransactions, tenantId),
            eq(crateTransactions.purchaseInvoiceId, id)
          ));
      }
      
      // Step 7: Reverse vendor monetary balance
      await tx.update(vendors)
        .set({
          balance: sql`COALESCE(${vendors.balance}, 0) - ${invoice.netAmount}`
        })
        .where(and(
          withTenant(vendors, tenantId),
          eq(vendors.id, invoice.vendorId)
        ));
      
      // Step 8: Delete related records in cascade order (children first, then parent)
      
      // Delete invoice share links
      await tx.delete(invoiceShareLinks)
        .where(and(
          withTenant(invoiceShareLinks, tenantId),
          eq(invoiceShareLinks.invoiceId, id),
          eq(invoiceShareLinks.invoiceType, 'purchase')
        ));
      
      // Unlink stock movements from this invoice
      await tx.update(stockMovements)
        .set({ purchaseInvoiceId: null })
        .where(and(
          withTenant(stockMovements, tenantId),
          eq(stockMovements.purchaseInvoiceId, id)
        ));
      
      // Delete payments
      await tx.delete(payments)
        .where(and(
          withTenant(payments, tenantId),
          eq(payments.invoiceId, id)
        ));
      
      // Delete invoice items
      await tx.delete(invoiceItems)
        .where(and(
          withTenant(invoiceItems, tenantId),
          eq(invoiceItems.invoiceId, id)
        ));
      
      // Finally delete the purchase invoice itself
      const [deletedInvoice] = await tx.delete(purchaseInvoices)
        .where(and(
          withTenant(purchaseInvoices, tenantId),
          eq(purchaseInvoices.id, id)
        ))
        .returning();
      
      return !!deletedInvoice;
    });
    } catch (error) {
      if (error instanceof AppError) throw error;
      handleDatabaseError(error);
    }
  }
}