import { eq, sum, gte, lte, inArray, desc, and, asc, sql } from 'drizzle-orm';
import { db } from '../../../db';
import schema from '../../../shared/schema.js';

const { vendors, retailers, purchaseInvoices, salesInvoices, tenants, expenses } = schema;

type DashboardKPIs = typeof schema.DashboardKPIs;
type RecentPurchase = typeof schema.RecentPurchase;
type RecentSale = typeof schema.RecentSale;
type FavouriteRetailer = typeof schema.FavouriteRetailer;
type FavouriteVendor = typeof schema.FavouriteVendor;
import { withTenant } from '../../utils/tenant-scope';
import { TenantModel } from '../tenants/model';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';

export class DashboardModel {
  async getDashboardKPIs(tenantId: string): Promise<DashboardKPIs> {
    // Get tenant settings to retrieve timezone
    const tenant = await db.select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    
    const tenantTimezone = (tenant[0]?.settings as any)?.timezone || 'Asia/Kolkata';
    
    // Calculate today's date range using tenant timezone
    const now = new Date();
    const zonedNow = toZonedTime(now, tenantTimezone);
    
    // Create start and end of day in tenant timezone, then convert to UTC for database queries
    const startOfTodayLocal = new Date(zonedNow.getFullYear(), zonedNow.getMonth(), zonedNow.getDate(), 0, 0, 0);
    const endOfTodayLocal = new Date(zonedNow.getFullYear(), zonedNow.getMonth(), zonedNow.getDate(), 23, 59, 59);
    
    const startOfToday = fromZonedTime(startOfTodayLocal, tenantTimezone);
    const endOfToday = fromZonedTime(endOfTodayLocal, tenantTimezone);

    // Run all independent queries in parallel
    const [
      todaysSalesResult,
      todaysPurchasesResult,
      totalUdhaarResult,
      todaysExpensesResult,
      recentPurchases,
      recentSales,
      favouriteRetailers,
      favouriteVendors
    ] = await Promise.all([
      
      // Get today's sales
      db.select({ total: sum(salesInvoices.totalAmount) })
        .from(salesInvoices)
        .where(withTenant(salesInvoices, tenantId, and(
          gte(salesInvoices.createdAt, startOfToday),
          lte(salesInvoices.createdAt, endOfToday)
        ))),
      
      // Get today's purchases
      db.select({ total: sum(purchaseInvoices.netAmount) })
        .from(purchaseInvoices)
        .where(withTenant(purchaseInvoices, tenantId, and(
          gte(purchaseInvoices.createdAt, startOfToday),
          lte(purchaseInvoices.createdAt, endOfToday)
        ))),
      
      // Get total udhaar
      db.select({ total: sum(retailers.udhaaarBalance) })
        .from(retailers)
        .where(withTenant(retailers, tenantId, eq(retailers.isActive, true))),
      
      // Get today's expenses
      db.select({ total: sum(expenses.amount) })
        .from(expenses)
        .where(withTenant(expenses, tenantId, and(
          gte(expenses.paymentDate, startOfToday),
          lte(expenses.paymentDate, endOfToday)
        ))),
      
      // Get recent purchases, sales, and favourite retailers
      this.getRecentPurchases(tenantId, 5),
      this.getRecentSales(tenantId, 5),
      this.getFavouriteRetailers(tenantId, 10),
      this.getFavouriteVendors(tenantId, 10)
    ]);

    // Format results
    const todaysSales = `₹${(Number(todaysSalesResult[0]?.total) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const todaysPurchases = `₹${(Number(todaysPurchasesResult[0]?.total) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const totalUdhaar = `₹${(Number(totalUdhaarResult[0]?.total) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const todaysExpenses = `₹${(Number(todaysExpensesResult[0]?.total) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    return {
      todaysSales,
      todaysPurchases,
      totalUdhaar,
      todaysExpenses,
      recentPurchases,
      recentSales,
      favouriteRetailers,
      favouriteVendors
    };
  }

  async getRecentPurchases(tenantId: string, limit: number = 5): Promise<RecentPurchase[]> {
    const recentPurchases = await db
      .select({
        id: purchaseInvoices.id,
        invoiceNumber: purchaseInvoices.invoiceNumber,
        invoiceDate: purchaseInvoices.invoiceDate,
        vendorName: vendors.name,
        netAmount: purchaseInvoices.netAmount,
        status: purchaseInvoices.status
      })
      .from(purchaseInvoices)
      .innerJoin(vendors, and(eq(purchaseInvoices.vendorId, vendors.id), eq(vendors.tenantId, tenantId)))
      .where(withTenant(purchaseInvoices, tenantId))
      .orderBy(desc(purchaseInvoices.createdAt))
      .limit(limit);

    return recentPurchases.map(purchase => ({
      ...purchase,
      invoiceDate: purchase.invoiceDate.toISOString(),
      netAmount: `₹${Number(purchase.netAmount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    }));
  }

  async getRecentSales(tenantId: string, limit: number = 5): Promise<RecentSale[]> {
    const recentSales = await db
      .select({
        id: salesInvoices.id,
        invoiceNumber: salesInvoices.invoiceNumber,
        invoiceDate: salesInvoices.invoiceDate,
        retailerName: retailers.name,
        totalAmount: salesInvoices.totalAmount,
        status: salesInvoices.status
      })
      .from(salesInvoices)
      .innerJoin(retailers, and(eq(salesInvoices.retailerId, retailers.id), eq(retailers.tenantId, tenantId)))
      .where(withTenant(salesInvoices, tenantId))
      .orderBy(desc(salesInvoices.createdAt))
      .limit(limit);

    return recentSales.map(sale => ({
      ...sale,
      invoiceDate: sale.invoiceDate.toISOString(),
      totalAmount: `₹${Number(sale.totalAmount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    }));
  }

  async getFavouriteRetailers(tenantId: string, limit: number = 10): Promise<FavouriteRetailer[]> {
    const favouriteRetailers = await db
      .select({
        id: retailers.id,
        name: retailers.name,
        phone: retailers.phone,
        udhaaarBalance: retailers.udhaaarBalance,
        shortfallBalance: retailers.shortfallBalance,
        crateBalance: sql<number>`COALESCE(${retailers.crateBalance}, 0)`
      })
      .from(retailers)
      .where(withTenant(retailers, tenantId, and(eq(retailers.isActive, true), eq(retailers.isFavourite, true))))
      .orderBy(asc(retailers.name))
      .limit(limit);

    return favouriteRetailers.map(retailer => ({
      ...retailer,
      udhaaarBalance: `₹${Number(retailer.udhaaarBalance).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      shortfallBalance: `₹${Number(retailer.shortfallBalance).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    }));
  }

  async getFavouriteVendors(tenantId: string, limit: number = 10) {
    const favouriteVendors = await db
      .select({
        id: vendors.id,
        name: vendors.name,
        phone: vendors.phone,
        balance: vendors.balance,
        crateBalance: sql<number>`COALESCE(${vendors.crateBalance}, 0)`
      })
      .from(vendors)
      .where(withTenant(vendors, tenantId, and(eq(vendors.isActive, true), eq(vendors.isFavourite, true))))
      .orderBy(asc(vendors.name))
      .limit(limit);

    return favouriteVendors.map(vendor => ({
      ...vendor,
      balance: `₹${Number(vendor.balance).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    }));
  }
}