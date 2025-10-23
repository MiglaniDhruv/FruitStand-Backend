import { eq, desc, asc, and, or, gte, lte, lt, sql, isNotNull } from 'drizzle-orm';
import { db } from '../../../db';
import { TenantModel } from '../tenants/model';
import { BankAccountModel } from '../bank-accounts/model';
import { getStartOfDay, getEndOfDay, isValidDateString } from './dateUtils';
import schema from '../../../shared/schema.js';
import { withTenant, ensureTenantInsert } from '../../utils/tenant-scope';

// Destructure tables from schema
const { 
  cashbook, 
  bankbook, 
  bankAccounts,
  purchaseInvoices, 
  payments, 
  salesInvoices, 
  salesPayments, 
  crateTransactions, 
  retailers, 
  vendors
} = schema;

// Define types from schema
type CashbookEntry = typeof schema.cashbook.$inferSelect;
type BankbookEntry = typeof schema.bankbook.$inferSelect;
type VendorLedgerEntry = typeof schema.VendorLedgerEntry;
type RetailerLedgerEntry = typeof schema.RetailerLedgerEntry;
type UdhaaarBookEntry = typeof schema.UdhaaarBookEntry;
type CrateLedgerEntry = typeof schema.CrateLedgerEntry;
type BankAccountSummary = typeof schema.BankAccountSummary;
type VendorSummary = typeof schema.VendorSummary;
type RetailerSummary = typeof schema.RetailerSummary;

export class LedgerModel {
  async getCashbook(tenantId: string, fromDate?: string, toDate?: string): Promise<any[]> {
    // Validate date inputs
    if (fromDate && !isValidDateString(fromDate)) {
      fromDate = undefined; // Skip invalid fromDate filter
    }
    if (toDate && !isValidDateString(toDate)) {
      toDate = undefined; // Skip invalid toDate filter
    }

    // Get prior balance if fromDate is specified
    let priorBalance = 0;
    let runningBalance = 0;
    if (fromDate) {
      const priorConditions = [withTenant(cashbook, tenantId), lt(cashbook.date, getStartOfDay(fromDate))];
      const priorWhereExpr = priorConditions.length > 1 ? and(...priorConditions) : priorConditions[0];
      
      const [{ priorIn = 0, priorOut = 0 } = {}] = await db.select({
        priorIn: sql<number>`coalesce(sum(${cashbook.inflow}::numeric),0)`,
        priorOut: sql<number>`coalesce(sum(${cashbook.outflow}::numeric),0)`
      }).from(cashbook).where(priorWhereExpr);
      
      priorBalance = Number(priorIn) - Number(priorOut);
      runningBalance = priorBalance;
    }
    
    // Build where conditions for main query
    const conditions = [withTenant(cashbook, tenantId)];
    
    if (fromDate) {
      conditions.push(gte(cashbook.date, getStartOfDay(fromDate)));
    }
    
    if (toDate) {
      conditions.push(lte(cashbook.date, getEndOfDay(toDate)));
    }
    
    // Fetch entries with date filtering
    const whereExpr = conditions.length > 1 ? and(...conditions) : conditions[0];
    const entries = await db.select().from(cashbook)
      .where(whereExpr)
      .orderBy(asc(cashbook.date), asc(cashbook.id));
    
    // Compute day-wise opening/closing balances
    const entriesWithBalance = [];
    let currentDate = '';
    let syntheticSeq = 0; // Sequence counter for deterministic ordering of synthetic entries
    
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      
      if (!entry.date) {
        continue;
      }
      
      let entryDate;
      try {
        const dateObj = new Date(entry.date);
        if (isNaN(dateObj.getTime())) {
          continue;
        }
        entryDate = dateObj.toISOString().split('T')[0]; // Format as YYYY-MM-DD
      } catch (error) {
        continue;
      }
      
      // Add closing balance for previous day and opening balance for new day
      if (entryDate !== currentDate) {
        if (currentDate !== '') {
          // Add closing balance for previous day
          entriesWithBalance.push({
            date: new Date(currentDate).toISOString(),
            description: 'Day Closing Balance',
            debit: 0,
            credit: 0,
            balance: runningBalance,
            referenceType: 'Balance',
            type: 'Closing',
            isBalanceEntry: true,
            typeOrder: 2,
            _syntheticSeq: syntheticSeq++
          });
        }
        
        currentDate = entryDate;
        
        // Add opening balance for new day
        entriesWithBalance.push({
          date: new Date(entryDate).toISOString(),
          description: 'Day Opening Balance',
          debit: 0,
          credit: 0,
          balance: runningBalance,
          referenceType: 'Balance',
          type: 'Opening',
          isBalanceEntry: true,
          typeOrder: 0,
          _syntheticSeq: syntheticSeq++
        });
      }
      
      // Calculate new balance
      runningBalance += parseFloat(entry.inflow || '0') - parseFloat(entry.outflow || '0');
      
      // Add actual entry with computed balance
      const { inflow, outflow, ...rest } = entry as any;
      entriesWithBalance.push({
        ...rest,
        date: new Date(entry.date).toISOString(),
        debit: parseFloat(inflow || '0'),
        credit: parseFloat(outflow || '0'),
        balance: runningBalance,
        isBalanceEntry: false,
        typeOrder: 1
      });
    }
    
    // Add final closing balance if there were entries
    if (currentDate !== '') {
      entriesWithBalance.push({
        date: new Date(currentDate).toISOString(),
        description: 'Day Closing Balance',
        debit: 0,
        credit: 0,
        balance: runningBalance,
        referenceType: 'Balance',
        type: 'Closing',
        isBalanceEntry: true,
        typeOrder: 2,
        _syntheticSeq: syntheticSeq++
      });
    }
    
    // Add period boundary markers
    if (fromDate) {
      entriesWithBalance.push({
        date: getStartOfDay(fromDate).toISOString(),
        description: 'Period Opening Balance',
        debit: 0,
        credit: 0,
        balance: priorBalance,
        referenceType: 'Balance',
        type: 'Opening',
        isBalanceEntry: true,
        isBoundary: true,
        typeOrder: -1, // Sort before day opening
        _syntheticSeq: syntheticSeq++
      });
    }
    
    if (toDate) {
      entriesWithBalance.push({
        date: getEndOfDay(toDate).toISOString(),
        description: 'Period Closing Balance',
        debit: 0,
        credit: 0,
        balance: runningBalance,
        referenceType: 'Balance',
        type: 'Closing',
        isBalanceEntry: true,
        isBoundary: true,
        typeOrder: 3, // Sort after day closing
        _syntheticSeq: syntheticSeq++
      });
    }
    
    // Sort entries chronologically with stable ordering
    entriesWithBalance.sort((a, b) => {
      // 1. Extract date portion (YYYY-MM-DD) using UTC to match server-side date logic
      const dateA = new Date(a.date);
      const dateB = new Date(b.date);
      const dateStrA = `${dateA.getUTCFullYear()}-${String(dateA.getUTCMonth() + 1).padStart(2, '0')}-${String(dateA.getUTCDate()).padStart(2, '0')}`;
      const dateStrB = `${dateB.getUTCFullYear()}-${String(dateB.getUTCMonth() + 1).padStart(2, '0')}-${String(dateB.getUTCDate()).padStart(2, '0')}`;
      
      if (dateStrA !== dateStrB) {
        return dateStrA < dateStrB ? -1 : 1; // Lexicographic comparison
      }
      
      // 2. If same date, sort by typeOrder
      const orderA = a.typeOrder ?? 1;
      const orderB = b.typeOrder ?? 1;
      if (orderA !== orderB) return orderA - orderB;
      
      // 3. If same typeOrder and both are transactions (typeOrder === 1), sort by transaction timestamp
      if (orderA === 1 && orderB === 1) {
        const timeA = new Date(a.date).getTime();
        const timeB = new Date(b.date).getTime();
        if (timeA !== timeB) return timeA - timeB;
      }
      
      // 4. Then by createdAt if available
      const createdAtA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const createdAtB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      if (createdAtA !== createdAtB) return createdAtA - createdAtB;
      
      // 5. Then by id if available (for real entries)
      if (a.id && b.id) {
        // Numeric comparison if both are numbers, otherwise string comparison
        const idA = typeof a.id === 'number' ? a.id : 0;
        const idB = typeof b.id === 'number' ? b.id : 0;
        if (idA !== idB) return idA - idB;
      }
      
      // 6. Finally by synthetic sequence (for synthetic entries without id)
      const seqA = a._syntheticSeq ?? 0;
      const seqB = b._syntheticSeq ?? 0;
      return seqA - seqB;
    });
    
    // Remove synthetic sequence field before returning
    return entriesWithBalance.map(({ _syntheticSeq, ...entry }) => entry);
  }

  async getLatestCashbookEntry(tenantId: string): Promise<CashbookEntry | null> {
    const [latestEntry] = await db.select().from(cashbook)
      .where(withTenant(cashbook, tenantId))
      .orderBy(desc(cashbook.createdAt), desc(cashbook.id))
      .limit(1);
    return latestEntry || null;
  }

  static async initializeCashbook(tenantId: string, initialBalance: number): Promise<boolean> {
    try {
      return await db.transaction(async (tx) => {
        const existing = await tx.select().from(cashbook)
          .where(withTenant(cashbook, tenantId))
          .limit(1);
        if (existing.length > 0 || initialBalance <= 0) return false;
        await tx.insert(cashbook).values(ensureTenantInsert({
          date: new Date(), description: 'Opening Balance', inflow: initialBalance.toFixed(2), outflow: '0.00', balance: initialBalance.toFixed(2), referenceType: 'Opening Balance', referenceId: null,
        }, tenantId));
        
        // Initialize cash balance in tenant settings
        await TenantModel.setCashBalance(tx, tenantId, initialBalance.toFixed(2));
        return true;
      });
    } catch (error) {
      console.error('Error initializing cashbook:', error);
      return false;
    }
  }

  async getBankbook(tenantId: string, bankAccountId: string, fromDate?: string, toDate?: string): Promise<any[]> {
    // Validate date inputs
    if (fromDate && !isValidDateString(fromDate)) {
      fromDate = undefined; // Skip invalid fromDate filter
    }
    if (toDate && !isValidDateString(toDate)) {
      toDate = undefined; // Skip invalid toDate filter
    }

    // Get prior balance if fromDate is specified
    let priorBalance = 0;
    let runningBalance = 0;
    if (fromDate) {
      const priorConditions = [
        withTenant(bankbook, tenantId),
        eq(bankbook.bankAccountId, bankAccountId),
        lt(bankbook.date, getStartOfDay(fromDate))
      ];
      const priorWhereExpr = priorConditions.length > 1 ? and(...priorConditions) : priorConditions[0];
      
      const [{ priorDebit = 0, priorCredit = 0 } = {}] = await db.select({
        priorDebit: sql<number>`coalesce(sum(${bankbook.debit}::numeric),0)`,
        priorCredit: sql<number>`coalesce(sum(${bankbook.credit}::numeric),0)`
      }).from(bankbook).where(priorWhereExpr);
      
      priorBalance = Number(priorDebit) - Number(priorCredit);
      runningBalance = priorBalance;
    }
    
    // Build where conditions for main query
    const conditions = [
      withTenant(bankbook, tenantId),
      eq(bankbook.bankAccountId, bankAccountId)
    ];
    
    if (fromDate) {
      conditions.push(gte(bankbook.date, getStartOfDay(fromDate)));
    }
    
    if (toDate) {
      conditions.push(lte(bankbook.date, getEndOfDay(toDate)));
    }
    
    // Fetch entries with filtering
    const whereExpr = conditions.length > 1 ? and(...conditions) : conditions[0];
    const entries = await db.select().from(bankbook)
      .where(whereExpr)
      .orderBy(asc(bankbook.date), asc(bankbook.id));
    
    // Compute day-wise opening/closing balances
    const entriesWithBalance = [];
    let currentDate = '';
    let syntheticSeq = 0; // Sequence counter for deterministic ordering of synthetic entries
    
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      
      if (!entry.date) {
        continue;
      }
      
      let entryDate;
      try {
        const dateObj = new Date(entry.date);
        if (isNaN(dateObj.getTime())) {
          continue;
        }
        entryDate = dateObj.toISOString().split('T')[0]; // Format as YYYY-MM-DD
      } catch (error) {
        continue;
      }
      
      // Add closing balance for previous day and opening balance for new day
      if (entryDate !== currentDate) {
        if (currentDate !== '') {
          // Add closing balance for previous day
          entriesWithBalance.push({
            date: new Date(currentDate).toISOString(),
            description: 'Day Closing Balance',
            debit: 0,
            credit: 0,
            balance: runningBalance,
            referenceType: 'Balance',
            type: 'Closing',
            isBalanceEntry: true,
            bankAccountId: bankAccountId,
            typeOrder: 2,
            _syntheticSeq: syntheticSeq++
          });
        }
        
        currentDate = entryDate;
        
        // Add opening balance for new day
        entriesWithBalance.push({
          date: new Date(entryDate).toISOString(),
          description: 'Day Opening Balance',
          debit: 0,
          credit: 0,
          balance: runningBalance,
          referenceType: 'Balance',
          type: 'Opening',
          isBalanceEntry: true,
          bankAccountId: bankAccountId,
          typeOrder: 0,
          _syntheticSeq: syntheticSeq++
        });
      }
      
      // Calculate new balance
      runningBalance += parseFloat(entry.debit || '0') - parseFloat(entry.credit || '0');
      
      // Add actual entry with computed balance
      entriesWithBalance.push({
        ...entry,
        date: new Date(entry.date).toISOString(),
        debit: parseFloat(entry.debit || '0'),
        credit: parseFloat(entry.credit || '0'),
        balance: runningBalance,
        isBalanceEntry: false,
        typeOrder: 1
      });
    }
    
    // Add final closing balance if there were entries
    if (currentDate !== '') {
      entriesWithBalance.push({
        date: new Date(currentDate).toISOString(),
        description: 'Day Closing Balance',
        debit: 0,
        credit: 0,
        balance: runningBalance,
        referenceType: 'Balance',
        type: 'Closing',
        isBalanceEntry: true,
        bankAccountId: bankAccountId,
        typeOrder: 2,
        _syntheticSeq: syntheticSeq++
      });
    }
    
    // Add period boundary markers
    if (fromDate) {
      entriesWithBalance.push({
        date: getStartOfDay(fromDate).toISOString(),
        description: 'Period Opening Balance',
        debit: 0,
        credit: 0,
        balance: priorBalance,
        referenceType: 'Balance',
        type: 'Opening',
        isBalanceEntry: true,
        isBoundary: true,
        bankAccountId: bankAccountId,
        typeOrder: -1, // Sort before day opening
        _syntheticSeq: syntheticSeq++
      });
    }
    
    if (toDate) {
      entriesWithBalance.push({
        date: getEndOfDay(toDate).toISOString(),
        description: 'Period Closing Balance',
        debit: 0,
        credit: 0,
        balance: runningBalance,
        referenceType: 'Balance',
        type: 'Closing',
        isBalanceEntry: true,
        isBoundary: true,
        bankAccountId: bankAccountId,
        typeOrder: 3, // Sort after day closing
        _syntheticSeq: syntheticSeq++
      });
    }
    
    // Sort entries chronologically with stable ordering
    entriesWithBalance.sort((a, b) => {
      // 1. Extract date portion (YYYY-MM-DD) using UTC to match server-side date logic
      const dateA = new Date(a.date);
      const dateB = new Date(b.date);
      const dateStrA = `${dateA.getUTCFullYear()}-${String(dateA.getUTCMonth() + 1).padStart(2, '0')}-${String(dateA.getUTCDate()).padStart(2, '0')}`;
      const dateStrB = `${dateB.getUTCFullYear()}-${String(dateB.getUTCMonth() + 1).padStart(2, '0')}-${String(dateB.getUTCDate()).padStart(2, '0')}`;
      
      if (dateStrA !== dateStrB) {
        return dateStrA < dateStrB ? -1 : 1; // Lexicographic comparison
      }
      
      // 2. If same date, sort by typeOrder
      const orderA = a.typeOrder ?? 1;
      const orderB = b.typeOrder ?? 1;
      if (orderA !== orderB) return orderA - orderB;
      
      // 3. If same typeOrder and both are transactions (typeOrder === 1), sort by transaction timestamp
      if (orderA === 1 && orderB === 1) {
        const timeA = new Date(a.date).getTime();
        const timeB = new Date(b.date).getTime();
        if (timeA !== timeB) return timeA - timeB;
      }
      
      // 4. Then by createdAt if available
      const createdAtA = 'createdAt' in a && a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const createdAtB = 'createdAt' in b && b.createdAt ? new Date(b.createdAt).getTime() : 0;
      if (createdAtA !== createdAtB) return createdAtA - createdAtB;
      
      // 5. Then by id if available (for real entries)
      const idA = 'id' in a && a.id ? (typeof a.id === 'number' ? a.id : 0) : 0;
      const idB = 'id' in b && b.id ? (typeof b.id === 'number' ? b.id : 0) : 0;
      if (idA !== 0 && idB !== 0 && idA !== idB) return idA - idB;
      
      // 6. Finally by synthetic sequence (for synthetic entries without id)
      const seqA = a._syntheticSeq ?? 0;
      const seqB = b._syntheticSeq ?? 0;
      return seqA - seqB;
    });
    
    // Remove synthetic sequence field before returning
    return entriesWithBalance.map(({ _syntheticSeq, ...entry }) => entry);
  }

  async getVendorLedger(tenantId: string, vendorId: string, fromDate?: string, toDate?: string): Promise<VendorLedgerEntry[]> {
    // Validate date inputs
    if (fromDate && !isValidDateString(fromDate)) {
      fromDate = undefined; // Skip invalid fromDate filter
    }
    if (toDate && !isValidDateString(toDate)) {
      toDate = undefined; // Skip invalid toDate filter
    }

    // Calculate carry-forward balance if fromDate is provided
    let priorBalance = 0;
    let runningBalance = 0;
    if (fromDate) {
      // Get prior invoices
      const priorInvoices = await db.select().from(purchaseInvoices)
        .where(and(
          withTenant(purchaseInvoices, tenantId),
          eq(purchaseInvoices.vendorId, vendorId),
          lt(purchaseInvoices.invoiceDate, getStartOfDay(fromDate))
        ));
      
      // Get prior payments  
      const priorPayments = await db.select().from(payments)
        .where(and(
          withTenant(payments, tenantId),
          eq(payments.vendorId, vendorId),
          lt(payments.paymentDate, getStartOfDay(fromDate))
        ));
      
      // Calculate carry-forward balance
      const totalInvoices = priorInvoices.reduce((sum, inv) => sum + Number(inv.netAmount || '0'), 0);
      const totalPayments = priorPayments.reduce((sum, pay) => sum + Number(pay.amount || '0'), 0);
      priorBalance = totalInvoices - totalPayments;
      runningBalance = priorBalance;
    }

    // Build conditions for invoices
    const invoiceConditions = [withTenant(purchaseInvoices, tenantId), eq(purchaseInvoices.vendorId, vendorId)];
    if (fromDate) {
      invoiceConditions.push(gte(purchaseInvoices.invoiceDate, getStartOfDay(fromDate)));
    }
    if (toDate) {
      invoiceConditions.push(lte(purchaseInvoices.invoiceDate, getEndOfDay(toDate)));
    }
    const invoiceWhereExpr = invoiceConditions.length > 1 ? and(...invoiceConditions) : invoiceConditions[0];
    
    // Fetch all purchase invoices for the vendor with tenant and date filtering
    const invoices = await db.select().from(purchaseInvoices)
      .where(invoiceWhereExpr);

    // Build conditions for payments
    const paymentConditions = [withTenant(payments, tenantId), eq(payments.vendorId, vendorId)];
    if (fromDate) {
      paymentConditions.push(gte(payments.paymentDate, getStartOfDay(fromDate)));
    }
    if (toDate) {
      paymentConditions.push(lte(payments.paymentDate, getEndOfDay(toDate)));
    }
    const paymentWhereExpr = paymentConditions.length > 1 ? and(...paymentConditions) : paymentConditions[0];

    // Fetch all payments for the vendor with tenant and date filtering
    const vendorPayments = await db.select().from(payments)
      .where(paymentWhereExpr);

    // Normalize all entries into a single array
    const allEntries: (VendorLedgerEntry & { typeOrder: number })[] = [];

    // Add invoice entries (debit - increases vendor balance)
    for (const invoice of invoices) {
      allEntries.push({
        tenantId,
        date: invoice.invoiceDate,
        description: `Invoice ${invoice.invoiceNumber}`,
        referenceType: 'Invoice' as const,
        referenceId: invoice.id,
        debit: Number(invoice.netAmount || '0'),
        credit: 0,
        balance: 0, // Will be computed after sorting
        invoiceNumber: invoice.invoiceNumber,
        status: invoice.status,
        createdAt: invoice.createdAt,
        typeOrder: 1 // Transactions
      });
    }

    // Add payment entries (credit - decreases vendor balance)
    for (const payment of vendorPayments) {
      allEntries.push({
        tenantId,
        date: payment.paymentDate,
        description: `Payment - ${payment.paymentMode}`,
        referenceType: 'Payment' as const,
        referenceId: payment.id,
        debit: 0,
        credit: Number(payment.amount || '0'),
        balance: 0, // Will be computed after sorting
        paymentMode: payment.paymentMode,
        notes: payment.notes,
        createdAt: payment.createdAt,
        typeOrder: 1 // Transactions
      });
    }

    // Sort chronologically with stable tie-breakers
    allEntries.sort((a, b) => {
      // First by date
      const dateCompare = new Date(a.date).getTime() - new Date(b.date).getTime();
      if (dateCompare !== 0) return dateCompare;
      
      // Then by typeOrder
      const orderA = a.typeOrder ?? 1;
      const orderB = b.typeOrder ?? 1;
      if (orderA !== orderB) return orderA - orderB;
      
      // Finally by createdAt if available
      if (a.createdAt && b.createdAt) {
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      }
      return 0;
    });

    // Build final ledger entries array
    const ledgerEntries: (VendorLedgerEntry & { typeOrder?: number; isBoundary?: boolean })[] = [];
    
    // Compute running balances in single pass
    for (const entry of allEntries) {
      runningBalance += (entry.debit - entry.credit);
      ledgerEntries.push({
        ...entry,
        balance: runningBalance
      });
    }
    
    // Add period boundary markers
    if (fromDate) {
      ledgerEntries.push({
        tenantId,
        date: getStartOfDay(fromDate),
        description: 'Period Opening Balance',
        referenceType: 'Invoice' as const,
        referenceId: 'period-opening',
        debit: priorBalance > 0 ? priorBalance : 0,
        credit: priorBalance < 0 ? Math.abs(priorBalance) : 0,
        balance: priorBalance,
        createdAt: new Date(),
        typeOrder: -1, // Sort before all transactions
        isBoundary: true
      });
    }
    
    if (toDate) {
      ledgerEntries.push({
        tenantId,
        date: getEndOfDay(toDate),
        description: 'Period Closing Balance',
        referenceType: 'Invoice' as const,
        referenceId: 'period-closing',
        debit: runningBalance > 0 ? runningBalance : 0,
        credit: runningBalance < 0 ? Math.abs(runningBalance) : 0,
        balance: runningBalance,
        createdAt: new Date(),
        typeOrder: 3, // Sort after all transactions
        isBoundary: true
      });
    }
    
    // Final sort with boundary markers included
    ledgerEntries.sort((a, b) => {
      const dateA = new Date(a.date).getTime();
      const dateB = new Date(b.date).getTime();
      if (dateA !== dateB) return dateA - dateB;
      
      const orderA = a.typeOrder ?? 1;
      const orderB = b.typeOrder ?? 1;
      if (orderA !== orderB) return orderA - orderB;
      
      if (a.createdAt && b.createdAt) {
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      }
      return 0;
    });
    
    // Remove typeOrder from final result
    return ledgerEntries.map(({ typeOrder, isBoundary, ...entry }) => entry);
  }

  async getRetailerLedger(tenantId: string, retailerId: string, fromDate?: string, toDate?: string): Promise<RetailerLedgerEntry[]> {
    // Validate date inputs
    if (fromDate && !isValidDateString(fromDate)) {
      fromDate = undefined; // Skip invalid fromDate filter
    }
    if (toDate && !isValidDateString(toDate)) {
      toDate = undefined; // Skip invalid toDate filter
    }

    // Calculate carry-forward balance if fromDate is provided
    let carryForwardBalance = 0;
    if (fromDate) {
      // Get prior sales invoices
      const priorInvoices = await db.select().from(salesInvoices)
        .where(and(
          withTenant(salesInvoices, tenantId),
          eq(salesInvoices.retailerId, retailerId),
          lt(salesInvoices.invoiceDate, getStartOfDay(fromDate))
        ));
      
      // Get prior sales payments  
      const priorPayments = await db.select().from(salesPayments)
        .where(and(
          withTenant(salesPayments, tenantId),
          eq(salesPayments.retailerId, retailerId),
          lt(salesPayments.paymentDate, getStartOfDay(fromDate))
        ));
      
      // Calculate carry-forward balance
      const totalInvoices = priorInvoices.reduce((sum, inv) => sum + Number(inv.totalAmount || '0'), 0);
      const totalPayments = priorPayments.reduce((sum, pay) => sum + Number(pay.amount || '0'), 0);
      carryForwardBalance = totalInvoices - totalPayments;
    }

    // Build conditions for sales invoices
    const invoiceConditions = [withTenant(salesInvoices, tenantId), eq(salesInvoices.retailerId, retailerId)];
    if (fromDate) {
      invoiceConditions.push(gte(salesInvoices.invoiceDate, getStartOfDay(fromDate)));
    }
    if (toDate) {
      invoiceConditions.push(lte(salesInvoices.invoiceDate, getEndOfDay(toDate)));
    }
    const invoiceWhereExpr = invoiceConditions.length > 1 ? and(...invoiceConditions) : invoiceConditions[0];

    // Fetch all sales invoices for the retailer with tenant and date filtering
    const invoices = await db.select().from(salesInvoices)
      .where(invoiceWhereExpr);

    // Build conditions for sales payments
    const paymentConditions = [withTenant(salesPayments, tenantId), eq(salesPayments.retailerId, retailerId)];
    if (fromDate) {
      paymentConditions.push(gte(salesPayments.paymentDate, getStartOfDay(fromDate)));
    }
    if (toDate) {
      paymentConditions.push(lte(salesPayments.paymentDate, getEndOfDay(toDate)));
    }
    const paymentWhereExpr = paymentConditions.length > 1 ? and(...paymentConditions) : paymentConditions[0];

    // Fetch all sales payments for the retailer with tenant and date filtering
    const retailerPayments = await db.select().from(salesPayments)
      .where(paymentWhereExpr);

    // Normalize all entries into a single array
    const allEntries: (RetailerLedgerEntry & { typeOrder: number })[] = [];

    // Add invoice entries (debit - increases retailer balance owed to us)
    for (const invoice of invoices) {
      allEntries.push({
        tenantId,
        date: invoice.invoiceDate,
        description: `Sales Invoice ${invoice.invoiceNumber}`,
        referenceType: 'Sales Invoice' as const,
        referenceId: invoice.id,
        debit: Number(invoice.totalAmount || '0'), // Use totalAmount matching the debit display
        credit: 0,
        balance: 0, // Will be computed after sorting
        invoiceNumber: invoice.invoiceNumber,
        status: invoice.status,
        createdAt: invoice.createdAt,
        typeOrder: 1 // Invoice comes first for same date
      });
    }

    // Add payment entries (credit - decreases retailer balance)
    for (const payment of retailerPayments) {
      allEntries.push({
        tenantId,
        date: payment.paymentDate,
        description: `Payment Received - ${payment.paymentMode}`,
        referenceType: 'Sales Payment' as const,  
        referenceId: payment.id,
        debit: 0,
        credit: Number(payment.amount || '0'),
        balance: 0, // Will be computed after sorting
        paymentMode: payment.paymentMode,
        notes: payment.notes,
        createdAt: payment.createdAt,
        typeOrder: 2 // Payment comes after Invoice for same date
      });
    }

    // Sort chronologically with stable tie-breakers
    allEntries.sort((a, b) => {
      // First by date
      const dateCompare = new Date(a.date).getTime() - new Date(b.date).getTime();
      if (dateCompare !== 0) return dateCompare;
      
      // Then by createdAt if available
      if (a.createdAt && b.createdAt) {
        const createdAtCompare = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        if (createdAtCompare !== 0) return createdAtCompare;
      }
      
      // Finally by type order (Invoice < Payment)
      return a.typeOrder - b.typeOrder;
    });

    // Compute running balances in single pass
    let runningBalance = carryForwardBalance;
    let priorBalance = carryForwardBalance;
    
    // Build final ledger entries array
    const ledgerEntries: (RetailerLedgerEntry & { typeOrder?: number; isBoundary?: boolean })[] = [];
    
    // Process entries and compute balances
    for (const entry of allEntries) {
      // Update monetary running balance
      runningBalance += (entry.debit - entry.credit);
      
      ledgerEntries.push({
        ...entry,
        balance: runningBalance
      });
    }
    
    // Add period boundary markers
    if (fromDate) {
      // Monetary period opening
      ledgerEntries.push({
        tenantId,
        date: getStartOfDay(fromDate),
        description: 'Period Opening Balance',
        referenceType: 'Sales Invoice' as const,
        referenceId: 'period-opening-monetary',
        debit: priorBalance > 0 ? priorBalance : 0,
        credit: priorBalance < 0 ? Math.abs(priorBalance) : 0,
        balance: priorBalance,
        createdAt: new Date(),
        typeOrder: -1, // Sort before all transactions
        isBoundary: true
      });
    }
    
    if (toDate) {
      // Monetary period closing
      ledgerEntries.push({
        tenantId,
        date: getEndOfDay(toDate),
        description: 'Period Closing Balance',
        referenceType: 'Sales Invoice' as const,
        referenceId: 'period-closing-monetary',
        debit: runningBalance > 0 ? runningBalance : 0,
        credit: runningBalance < 0 ? Math.abs(runningBalance) : 0,
        balance: runningBalance,
        createdAt: new Date(),
        typeOrder: 3, // Sort after all transactions
        isBoundary: true
      });
    }
    
    // Final sort with boundary markers included
    ledgerEntries.sort((a, b) => {
      const dateA = new Date(a.date).getTime();
      const dateB = new Date(b.date).getTime();
      if (dateA !== dateB) return dateA - dateB;
      
      const orderA = a.typeOrder ?? 1;
      const orderB = b.typeOrder ?? 1;
      if (orderA !== orderB) return orderA - orderB;
      
      if (a.createdAt && b.createdAt) {
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      }
      return 0;
    });
    
    // Remove helper fields from final result
    return ledgerEntries.map(({ typeOrder, isBoundary, ...entry }) => entry);
  }

  async getUdhaaarBook(tenantId: string): Promise<UdhaaarBookEntry[]> {
    // Get all active retailers with tenant filtering
    const allRetailers = await db.select().from(retailers)
      .where(withTenant(retailers, tenantId, eq(retailers.isActive, true)))
      .orderBy(asc(retailers.name));

    // Filter retailers with non-zero udhaar balance
    const udhaaarEntries = allRetailers
      .filter(retailer => {
        const balance = parseFloat(retailer.udhaaarBalance || '0');
        return balance !== 0;
      })
      .map(retailer => {
        const balanceValue = parseFloat(retailer.udhaaarBalance || '0');
        return {
          tenantId,
          retailerId: retailer.id,
          retailerName: retailer.name,
          phone: retailer.phone,
          address: retailer.address,
          udhaarBalance: balanceValue,
          udhaaarBalance: balanceValue, // Keep legacy field for backward compatibility
          totalBalance: parseFloat(retailer.balance || '0'),
          shortfallBalance: parseFloat(retailer.shortfallBalance || '0'),
          crateBalance: retailer.crateBalance || 0,
          isActive: retailer.isActive,
          createdAt: retailer.createdAt
        };
      });

    return udhaaarEntries;
  }

  async getCrateLedger(tenantId: string, retailerId?: string, fromDate?: string, toDate?: string): Promise<CrateLedgerEntry[]> {
    // Validate date inputs
    if (fromDate && !isValidDateString(fromDate)) {
      fromDate = undefined; // Skip invalid fromDate filter
    }
    if (toDate && !isValidDateString(toDate)) {
      toDate = undefined; // Skip invalid toDate filter
    }

    // Calculate carry-forward balance if fromDate is provided (for both retailer-specific and global views)
    let priorBalance = 0;
    let runningBalance = 0;
    if (fromDate) {
      const priorConditions = [
        withTenant(crateTransactions, tenantId),
        lt(crateTransactions.transactionDate, getStartOfDay(fromDate))
      ];
      
      // Add retailer filter if specified
      if (retailerId) {
        priorConditions.push(eq(crateTransactions.retailerId, retailerId));
      }
      
      const priorWhereExpr = priorConditions.length > 1 ? and(...priorConditions) : priorConditions[0];
      const priorTransactions = await db.select().from(crateTransactions)
        .where(priorWhereExpr);
      
      priorBalance = priorTransactions.reduce((sum, trans) => {
        return sum + (trans.transactionType === 'Given' ? trans.quantity : -trans.quantity);
      }, 0);
      
      runningBalance = priorBalance;
    }

    // Build conditions array for WHERE clause
    const conditions = [
      withTenant(crateTransactions, tenantId)
    ];
    
    if (retailerId) {
      conditions.push(eq(crateTransactions.retailerId, retailerId));
    }
    
    if (fromDate) {
      conditions.push(gte(crateTransactions.transactionDate, getStartOfDay(fromDate)));
    }
    
    if (toDate) {
      conditions.push(lte(crateTransactions.transactionDate, getEndOfDay(toDate)));
    }
    
    const whereExpr = conditions.length > 1 ? and(...conditions) : conditions[0];

    const transactions = await db.select({
      id: crateTransactions.id,
      retailerId: crateTransactions.retailerId,
      retailerName: retailers.name,
      phone: retailers.phone,
      transactionType: crateTransactions.transactionType,
      quantity: crateTransactions.quantity,
      transactionDate: crateTransactions.transactionDate,
      notes: crateTransactions.notes,
      createdAt: crateTransactions.createdAt
    })
    .from(crateTransactions)
    .leftJoin(retailers, and(
      eq(crateTransactions.retailerId, retailers.id),
      withTenant(retailers, tenantId)
    ))
    .where(whereExpr)
    .orderBy(asc(crateTransactions.transactionDate), asc(crateTransactions.createdAt), asc(crateTransactions.id));

    // Build final ledger entries array with typeOrder for sorting
    const ledgerEntries: (CrateLedgerEntry & { typeOrder?: number; isBoundary?: boolean })[] = [];
    
    // Process transactions and compute running balance
    for (const transaction of transactions) {
      if (transaction.retailerId === null) continue; // Skip null retailerIds
      
      // Calculate new balance based on transaction type
      if (transaction.transactionType === 'Given') {
        runningBalance += transaction.quantity;
      } else if (transaction.transactionType === 'Received') {
        runningBalance -= transaction.quantity;
      }

      ledgerEntries.push({
        tenantId,
        id: transaction.id,
        retailerId: transaction.retailerId,
        retailerName: transaction.retailerName || '',
        phone: transaction.phone || '',
        transactionType: transaction.transactionType,
        quantity: transaction.quantity,
        depositAmount: 0, // No depositAmount field in schema
        transactionDate: transaction.transactionDate,
        notes: transaction.notes || '',
        runningBalance: runningBalance,
        createdAt: transaction.createdAt,
        typeOrder: 1 // Transactions
      });
    }
    
    // Add period boundary markers when date filters are provided (regardless of retailerId)
    if (fromDate) {
      ledgerEntries.push({
        tenantId,
        id: 'period-opening',
        retailerId: retailerId || '', // Empty string for global view
        retailerName: 'Period Opening Balance',
        phone: '',
        transactionType: priorBalance >= 0 ? 'Given' : 'Received',
        quantity: Math.abs(priorBalance),
        depositAmount: 0,
        transactionDate: getStartOfDay(fromDate),
        notes: 'Period Opening Balance',
        runningBalance: priorBalance,
        createdAt: new Date(),
        typeOrder: -1, // Sort before all transactions
        isBoundary: true
      });
    }
    
    if (toDate) {
      ledgerEntries.push({
        tenantId,
        id: 'period-closing',
        retailerId: retailerId || '', // Empty string for global view
        retailerName: 'Period Closing Balance',
        phone: '',
        transactionType: runningBalance >= 0 ? 'Given' : 'Received',
        quantity: Math.abs(runningBalance),
        depositAmount: 0,
        transactionDate: getEndOfDay(toDate),
        notes: 'Period Closing Balance',
        runningBalance: runningBalance,
        createdAt: new Date(),
        typeOrder: 3, // Sort after all transactions
        isBoundary: true
      });
    }
    
    // Final sort with boundary markers included
    ledgerEntries.sort((a, b) => {
      const dateA = new Date(a.transactionDate).getTime();
      const dateB = new Date(b.transactionDate).getTime();
      if (dateA !== dateB) return dateA - dateB;
      
      const orderA = a.typeOrder ?? 1;
      const orderB = b.typeOrder ?? 1;
      if (orderA !== orderB) return orderA - orderB;
      
      if (a.createdAt && b.createdAt) {
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      }
      return 0;
    });
    
    // Remove helper fields from final result
    return ledgerEntries.map(({ typeOrder, isBoundary, ...entry }) => entry);
  }

  async getAllBankAccountsSummary(tenantId: string, fromDate?: string, toDate?: string): Promise<BankAccountSummary[]> {
    // Build conditions for aggregation query
    const aggregationConditions = [withTenant(bankbook, tenantId)];
    
    if (fromDate) {
      aggregationConditions.push(gte(bankbook.date, getStartOfDay(fromDate)));
    }
    
    if (toDate) {
      aggregationConditions.push(lte(bankbook.date, getEndOfDay(toDate)));
    }
    
    const aggregationWhereExpr = aggregationConditions.length > 1 
      ? and(...aggregationConditions) 
      : aggregationConditions[0];

    // Single grouped query to aggregate all bank account transactions
    const aggregatedData = await db
      .select({
        bankAccountId: bankbook.bankAccountId,
        totalDebits: sql<number>`coalesce(sum(${bankbook.debit}::numeric), 0)`,
        totalCredits: sql<number>`coalesce(sum(${bankbook.credit}::numeric), 0)`,
        transactionCount: sql<number>`count(*)`
      })
      .from(bankbook)
      .where(aggregationWhereExpr)
      .groupBy(bankbook.bankAccountId);

    // Create a map for quick lookup of aggregated data
    const aggregationMap = new Map(
      aggregatedData.map(agg => [
        agg.bankAccountId, 
        {
          totalDebits: Number(agg.totalDebits),
          totalCredits: Number(agg.totalCredits),
          transactionCount: Number(agg.transactionCount)
        }
      ])
    );

    // Fetch all active bank accounts for the tenant
    const accounts = await db
      .select()
      .from(bankAccounts)
      .where(withTenant(bankAccounts, tenantId, eq(bankAccounts.isActive, true)))
      .orderBy(asc(bankAccounts.bankName));

    // Map accounts to summary, joining with aggregated data
    const summaries: BankAccountSummary[] = accounts.map(account => {
      const aggregated = aggregationMap.get(account.id) || {
        totalDebits: 0,
        totalCredits: 0,
        transactionCount: 0
      };

      return {
        bankAccountId: account.id,
        bankName: account.bankName,
        accountNumber: account.accountNumber,
        accountHolderName: account.name,
        totalDebits: aggregated.totalDebits,
        totalCredits: aggregated.totalCredits,
        currentBalance: account.balance ?? '0.00',
        transactionCount: aggregated.transactionCount
      };
    });

    return summaries;
  }

  async getAllVendorsSummary(tenantId: string, fromDate?: string, toDate?: string): Promise<VendorSummary[]> {
    // Validate date inputs
    if (fromDate && !isValidDateString(fromDate)) {
      fromDate = undefined;
    }
    if (toDate && !isValidDateString(toDate)) {
      toDate = undefined;
    }

    // Build conditions for purchase invoices aggregation
    const invoiceConditions = [withTenant(purchaseInvoices, tenantId)];
    if (fromDate) {
      invoiceConditions.push(gte(purchaseInvoices.invoiceDate, getStartOfDay(fromDate)));
    }
    if (toDate) {
      invoiceConditions.push(lte(purchaseInvoices.invoiceDate, getEndOfDay(toDate)));
    }
    const invoiceWhereExpr = invoiceConditions.length > 1 
      ? and(...invoiceConditions) 
      : invoiceConditions[0];

    // Aggregate purchase invoices by vendor
    const invoiceData = await db
      .select({
        vendorId: purchaseInvoices.vendorId,
        totalInvoices: sql<number>`coalesce(sum(${purchaseInvoices.netAmount}::numeric), 0)`,
        invoiceCount: sql<number>`count(*)`,
        lastInvoiceDate: sql<Date>`max(${purchaseInvoices.invoiceDate})`
      })
      .from(purchaseInvoices)
      .where(invoiceWhereExpr)
      .groupBy(purchaseInvoices.vendorId);

    // Build conditions for payments aggregation
    const paymentConditions = [
      withTenant(payments, tenantId),
      isNotNull(payments.vendorId)
    ];
    if (fromDate) {
      paymentConditions.push(gte(payments.paymentDate, getStartOfDay(fromDate)));
    }
    if (toDate) {
      paymentConditions.push(lte(payments.paymentDate, getEndOfDay(toDate)));
    }
    const paymentWhereExpr = paymentConditions.length > 1 
      ? and(...paymentConditions) 
      : paymentConditions[0];

    // Aggregate payments by vendor
    const paymentData = await db
      .select({
        vendorId: payments.vendorId,
        totalPayments: sql<number>`coalesce(sum(${payments.amount}::numeric), 0)`
      })
      .from(payments)
      .where(paymentWhereExpr)
      .groupBy(payments.vendorId);

    // Create aggregation maps for quick lookup
    const invoiceMap = new Map(
      invoiceData.map(inv => [
        inv.vendorId,
        {
          totalInvoices: Number(inv.totalInvoices),
          invoiceCount: Number(inv.invoiceCount),
          lastInvoiceDate: inv.lastInvoiceDate
        }
      ])
    );

    const paymentMap = new Map(
      paymentData.map(pay => [
        pay.vendorId,
        Number(pay.totalPayments)
      ])
    );

    // Fetch all active vendors
    const activeVendors = await db
      .select()
      .from(vendors)
      .where(withTenant(vendors, tenantId, eq(vendors.isActive, true)))
      .orderBy(asc(vendors.name));

    // Map vendors to summary objects
    const summaries: VendorSummary[] = activeVendors.map(vendor => {
      const invoiceInfo = invoiceMap.get(vendor.id) || {
        totalInvoices: 0,
        invoiceCount: 0,
        lastInvoiceDate: null
      };
      const totalPayments = paymentMap.get(vendor.id) || 0;

      return {
        vendorId: vendor.id,
        vendorName: vendor.name,
        phone: vendor.phone,
        address: vendor.address,
        totalInvoices: invoiceInfo.totalInvoices,
        totalPayments: totalPayments,
        currentBalance: vendor.balance ?? '0.00',
        invoiceCount: invoiceInfo.invoiceCount,
        lastInvoiceDate: invoiceInfo.lastInvoiceDate
      };
    });

    return summaries;
  }

  async getAllRetailersSummary(tenantId: string, fromDate?: string, toDate?: string): Promise<RetailerSummary[]> {
    // Validate date inputs
    if (fromDate && !isValidDateString(fromDate)) {
      fromDate = undefined;
    }
    if (toDate && !isValidDateString(toDate)) {
      toDate = undefined;
    }

    // Build conditions for sales invoices aggregation
    const salesConditions = [withTenant(salesInvoices, tenantId)];
    if (fromDate) {
      salesConditions.push(gte(salesInvoices.invoiceDate, getStartOfDay(fromDate)));
    }
    if (toDate) {
      salesConditions.push(lte(salesInvoices.invoiceDate, getEndOfDay(toDate)));
    }
    const salesWhereExpr = salesConditions.length > 1 
      ? and(...salesConditions) 
      : salesConditions[0];

    // Aggregate sales invoices by retailer
    const salesData = await db
      .select({
        retailerId: salesInvoices.retailerId,
        totalSales: sql<number>`coalesce(sum(${salesInvoices.totalAmount}::numeric), 0)`,
        invoiceCount: sql<number>`count(*)`,
        lastSaleDate: sql<Date>`max(${salesInvoices.invoiceDate})`
      })
      .from(salesInvoices)
      .where(salesWhereExpr)
      .groupBy(salesInvoices.retailerId);

    // Build conditions for sales payments aggregation
    const paymentConditions = [
      withTenant(salesPayments, tenantId),
      isNotNull(salesPayments.retailerId)
    ];
    if (fromDate) {
      paymentConditions.push(gte(salesPayments.paymentDate, getStartOfDay(fromDate)));
    }
    if (toDate) {
      paymentConditions.push(lte(salesPayments.paymentDate, getEndOfDay(toDate)));
    }
    const paymentWhereExpr = paymentConditions.length > 1 
      ? and(...paymentConditions) 
      : paymentConditions[0];

    // Aggregate sales payments by retailer
    const paymentData = await db
      .select({
        retailerId: salesPayments.retailerId,
        totalPayments: sql<number>`coalesce(sum(${salesPayments.amount}::numeric), 0)`
      })
      .from(salesPayments)
      .where(paymentWhereExpr)
      .groupBy(salesPayments.retailerId);

    // Create aggregation maps for quick lookup
    const salesMap = new Map(
      salesData.map(sale => [
        sale.retailerId,
        {
          totalSales: Number(sale.totalSales),
          invoiceCount: Number(sale.invoiceCount),
          lastSaleDate: sale.lastSaleDate
        }
      ])
    );

    const paymentMap = new Map(
      paymentData.map(pay => [
        pay.retailerId,
        Number(pay.totalPayments)
      ])
    );

    // Fetch all active retailers
    const activeRetailers = await db
      .select()
      .from(retailers)
      .where(withTenant(retailers, tenantId, eq(retailers.isActive, true)))
      .orderBy(asc(retailers.name));

    // Map retailers to summary objects
    const summaries: RetailerSummary[] = activeRetailers.map(retailer => {
      const salesInfo = salesMap.get(retailer.id) || {
        totalSales: 0,
        invoiceCount: 0,
        lastSaleDate: null
      };
      const totalPayments = paymentMap.get(retailer.id) || 0;

      return {
        retailerId: retailer.id,
        retailerName: retailer.name,
        phone: retailer.phone,
        address: retailer.address,
        totalSales: salesInfo.totalSales,
        totalPayments: totalPayments,
        udhaaarBalance: retailer.udhaaarBalance ?? '0.00',
        shortfallBalance: retailer.shortfallBalance ?? '0.00',
        invoiceCount: salesInfo.invoiceCount,
        lastSaleDate: salesInfo.lastSaleDate
      };
    });

    return summaries;
  }

  // Helper methods for validation
  async getVendorById(tenantId: string, vendorId: string): Promise<any> {
    const [vendor] = await db.select().from(vendors)
      .where(withTenant(vendors, tenantId, eq(vendors.id, vendorId)));
    return vendor;
  }

  async getRetailerById(tenantId: string, retailerId: string): Promise<any> {
    const [retailer] = await db.select().from(retailers)
      .where(withTenant(retailers, tenantId, eq(retailers.id, retailerId)));
    return retailer;
  }

  async getBankAccountById(tenantId: string, bankAccountId: string): Promise<any> {
    const [bankAccount] = await db.select().from(bankAccounts)
      .where(withTenant(bankAccounts, tenantId, eq(bankAccounts.id, bankAccountId)));
    return bankAccount;
  }

  async getBankAccountStats(tenantId: string): Promise<{ totalAccounts: number; totalBalance: string }> {
    const bankAccountModel = new BankAccountModel();
    return await bankAccountModel.getBankAccountStats(tenantId);
  }
}