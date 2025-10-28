import { sum, gte, lte, and, sql, eq, desc, count, asc } from 'drizzle-orm';
import { db } from '../../../db';

const { 
  salesInvoices, 
  purchaseInvoices, 
  expenses,
  vendors,
  retailers,
  expenseCategories
} = schema;
import { withTenant } from '../../utils/tenant-scope';
import { TenantModel } from '../tenants/model';
import schema from '../../../shared/schema';

type TurnoverReportData = typeof schema.TurnoverReportData;
type ProfitLossReportData = typeof schema.ProfitLossReportData;
type CommissionReportData = typeof schema.CommissionReportData;
type CommissionReportEntry = typeof schema.CommissionReportEntry;
type ShortfallReportEntry = typeof schema.ShortfallReportEntry;
type ShortfallReportData = typeof schema.ShortfallReportData;
type ExpensesSummaryEntry = typeof schema.ExpensesSummaryEntry;
type ExpensesSummaryData = typeof schema.ExpensesSummaryData;
type VendorListEntry = typeof schema.VendorListEntry;
type VendorsListData = typeof schema.VendorsListData;
type RetailerListEntry = typeof schema.RetailerListEntry;
type RetailersListData = typeof schema.RetailersListData;

export class ReportModel {
  async getTurnoverReport(tenantId: string, fromDate?: string, toDate?: string): Promise<TurnoverReportData> {
    // Handle inclusive end-date by setting to end-of-day
    let endDate: Date | undefined;
    if (toDate) {
      endDate = new Date(toDate);
      endDate.setHours(23, 59, 59, 999);
    }

    // Build conditions for sales query
    const salesConditions = [withTenant(salesInvoices, tenantId)];
    if (fromDate) {
      salesConditions.push(gte(salesInvoices.invoiceDate, new Date(fromDate)));
    }
    if (endDate) {
      salesConditions.push(lte(salesInvoices.invoiceDate, endDate));
    }

    // Build conditions for purchases query
    const purchaseConditions = [withTenant(purchaseInvoices, tenantId)];
    if (fromDate) {
      purchaseConditions.push(gte(purchaseInvoices.invoiceDate, new Date(fromDate)));
    }
    if (endDate) {
      purchaseConditions.push(lte(purchaseInvoices.invoiceDate, endDate));
    }

    // Query total sales
    const [salesResult] = await db
      .select({ total: sum(salesInvoices.totalAmount) })
      .from(salesInvoices)
      .where(salesConditions.length > 1 ? and(...salesConditions) : salesConditions[0]);

    // Query total purchases
    const [purchaseResult] = await db
      .select({ total: sum(purchaseInvoices.netAmount) })
      .from(purchaseInvoices)
      .where(purchaseConditions.length > 1 ? and(...purchaseConditions) : purchaseConditions[0]);

    const totalSales = Number(salesResult?.total || '0');
    const totalPurchases = Number(purchaseResult?.total || '0');
    const netTurnover = totalSales - totalPurchases;

    return {
      entries: [], // Empty for now as daily breakdown not required
      totalSales: totalSales.toFixed(2),
      totalPurchases: totalPurchases.toFixed(2),
      netTurnover: netTurnover.toFixed(2),
      fromDate,
      toDate
    };
  }

  async getProfitLossReport(tenantId: string, fromDate?: string, toDate?: string): Promise<ProfitLossReportData> {
    // Handle inclusive end-date by setting to end-of-day
    let endDate: Date | undefined;
    if (toDate) {
      endDate = new Date(toDate);
      endDate.setHours(23, 59, 59, 999);
    }

    // Build conditions for sales query
    const salesConditions = [withTenant(salesInvoices, tenantId)];
    if (fromDate) {
      salesConditions.push(gte(salesInvoices.invoiceDate, new Date(fromDate)));
    }
    if (endDate) {
      salesConditions.push(lte(salesInvoices.invoiceDate, endDate));
    }

    // Build conditions for purchases query
    const purchaseConditions = [withTenant(purchaseInvoices, tenantId)];
    if (fromDate) {
      purchaseConditions.push(gte(purchaseInvoices.invoiceDate, new Date(fromDate)));
    }
    if (endDate) {
      purchaseConditions.push(lte(purchaseInvoices.invoiceDate, endDate));
    }

    // Build conditions for expenses query
    const expenseConditions = [withTenant(expenses, tenantId)];
    if (fromDate) {
      expenseConditions.push(gte(expenses.paymentDate, new Date(fromDate)));
    }
    if (endDate) {
      expenseConditions.push(lte(expenses.paymentDate, endDate));
    }

    // Query total sales (revenue)
    const [salesResult] = await db
      .select({ total: sum(salesInvoices.totalAmount) })
      .from(salesInvoices)
      .where(salesConditions.length > 1 ? and(...salesConditions) : salesConditions[0]);

    // Query total purchases (costs)
    const [purchaseResult] = await db
      .select({ total: sum(purchaseInvoices.netAmount) })
      .from(purchaseInvoices)
      .where(purchaseConditions.length > 1 ? and(...purchaseConditions) : purchaseConditions[0]);

    // Query total expenses
    const [expenseResult] = await db
      .select({ total: sum(expenses.amount) })
      .from(expenses)
      .where(expenseConditions.length > 1 ? and(...expenseConditions) : expenseConditions[0]);

    const revenue = Number(salesResult?.total || '0');
    const costs = Number(purchaseResult?.total || '0');
    const totalExpenses = Number(expenseResult?.total || '0');
    const grossProfit = revenue - costs;
    const netProfit = grossProfit - totalExpenses;

    return {
      revenue: revenue.toFixed(2),
      costs: costs.toFixed(2),
      grossProfit: grossProfit.toFixed(2),
      expenses: totalExpenses.toFixed(2),
      netProfit: netProfit.toFixed(2),
      fromDate,
      toDate
    };
  }

  async getCommissionReport(tenantId: string, fromDate?: string, toDate?: string): Promise<CommissionReportData> {
    // Handle inclusive end-date by setting to end-of-day
    let endDate: Date | undefined;
    if (toDate) {
      endDate = new Date(toDate);
      endDate.setHours(23, 59, 59, 999);
    }

    // Build conditions for purchase query with vendor join - both tables must be tenant-scoped
    const conditions = [
      withTenant(purchaseInvoices, tenantId),
      withTenant(vendors, tenantId)
    ];
    if (fromDate) {
      conditions.push(gte(purchaseInvoices.invoiceDate, new Date(fromDate)));
    }
    if (endDate) {
      conditions.push(lte(purchaseInvoices.invoiceDate, endDate));
    }

    // Query purchase invoices with vendor details
    const invoiceResults = await db
      .select({
        invoiceNumber: purchaseInvoices.invoiceNumber,
        invoiceDate: purchaseInvoices.invoiceDate,
        vendorName: vendors.name,
        netAmount: purchaseInvoices.netAmount,
        totalSelling: purchaseInvoices.totalSelling,
        commission: purchaseInvoices.commission
      })
      .from(purchaseInvoices)
      .innerJoin(vendors, eq(purchaseInvoices.vendorId, vendors.id))
      .where(and(...conditions));

    // Map results to commission entries
    const entries: CommissionReportEntry[] = invoiceResults.map(invoice => {
      const netAmount = Number(invoice.netAmount || '0');
      const totalSelling = Number(invoice.totalSelling || '0');
      const commission = Number(invoice.commission || '0');
      const commissionRate = totalSelling > 0 ? (commission / totalSelling) * 100 : 0;
      
      return {
        invoiceNumber: invoice.invoiceNumber,
        invoiceDate: invoice.invoiceDate.toISOString(),
        vendorName: invoice.vendorName,
        retailerName: invoice.vendorName, // Backward compatibility alias
        totalAmount: netAmount.toFixed(2),
        commissionRate: commissionRate.toFixed(2),
        commissionAmount: commission.toFixed(2)
      };
    });

    // Calculate total commission
    const totalCommission = entries.reduce((sum, entry) => sum + Number(entry.commissionAmount), 0);

    return {
      entries,
      totalCommission: totalCommission.toFixed(2),
      fromDate,
      toDate
    };
  }

  async getShortfallReport(tenantId: string, fromDate?: string, toDate?: string): Promise<ShortfallReportData> {
    // Handle inclusive end-date by setting to end-of-day
    let endDate: Date | undefined;
    if (toDate) {
      endDate = new Date(toDate);
      endDate.setHours(23, 59, 59, 999);
    }

    // Query retailers with shortfall balance > 0 and their last transaction date
    const retailerResults = await db
      .select({
        retailerId: retailers.id,
        retailerName: retailers.name,
        shortfallBalance: retailers.shortfallBalance,
        lastTransactionDate: sql<Date | null>`(
          SELECT MAX(${salesInvoices.invoiceDate}) 
          FROM ${salesInvoices} 
          WHERE ${salesInvoices.retailerId} = ${retailers.id} 
          AND ${salesInvoices.tenantId} = ${tenantId}
        )`
      })
      .from(retailers)
      .where(and(
        withTenant(retailers, tenantId),
        sql`${retailers.shortfallBalance} > 0`
      ))
      .orderBy(desc(retailers.shortfallBalance));

    // Filter results by date range if provided
    let filteredResults = retailerResults;
    if (fromDate || endDate) {
      filteredResults = retailerResults.filter(retailer => {
        if (!retailer.lastTransactionDate) return false; // Exclude retailers with no transactions when date filtering
        const lastTxDate = retailer.lastTransactionDate;
        
        if (fromDate && lastTxDate < new Date(fromDate)) return false;
        if (endDate && lastTxDate > endDate) return false;
        
        return true;
      });
    }

    // Map results to shortfall entries
    const entries: ShortfallReportEntry[] = filteredResults.map(retailer => ({
      retailerId: retailer.retailerId,
      retailerName: retailer.retailerName,
      shortfallBalance: Number(retailer.shortfallBalance || '0').toFixed(2),
      lastTransactionDate: retailer.lastTransactionDate ? retailer.lastTransactionDate.toISOString() : ''
    }));

    // Calculate total shortfall
    const totalShortfall = entries.reduce((sum, entry) => sum + Number(entry.shortfallBalance), 0);

    return {
      entries,
      totalShortfall: totalShortfall.toFixed(2),
      fromDate,
      toDate
    };
  }

  async getExpensesSummary(tenantId: string, fromDate?: string, toDate?: string): Promise<ExpensesSummaryData> {
    // Handle inclusive end-date by setting to end-of-day
    let endDate: Date | undefined;
    if (toDate) {
      endDate = new Date(toDate);
      endDate.setHours(23, 59, 59, 999);
    }

    // Build date filter conditions
    // Note: expenseCategories are tenant-scoped (have tenantId field) for referential integrity
    const conditions = [withTenant(expenses, tenantId), withTenant(expenseCategories, tenantId)];
    if (fromDate) {
      conditions.push(gte(expenses.paymentDate, new Date(fromDate)));
    }
    if (endDate) {
      conditions.push(lte(expenses.paymentDate, endDate));
    }

    // Query expenses grouped by category
    const expenseResults = await db
      .select({
        categoryId: expenses.categoryId,
        categoryName: expenseCategories.name,
        totalAmount: sum(expenses.amount),
        count: count()
      })
      .from(expenses)
      .innerJoin(expenseCategories, eq(expenses.categoryId, expenseCategories.id))
      .where(and(...conditions))
      .groupBy(expenses.categoryId, expenseCategories.name);

    // Calculate total expenses
    const totalExpenses = expenseResults.reduce((sum, result) => sum + Number(result.totalAmount || '0'), 0);

    // Map results to expenses summary entries
    const entries: ExpensesSummaryEntry[] = expenseResults.map(result => {
      const amount = Number(result.totalAmount || '0');
      const percentage = totalExpenses > 0 ? (amount / totalExpenses) * 100 : 0;
      
      return {
        category: result.categoryName,
        amount: amount.toFixed(2),
        count: Number(result.count),
        percentage: percentage.toFixed(2)
      };
    });

    return {
      entries,
      totalExpenses: totalExpenses.toFixed(2),
      fromDate,
      toDate
    };
  }

  async getVendorsList(tenantId: string): Promise<VendorsListData> {
    // Query all active vendors ordered by balance descending (keeping name as secondary sort)
    const vendorResults = await db
      .select()
      .from(vendors)
      .where(and(
        withTenant(vendors, tenantId),
        eq(vendors.isActive, true)
      ))
      .orderBy(desc(vendors.balance), asc(vendors.name));

    // Map results to vendor list entries
    const entries: VendorListEntry[] = vendorResults.map(vendor => ({
      vendorId: vendor.id,
      vendorName: vendor.name,
      phone: vendor.phone || '',
      address: vendor.address || '',
      balance: Number(vendor.balance || '0').toFixed(2)
    }));

    // Calculate total payable
    const totalPayable = entries.reduce((sum, entry) => sum + Number(entry.balance), 0);

    return {
      entries,
      totalPayable: totalPayable.toFixed(2)
    };
  }

  async getRetailersList(tenantId: string): Promise<RetailersListData> {
    // Query all active retailers ordered by udhaaar balance descending (keeping name as secondary sort)
    const retailerResults = await db
      .select()
      .from(retailers)
      .where(and(
        withTenant(retailers, tenantId),
        eq(retailers.isActive, true)
      ))
      .orderBy(desc(retailers.udhaaarBalance), asc(retailers.name));

    // Map results to retailer list entries
    const entries: RetailerListEntry[] = retailerResults.map(retailer => ({
      retailerId: retailer.id,
      retailerName: retailer.name,
      phone: retailer.phone || '',
      address: retailer.address || '',
      udhaaarBalance: Number(retailer.udhaaarBalance || '0').toFixed(2)
    }));

    // Calculate total receivable
    const totalReceivable = entries.reduce((sum, entry) => sum + Number(entry.udhaaarBalance), 0);

    return {
      entries,
      totalReceivable: totalReceivable.toFixed(2)
    };
  }
}