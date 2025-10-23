import { sql } from "drizzle-orm";
import { pgTable, text, varchar, decimal, integer, timestamp, uuid, boolean, jsonb, unique, index, foreignKey } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// IMPORTANT: All insert schemas now require tenantId to be provided by callers.
// The tenantId should be injected from auth context in server-side operations.
// Audit all usages of insert schemas to ensure tenantId is provided.

// MIGRATION PLAN: Adding NOT NULL tenantId requires careful migration:
// 1. Add nullable tenant_id columns to all affected tables
// 2. Backfill tenant_id values for existing data
// 3. Set columns to NOT NULL
// 4. Add composite unique constraints and drop former unique constraints
// Test on a database snapshot to minimize downtime/locking

// Crate Transaction Type Constants
export const CRATE_TRANSACTION_TYPES = {
  GIVEN: 'Given',      // Crates given to retailer (from us) or given to vendor (from us)
  RECEIVED: 'Received', // Crates received from vendor (to us)
  RETURNED: 'Returned'  // Crates returned by retailer (to us) or returned to vendor (by us)
} as const;

export type CrateTransactionType = typeof CRATE_TRANSACTION_TYPES[keyof typeof CRATE_TRANSACTION_TYPES];

// Invoice Status Constants
export const INVOICE_STATUS = {
  UNPAID: 'Unpaid',
  PARTIALLY_PAID: 'Partially Paid',
  PAID: 'Paid'
} as const;

export type InvoiceStatus = typeof INVOICE_STATUS[keyof typeof INVOICE_STATUS];

// Helper function for uppercase transformation
const toUpperCase = (val: string | null | undefined): string | null | undefined => {
  if (val === null || val === undefined) return val;
  return val.toUpperCase();
};

// Helper for nullable + optional + uppercase transformation pattern
const upperOpt = () => z.string().nullable().optional().transform(toUpperCase);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
  username: text("username").notNull(),
  password: text("password").notNull(),
  role: text("role").notNull(), // Admin, Operator, Accountant
  name: text("name").notNull(),
  permissions: text("permissions").array().default([]).notNull(), // Individual user permissions
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  uniqueUsernamePerTenant: unique().on(table.tenantId, table.username),
}));

export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  isActive: boolean("is_active").default(true),
  settings: jsonb("settings").default({}),
  createdAt: timestamp("created_at").defaultNow(),
});

export const vendors = pgTable("vendors", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
  name: text("name").notNull(),
  phone: text("phone"),
  address: text("address"),
  balance: decimal("balance", { precision: 10, scale: 2 }).default("0.00"),
  crateBalance: integer("crate_balance").default(0), // Number of crates with vendor
  isActive: boolean("is_active").default(true),
  isFavourite: boolean("is_favourite").default(false),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  uniqueNamePerTenant: unique().on(table.tenantId, table.name),
  // Comment 1: Composite unique key for tenant-scoped referential integrity
  uqVendorsTenantId: unique('uq_vendors_tenant_id').on(table.tenantId, table.id),
}));

export const items = pgTable("items", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
  name: text("name").notNull(),
  quality: text("quality").notNull(),
  unit: text("unit").notNull(), // box, crate, kgs
  vendorId: uuid("vendor_id").references(() => vendors.id),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  itemsTenantIdx: index('idx_items_tenant').on(table.tenantId),
  // Comment 5: Optional item identity uniqueness per tenant - composite unique constraint
  itemsUnique: unique('items_tenant_identity_unique').on(table.tenantId, table.name, table.quality, table.unit),
  // Comment 1: Composite unique key for tenant-scoped referential integrity
  uqItemsTenantId: unique('uq_items_tenant_id').on(table.tenantId, table.id),
  // Comment 1: Composite foreign key for tenant-scoped referential integrity (vendorId can be null)
  fkItemsVendor: foreignKey({
    name: 'fk_items_vendor_tenant',
    columns: [table.tenantId, table.vendorId],
    foreignColumns: [vendors.tenantId, vendors.id]
  }),
}));

export const bankAccounts = pgTable("bank_accounts", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
  name: text("name").notNull(),
  accountNumber: text("account_number").notNull(),
  bankName: text("bank_name").notNull(),
  ifscCode: text("ifsc_code"),
  balance: decimal("balance", { precision: 12, scale: 2 }).default("0.00"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  uniqueAccountNumberPerTenant: unique().on(table.tenantId, table.accountNumber),
  // Comment 1: Composite unique key for tenant-scoped referential integrity
  uqBankAccountsTenantId: unique('uq_bank_accounts_tenant_id').on(table.tenantId, table.id),
}));

export const purchaseInvoices = pgTable("purchase_invoices", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
  invoiceNumber: text("invoice_number").notNull(),
  vendorId: uuid("vendor_id").references(() => vendors.id).notNull(),
  invoiceDate: timestamp("invoice_date").notNull(),
  commission: decimal("commission", { precision: 10, scale: 2 }).default("0.00"),
  labour: decimal("labour", { precision: 8, scale: 2 }).default("0.00"),
  truckFreight: decimal("truck_freight", { precision: 8, scale: 2 }).default("0.00"),
  crateFreight: decimal("crate_freight", { precision: 8, scale: 2 }).default("0.00"),
  postExpenses: decimal("post_expenses", { precision: 8, scale: 2 }).default("0.00"),
  draftExpenses: decimal("draft_expenses", { precision: 8, scale: 2 }).default("0.00"),
  vatav: decimal("vatav", { precision: 8, scale: 2 }).default("0.00"),
  otherExpenses: decimal("other_expenses", { precision: 8, scale: 2 }).default("0.00"),
  advance: decimal("advance", { precision: 10, scale: 2 }).default("0.00"),
  totalExpense: decimal("total_expense", { precision: 10, scale: 2 }).notNull(),
  totalSelling: decimal("total_selling", { precision: 10, scale: 2 }).notNull(),
  totalLessExpenses: decimal("total_less_expenses", { precision: 10, scale: 2 }).notNull(),
  netAmount: decimal("net_amount", { precision: 10, scale: 2 }).notNull(),
  paidAmount: decimal("paid_amount", { precision: 10, scale: 2 }).default("0.00"),
  balanceAmount: decimal("balance_amount", { precision: 10, scale: 2 }).notNull(),
  status: text("status").notNull(), // Paid, Partially Paid, Unpaid
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  uniqueInvoiceNumberPerTenant: unique().on(table.tenantId, table.invoiceNumber),
  // Comment 1: Composite unique key for tenant-scoped referential integrity
  uqPurchaseInvoicesTenantId: unique('uq_purchase_invoices_tenant_id').on(table.tenantId, table.id),
}));

export const invoiceItems = pgTable("invoice_items", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
  invoiceId: uuid("invoice_id").references(() => purchaseInvoices.id).notNull(),
  itemId: uuid("item_id").references(() => items.id).notNull(),
  weight: decimal("weight", { precision: 8, scale: 2 }).notNull(),
  crates: decimal("crates", { precision: 8, scale: 2 }).notNull(),
  boxes: decimal("boxes", { precision: 8, scale: 2 }).default("0.00"),
  rate: decimal("rate", { precision: 8, scale: 2 }).notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  // TENANT CONSISTENCY INVARIANT: tenantId must match purchaseInvoices.tenantId and items.tenantId
}, (table) => ({
  invoiceItemsTenantIdx: index('idx_invoice_items_tenant').on(table.tenantId),
  // Comment 1: Composite foreign keys for tenant-scoped referential integrity
  fkInvoiceItemsInvoice: foreignKey({
    name: 'fk_invoice_items_invoice_tenant',
    columns: [table.tenantId, table.invoiceId],
    foreignColumns: [purchaseInvoices.tenantId, purchaseInvoices.id]
  }),
  fkInvoiceItemsItem: foreignKey({
    name: 'fk_invoice_items_item_tenant',
    columns: [table.tenantId, table.itemId],
    foreignColumns: [items.tenantId, items.id]
  }),
}));

export const payments = pgTable("payments", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
  invoiceId: uuid("invoice_id").references(() => purchaseInvoices.id).notNull(),
  vendorId: uuid("vendor_id").references(() => vendors.id).notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  paymentMode: text("payment_mode").notNull(), // Cash, Bank, UPI, Cheque
  paymentDate: timestamp("payment_date").notNull(),
  bankAccountId: uuid("bank_account_id").references(() => bankAccounts.id),
  chequeNumber: text("cheque_number"),
  upiReference: text("upi_reference"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  // TENANT CONSISTENCY INVARIANT: tenantId must match purchaseInvoices.tenantId, vendors.tenantId, and bankAccounts.tenantId (if not null)
}, (table) => ({
  paymentsTenantIdx: index('idx_payments_tenant').on(table.tenantId),
  // Comment 1: Composite foreign keys for tenant-scoped referential integrity
  fkPaymentsInvoice: foreignKey({
    name: 'fk_payments_invoice_tenant',
    columns: [table.tenantId, table.invoiceId],
    foreignColumns: [purchaseInvoices.tenantId, purchaseInvoices.id]
  }),
  fkPaymentsVendor: foreignKey({
    name: 'fk_payments_vendor_tenant',
    columns: [table.tenantId, table.vendorId],
    foreignColumns: [vendors.tenantId, vendors.id]
  }),
  // Comment 1: Additional composite FK for bankAccountId (nullable)
  fkPaymentsBankAccount: foreignKey({
    name: 'fk_payments_bank_account_tenant',
    columns: [table.tenantId, table.bankAccountId],
    foreignColumns: [bankAccounts.tenantId, bankAccounts.id]
  }),
}));

export const stock = pgTable("stock", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
  itemId: uuid("item_id").references(() => items.id).notNull(),
  quantityInCrates: decimal("quantity_in_crates", { precision: 8, scale: 2 }).default("0.00"),
  quantityInBoxes: decimal("quantity_in_boxes", { precision: 8, scale: 2 }).default("0.00"),
  quantityInKgs: decimal("quantity_in_kgs", { precision: 8, scale: 2 }).default("0.00"),
  lastUpdated: timestamp("last_updated").defaultNow(),
}, (table) => ({
  stockTenantIdx: index('idx_stock_tenant').on(table.tenantId),
}));

export const stockMovements = pgTable("stock_movements", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
  itemId: uuid("item_id").references(() => items.id).notNull(),
  movementType: text("movement_type").notNull(), // "IN" or "OUT"
  quantityInCrates: decimal("quantity_in_crates", { precision: 8, scale: 2 }).notNull(),
  quantityInBoxes: decimal("quantity_in_boxes", { precision: 8, scale: 2 }).default("0.00"),
  quantityInKgs: decimal("quantity_in_kgs", { precision: 8, scale: 2 }).notNull(),
  referenceType: text("reference_type").notNull(), // "PURCHASE_INVOICE", "SALES_INVOICE", "ADJUSTMENT"
  referenceId: uuid("reference_id"), // Links to purchase invoice, sales invoice, etc.
  referenceNumber: text("reference_number"), // Invoice number for display
  vendorId: uuid("vendor_id").references(() => vendors.id), // For purchase entries
  retailerId: uuid("retailer_id").references(() => retailers.id), // For sales entries
  rate: decimal("rate", { precision: 8, scale: 2 }), // Rate per unit for OUT entries (from sales invoice)
  purchaseInvoiceId: uuid("purchase_invoice_id").references(() => purchaseInvoices.id), // Tracks which OUT entries are used for purchase invoices
  notes: text("notes"),
  movementDate: timestamp("movement_date").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  // TENANT CONSISTENCY INVARIANT: tenantId must match items.tenantId, vendors.tenantId (if not null), retailers.tenantId (if not null), and purchaseInvoices.tenantId (if not null)
}, (table) => ({
  stockMovementsTenantIdx: index('idx_stock_movements_tenant').on(table.tenantId),
  stockMovementsPurchaseInvoiceIdx: index('idx_stock_movements_purchase_invoice').on(table.purchaseInvoiceId),
  // Comment 1: Composite foreign keys for tenant-scoped referential integrity
  fkStockMovementsItem: foreignKey({
    name: 'fk_stock_movements_item_tenant',
    columns: [table.tenantId, table.itemId],
    foreignColumns: [items.tenantId, items.id]
  }),
  // Comment 1: Additional composite FKs for nullable relations
  fkStockMovementsVendor: foreignKey({
    name: 'fk_stock_movements_vendor_tenant',
    columns: [table.tenantId, table.vendorId],
    foreignColumns: [vendors.tenantId, vendors.id]
  }),
  fkStockMovementsRetailer: foreignKey({
    name: 'fk_stock_movements_retailer_tenant',
    columns: [table.tenantId, table.retailerId],
    foreignColumns: [retailers.tenantId, retailers.id]
  }),
  fkStockMovementsPurchaseInvoice: foreignKey({
    name: 'fk_stock_movements_purchase_invoice_tenant',
    columns: [table.tenantId, table.purchaseInvoiceId],
    foreignColumns: [purchaseInvoices.tenantId, purchaseInvoices.id]
  }),
}));

export const cashbook = pgTable("cashbook", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
  date: timestamp("date").notNull(),
  description: text("description").notNull(),
  inflow: decimal("inflow", { precision: 10, scale: 2 }).default("0.00"),
  outflow: decimal("outflow", { precision: 10, scale: 2 }).default("0.00"),
  balance: decimal("balance", { precision: 10, scale: 2 }).notNull(),
  referenceType: text("reference_type"), // Payment, Other
  referenceId: uuid("reference_id"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  cashbookTenantIdx: index('idx_cashbook_tenant').on(table.tenantId),
}));

export const bankbook = pgTable("bankbook", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
  bankAccountId: uuid("bank_account_id").references(() => bankAccounts.id).notNull(),
  date: timestamp("date").notNull(),
  description: text("description").notNull(),
  debit: decimal("debit", { precision: 10, scale: 2 }).default("0.00"),
  credit: decimal("credit", { precision: 10, scale: 2 }).default("0.00"),
  balance: decimal("balance", { precision: 10, scale: 2 }).notNull(),
  referenceType: text("reference_type"), // Payment, Other
  referenceId: uuid("reference_id"),
  createdAt: timestamp("created_at").defaultNow(),
  // TENANT CONSISTENCY INVARIANT: tenantId must match bankAccounts.tenantId
}, (table) => ({
  bankbookTenantIdx: index('idx_bankbook_tenant').on(table.tenantId),
  // Comment 1: Composite foreign keys for tenant-scoped referential integrity
  fkBankbookBankAccount: foreignKey({
    name: 'fk_bankbook_bank_account_tenant',
    columns: [table.tenantId, table.bankAccountId],
    foreignColumns: [bankAccounts.tenantId, bankAccounts.id]
  }),
}));

export const retailers = pgTable("retailers", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
  name: text("name").notNull(),
  phone: text("phone"),
  address: text("address"),
  balance: decimal("balance", { precision: 10, scale: 2 }).default("0.00"),
  udhaaarBalance: decimal("udhaar_balance", { precision: 10, scale: 2 }).default("0.00"), // Credit balance
  shortfallBalance: decimal("shortfall_balance", { precision: 10, scale: 2 }).default("0.00"), // Deficit balance
  crateBalance: integer("crate_balance").default(0), // Number of crates with retailer
  isActive: boolean("is_active").default(true),
  isFavourite: boolean("is_favourite").default(false),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  uniqueNamePerTenant: unique().on(table.tenantId, table.name),
  // Comment 1: Composite unique key for tenant-scoped referential integrity
  uqRetailersTenantId: unique('uq_retailers_tenant_id').on(table.tenantId, table.id),
}));

export const salesInvoices = pgTable("sales_invoices", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
  invoiceNumber: text("invoice_number").notNull(),
  retailerId: uuid("retailer_id").references(() => retailers.id).notNull(),
  invoiceDate: timestamp("invoice_date").notNull(),
  totalAmount: decimal("total_amount", { precision: 10, scale: 2 }).notNull(),
  paidAmount: decimal("paid_amount", { precision: 10, scale: 2 }).default("0.00"),
  balanceAmount: decimal("balance_amount", { precision: 10, scale: 2 }).notNull(),
  udhaaarAmount: decimal("udhaar_amount", { precision: 10, scale: 2 }).default("0.00"), // Outstanding amount retailer needs to pay
  shortfallAmount: decimal("shortfall_amount", { precision: 10, scale: 2 }).default("0.00"), // Deficit when marked Paid (bidirectional with udhaaarAmount)
  status: text("status").notNull(), // Paid, Partially Paid, Unpaid
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  uniqueInvoiceNumberPerTenant: unique().on(table.tenantId, table.invoiceNumber),
  // Comment 1: Composite unique key for tenant-scoped referential integrity
  uqSalesInvoicesTenantId: unique('uq_sales_invoices_tenant_id').on(table.tenantId, table.id),
}));

export const salesInvoiceItems = pgTable("sales_invoice_items", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
  invoiceId: uuid("invoice_id").references(() => salesInvoices.id).notNull(),
  itemId: uuid("item_id").references(() => items.id).notNull(),
  weight: decimal("weight", { precision: 8, scale: 2 }).notNull(),
  crates: decimal("crates", { precision: 8, scale: 2 }).notNull(),
  boxes: decimal("boxes", { precision: 8, scale: 2 }).default("0.00"),
  rate: decimal("rate", { precision: 8, scale: 2 }).notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  // TENANT CONSISTENCY INVARIANT: tenantId must match salesInvoices.tenantId and items.tenantId
}, (table) => ({
  salesInvoiceItemsTenantIdx: index('idx_sales_invoice_items_tenant').on(table.tenantId),
  // Comment 1: Composite foreign keys for tenant-scoped referential integrity
  fkSalesInvoiceItemsInvoice: foreignKey({
    name: 'fk_sales_invoice_items_invoice_tenant',
    columns: [table.tenantId, table.invoiceId],
    foreignColumns: [salesInvoices.tenantId, salesInvoices.id]
  }),
  fkSalesInvoiceItemsItem: foreignKey({
    name: 'fk_sales_invoice_items_item_tenant',
    columns: [table.tenantId, table.itemId],
    foreignColumns: [items.tenantId, items.id]
  }),
}));

export const salesPayments = pgTable("sales_payments", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
  invoiceId: uuid("invoice_id").references(() => salesInvoices.id).notNull(),
  retailerId: uuid("retailer_id").references(() => retailers.id).notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  paymentMode: text("payment_mode").notNull(), // Cash, Bank, UPI, Cheque, PaymentLink
  paymentDate: timestamp("payment_date").notNull(),
  bankAccountId: uuid("bank_account_id").references(() => bankAccounts.id),
  chequeNumber: text("cheque_number"),
  upiReference: text("upi_reference"),
  paymentLinkId: text("payment_link_id"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  // TENANT CONSISTENCY INVARIANT: tenantId must match salesInvoices.tenantId, retailers.tenantId, and bankAccounts.tenantId (if not null)
}, (table) => ({
  salesPaymentsTenantIdx: index('idx_sales_payments_tenant').on(table.tenantId),
  // Comment 1: Composite foreign keys for tenant-scoped referential integrity
  fkSalesPaymentsInvoice: foreignKey({
    name: 'fk_sales_payments_invoice_tenant',
    columns: [table.tenantId, table.invoiceId],
    foreignColumns: [salesInvoices.tenantId, salesInvoices.id]
  }),
  fkSalesPaymentsRetailer: foreignKey({
    name: 'fk_sales_payments_retailer_tenant',
    columns: [table.tenantId, table.retailerId],
    foreignColumns: [retailers.tenantId, retailers.id]
  }),
  // Comment 1: Additional composite FK for bankAccountId (nullable)
  fkSalesPaymentsBankAccount: foreignKey({
    name: 'fk_sales_payments_bank_account_tenant',
    columns: [table.tenantId, table.bankAccountId],
    foreignColumns: [bankAccounts.tenantId, bankAccounts.id]
  }),
}));

export const crateTransactions = pgTable("crate_transactions", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
  
  // Party identification - either retailerId or vendorId must be set based on partyType
  partyType: text("party_type").default('retailer').notNull(), // 'retailer' or 'vendor'
  retailerId: uuid("retailer_id").references(() => retailers.id), // Nullable - set when partyType = 'retailer'
  vendorId: uuid("vendor_id").references(() => vendors.id), // Nullable - set when partyType = 'vendor'
  
  // Transaction details
  transactionType: text("transaction_type").notNull(), // Given, Received, Returned
  quantity: integer("quantity").notNull(), // Number of crates
  transactionDate: timestamp("transaction_date").notNull(),
  notes: text("notes"),
  
  // Invoice linking - optional, allows creating crate transactions during invoice creation
  salesInvoiceId: uuid("sales_invoice_id").references(() => salesInvoices.id), // Links to sales invoice if created together
  purchaseInvoiceId: uuid("purchase_invoice_id").references(() => purchaseInvoices.id), // Links to purchase invoice if created together
  
  createdAt: timestamp("created_at").defaultNow(),
  // TENANT CONSISTENCY INVARIANT: tenantId must match retailers.tenantId (if retailerId set), vendors.tenantId (if vendorId set), salesInvoices.tenantId (if salesInvoiceId set), purchaseInvoices.tenantId (if purchaseInvoiceId set)
}, (table) => ({
  crateTransactionsTenantIdx: index('idx_crate_transactions_tenant').on(table.tenantId),
  crateTransactionsPartyTypeIdx: index('idx_crate_transactions_party_type').on(table.partyType),
  
  // Comment 1: Composite foreign keys for tenant-scoped referential integrity
  fkCrateTransactionsRetailer: foreignKey({
    name: 'fk_crate_transactions_retailer_tenant',
    columns: [table.tenantId, table.retailerId],
    foreignColumns: [retailers.tenantId, retailers.id]
  }),
  fkCrateTransactionsVendor: foreignKey({
    name: 'fk_crate_transactions_vendor_tenant',
    columns: [table.tenantId, table.vendorId],
    foreignColumns: [vendors.tenantId, vendors.id]
  }),
  fkCrateTransactionsSalesInvoice: foreignKey({
    name: 'fk_crate_transactions_sales_invoice_tenant',
    columns: [table.tenantId, table.salesInvoiceId],
    foreignColumns: [salesInvoices.tenantId, salesInvoices.id]
  }),
  fkCrateTransactionsPurchaseInvoice: foreignKey({
    name: 'fk_crate_transactions_purchase_invoice_tenant',
    columns: [table.tenantId, table.purchaseInvoiceId],
    foreignColumns: [purchaseInvoices.tenantId, purchaseInvoices.id]
  }),
}));

export const expenseCategories = pgTable("expense_categories", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
  name: text("name").notNull(),
  description: text("description"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  uniqueNamePerTenant: unique().on(table.tenantId, table.name),
  // Comment 1: Composite unique key for tenant-scoped referential integrity
  uqExpenseCategoriesTenantId: unique('uq_expense_categories_tenant_id').on(table.tenantId, table.id),
}));

export const expenses = pgTable("expenses", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
  categoryId: uuid("category_id").references(() => expenseCategories.id).notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  paymentMode: text("payment_mode").notNull(), // Cash, Bank, UPI, Cheque
  paymentDate: timestamp("payment_date").notNull(),
  bankAccountId: uuid("bank_account_id").references(() => bankAccounts.id),
  chequeNumber: text("cheque_number"),
  upiReference: text("upi_reference"),
  description: text("description").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  // TENANT CONSISTENCY INVARIANT: tenantId must match expenseCategories.tenantId and bankAccounts.tenantId (if not null)
}, (table) => ({
  expensesTenantIdx: index('idx_expenses_tenant').on(table.tenantId),
  // Comment 1: Composite foreign keys for tenant-scoped referential integrity
  fkExpensesCategory: foreignKey({
    name: 'fk_expenses_category_tenant',
    columns: [table.tenantId, table.categoryId],
    foreignColumns: [expenseCategories.tenantId, expenseCategories.id]
  }),
  // Comment 1: Additional composite FK for bankAccountId (nullable)
  fkExpensesBankAccount: foreignKey({
    name: 'fk_expenses_bank_account_tenant',
    columns: [table.tenantId, table.bankAccountId],
    foreignColumns: [bankAccounts.tenantId, bankAccounts.id]
  }),
}));

export const whatsappMessages = pgTable("whatsapp_messages", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
  recipientType: text("recipient_type").notNull(), // 'vendor' or 'retailer'
  recipientId: uuid("recipient_id").notNull(),
  recipientPhone: text("recipient_phone").notNull(),
  messageType: text("message_type").notNull(), // 'sales_invoice', 'purchase_invoice', 'payment_reminder', 'payment_notification'
  referenceType: text("reference_type").notNull(), // 'SalesInvoice', 'PurchaseInvoice', 'Payment'
  referenceId: uuid("reference_id").notNull(),
  referenceNumber: text("reference_number").notNull(),
  templateId: text("template_id").notNull(), // Twilio ContentSid
  templateVariables: jsonb("template_variables").notNull(),
  twilioMessageSid: text("twilio_message_sid"),
  status: text("status").notNull().default("pending"), // 'pending', 'sent', 'delivered', 'failed', 'read'
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  cost: decimal("cost", { precision: 10, scale: 4 }),
  costCurrency: text("cost_currency"),
  sentAt: timestamp("sent_at"),
  deliveredAt: timestamp("delivered_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  whatsappMessagesTenantIdx: index('idx_whatsapp_messages_tenant').on(table.tenantId),
  whatsappMessagesRecipientIdx: index('idx_whatsapp_messages_recipient').on(table.recipientType, table.recipientId),
  whatsappMessagesStatusIdx: index('idx_whatsapp_messages_status').on(table.status),
  whatsappMessagesCreatedAtIdx: index('idx_whatsapp_messages_created_at').on(table.createdAt),
  uqWhatsappMessagesTenantId: unique('uq_whatsapp_messages_tenant_id').on(table.tenantId, table.id),
}));

export const whatsappCreditTransactions = pgTable("whatsapp_credit_transactions", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
  transactionType: text("transaction_type").notNull(), // 'allocation', 'usage', 'adjustment'
  amount: integer("amount").notNull(), // Positive for allocation, negative for usage
  balanceAfter: integer("balance_after").notNull(), // Running balance after this transaction
  referenceType: text("reference_type").notNull(), // 'admin_allocation', 'message_sent', 'manual_adjustment'
  referenceId: uuid("reference_id"), // Links to whatsapp_messages for usage transactions
  performedBy: uuid("performed_by"), // User ID who performed the action (for allocations/adjustments)
  notes: text("notes"), // Reason for allocation or adjustment
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  creditTransactionsTenantIdx: index('idx_credit_transactions_tenant').on(table.tenantId),
  creditTransactionsTypeIdx: index('idx_credit_transactions_type').on(table.transactionType),
  creditTransactionsCreatedAtIdx: index('idx_credit_transactions_created_at').on(table.createdAt),
  uqWhatsappCreditTransactionsTenantId: unique('uq_whatsapp_credit_transactions_tenant_id').on(table.tenantId, table.id),
  // Foreign key to whatsapp_messages for usage transactions
  fkCreditTransactionsMessage: foreignKey({
    name: 'fk_credit_transactions_message_tenant',
    columns: [table.tenantId, table.referenceId],
    foreignColumns: [whatsappMessages.tenantId, whatsappMessages.id]
  }),
}));

export const invoiceShareLinks = pgTable("invoice_share_links", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid("tenant_id").references(() => tenants.id).notNull(),
  token: text("token").notNull(),
  invoiceId: uuid("invoice_id").notNull(),
  invoiceType: text("invoice_type").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  expiresAt: timestamp("expires_at"),
  accessCount: integer("access_count").default(0),
  lastAccessedAt: timestamp("last_accessed_at"),
}, (table) => ({
  invoiceShareLinksTokenUnique: unique('uq_invoice_share_links_token').on(table.token),
  invoiceShareLinksInvoiceUnique: unique('uq_invoice_share_links_invoice').on(table.tenantId, table.invoiceId, table.invoiceType),
  uqInvoiceShareLinksTenantId: unique('uq_invoice_share_links_tenant_id').on(table.tenantId, table.id),
  invoiceShareLinksTenantIdx: index('idx_invoice_share_links_tenant').on(table.tenantId),
  invoiceShareLinksTokenIdx: index('idx_invoice_share_links_token').on(table.token),
  invoiceShareLinksTypeIdx: index('idx_invoice_share_links_type').on(table.invoiceType),
}));

// Insert schemas
export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
}).extend({
  username: z.string().transform(toUpperCase),
  role: z.string().transform(toUpperCase),
  name: z.string().transform(toUpperCase),
});

export const insertTenantSchema = createInsertSchema(tenants).omit({
  id: true,
  createdAt: true,
}).extend({
  name: z.string().transform(toUpperCase),
  slug: z.string().transform(toUpperCase),
});

// Phone Number Validation Schema
export const phoneNumberSchema = z.string()
  .regex(/^\+?[1-9]\d{1,14}$/, 'Invalid phone number format')
  .transform(val => val.startsWith('+') ? val : `+91${val}`);

export const indianTenDigitPhone = z.string().trim()
  .regex(/^\d{10}$/, "Phone number must be exactly 10 digits")
  .transform(val => `+91${val}`);

// Tenant Settings Schema - defines the expected structure for tenant settings
export const tenantSettingsSchema = z.object({
  // Company Information
  companyName: z.string().min(1).max(255).transform(toUpperCase).optional(),
  address: z.string().max(1000).transform(toUpperCase).optional(),
  phone: z.string().max(20).optional(),
  email: z.string().email().optional(),
  
  // Branding Settings
  branding: z.object({
    logoUrl: z.string().url().optional(),
    favicon: z.string().url().optional(),
  }).optional(),
  
  // Business Settings
  commissionRate: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(), // Decimal string validation
  currency: z.enum(["INR", "USD", "EUR"]).optional(),
  dateFormat: z.enum(["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"]).optional(),
  timezone: z.string().optional(), // IANA timezone identifier
  cashBalance: z.string().regex(/^-?\d+(\.\d{1,2})?$/).optional(), // Decimal string validation, allows negative values
  
  // Notification Settings
  notifications: z.boolean().optional(),
  emailAlerts: z.boolean().optional(),
  smsAlerts: z.boolean().optional(),
  
  // Data & Backup Settings
  autoBackup: z.boolean().optional(),
  backupFrequency: z.enum(["hourly", "daily", "weekly", "monthly"]).optional(),
  
  // WhatsApp Settings
  whatsapp: z.object({
    enabled: z.boolean().default(false),
    creditBalance: z.number().int().min(0).default(0), // Note: Updates to this field are ignored by the settings controller
    lowCreditThreshold: z.number().int().min(0).default(50),
    scheduler: z.object({
      enabled: z.boolean().default(true), // Enable/disable automatic payment reminders
      preferredSendHour: z.number().int().min(0).max(23).default(9), // Hour of day (0-23) to send reminders
      reminderFrequency: z.enum(['daily', 'weekly', 'monthly']).default('daily'), // How often to send reminders
      sendOnWeekends: z.boolean().default(true), // Whether to send reminders on weekends
    }).optional().default({
      enabled: true,
      preferredSendHour: 9,
      reminderFrequency: 'daily',
      sendOnWeekends: true,
    }),
    defaultTemplates: z.object({
      paymentReminder: z.string().optional(),
      invoiceNotification: z.string().optional(),
      welcomeMessage: z.string().optional(),
    }).optional(),
  }).optional(),
}).strict(); // strict() ensures no extra properties are allowed

export type TenantSettings = z.infer<typeof tenantSettingsSchema>;

export const insertVendorSchema = createInsertSchema(vendors)
  .omit({ id: true, balance: true, crateBalance: true, createdAt: true })
  .extend({ phone: indianTenDigitPhone })
  .extend({
    name: z.string().transform(toUpperCase),
    address: upperOpt(),
  });

export const insertItemSchema = z.object({
  name: z.string().min(1, "Name is required").transform(toUpperCase),
  quality: z.string().min(1, "Quality is required").transform(toUpperCase),
  unit: z.enum(["box", "crate", "kgs"], {
    required_error: "Unit is required",
    invalid_type_error: "Unit must be box, crate, or kgs"
  }).transform(toUpperCase),
  vendorId: z.string().uuid("Valid vendor ID is required"),
  isActive: z.boolean().default(true),
  tenantId: z.string().uuid()
});

export const insertBankAccountSchema = createInsertSchema(bankAccounts, {
  balance: z.string().transform((val) => {
    const balanceValue = (val || "0.00").trim();
    const balanceNum = parseFloat(balanceValue);
    return balanceNum.toFixed(2);
  }).refine((val) => {
    const balanceNum = parseFloat(val);
    return !isNaN(balanceNum) && balanceNum >= 0;
  }, "Balance must be a valid non-negative number"),
  name: z.string().transform(toUpperCase),
  accountNumber: z.string().transform(toUpperCase),
  bankName: z.string().transform(toUpperCase),
  ifscCode: upperOpt(),
}).omit({
  id: true,
  createdAt: true,
}).extend({
  openingDate: z.date().optional()
}).transform((data) => ({
  ...data,
  balance: data.balance || "0.00"
}));

export const updateBankAccountSchema = createInsertSchema(bankAccounts).omit({
  id: true,
  balance: true,
  createdAt: true,
}).extend({
  name: z.string().transform(toUpperCase),
  accountNumber: z.string().transform(toUpperCase),
  bankName: z.string().transform(toUpperCase),
  ifscCode: upperOpt(),
});

export const insertPurchaseInvoiceSchema = createInsertSchema(purchaseInvoices, {
  invoiceDate: z.union([z.string(), z.date()]).transform((val) => 
    typeof val === 'string' ? new Date(val) : val
  ),
}).omit({
  id: true,
  invoiceNumber: true,
  paidAmount: true,
  balanceAmount: true,
  status: true,
  createdAt: true,
});

export const insertInvoiceItemSchema = createInsertSchema(invoiceItems).omit({
  id: true,
  createdAt: true,
});

export const insertPaymentSchema = createInsertSchema(payments, {
  paymentDate: z.union([z.string(), z.date()]).transform((val) => 
    typeof val === 'string' ? new Date(val) : val
  ),
}).omit({
  id: true,
  createdAt: true,
}).extend({
  chequeNumber: upperOpt(),
  upiReference: upperOpt(),
  notes: upperOpt(),
});

export const insertStockSchema = createInsertSchema(stock).omit({
  id: true,
  lastUpdated: true,
});

export const insertStockMovementSchema = createInsertSchema(stockMovements, {
  movementDate: z.union([z.string(), z.date()]).transform((val) => 
    typeof val === 'string' ? new Date(val) : val
  ),
}).omit({
  id: true,
  createdAt: true,
}).extend({
  referenceNumber: upperOpt(),
  notes: upperOpt(),
});

export const insertRetailerSchema = createInsertSchema(retailers)
  .omit({ id: true, balance: true, udhaaarBalance: true, shortfallBalance: true, crateBalance: true, createdAt: true })
  .extend({ phone: indianTenDigitPhone })
  .extend({
    name: z.string().transform(toUpperCase),
    address: upperOpt(),
  });

export const insertSalesInvoiceSchema = createInsertSchema(salesInvoices, {
  invoiceDate: z.union([z.string(), z.date()]).transform((val) => 
    typeof val === 'string' ? new Date(val) : val
  ),
}).omit({
  id: true,
  invoiceNumber: true,
  paidAmount: true,
  balanceAmount: true,
  udhaaarAmount: true,
  shortfallAmount: true,
  status: true,
  createdAt: true,
}).extend({
  notes: upperOpt(),
});

export const insertSalesInvoiceItemSchema = createInsertSchema(salesInvoiceItems).omit({
  id: true,
  invoiceId: true,
  createdAt: true,
});

export const insertSalesPaymentSchema = createInsertSchema(salesPayments, {
  paymentDate: z.union([z.string(), z.date()]).transform((val) => 
    typeof val === 'string' ? new Date(val) : val
  ),
}).omit({
  id: true,
  createdAt: true,
}).extend({
  chequeNumber: upperOpt(),
  upiReference: upperOpt(),
  paymentLinkId: upperOpt(),
  notes: upperOpt(),
});

export const insertVendorPaymentSchema = z.object({
  vendorId: z.string().uuid(),
  amount: z.string().refine((val) => parseFloat(val) > 0, "Amount must be greater than 0"),
  paymentMode: z.enum(['Cash', 'Bank', 'UPI', 'Cheque']),
  paymentDate: z.union([z.string(), z.date()]).transform((val) => 
    typeof val === 'string' ? new Date(val) : val
  ),
  bankAccountId: z.string().uuid().optional(),
  chequeNumber: z.string().optional().transform(toUpperCase),
  upiReference: z.string().optional().transform(toUpperCase),
  notes: z.string().optional().transform(toUpperCase),
}).refine((data) => {
  if (data.paymentMode === 'Bank' && !data.bankAccountId) {
    return false;
  }
  if (data.paymentMode === 'Cheque' && !data.chequeNumber) {
    return false;
  }
  if (data.paymentMode === 'UPI' && !data.upiReference) {
    return false;
  }
  return true;
}, {
  message: "Required fields missing for selected payment mode",
});

export const insertRetailerPaymentSchema = z.object({
  retailerId: z.string().uuid(),
  amount: z.string().refine((val) => parseFloat(val) > 0, "Amount must be greater than 0"),
  paymentMode: z.enum(['Cash', 'Bank', 'UPI', 'Cheque', 'PaymentLink']),
  paymentDate: z.union([z.string(), z.date()]).transform((val) => 
    typeof val === 'string' ? new Date(val) : val
  ),
  bankAccountId: z.string().uuid().optional(),
  chequeNumber: z.string().optional().transform(toUpperCase),
  upiReference: z.string().optional().transform(toUpperCase),
  paymentLinkId: z.string().optional().transform(toUpperCase),
  notes: z.string().optional().transform(toUpperCase),
}).refine((data) => {
  if (data.paymentMode === 'Bank' && !data.bankAccountId) {
    return false;
  }
  if (data.paymentMode === 'Cheque' && !data.chequeNumber) {
    return false;
  }
  if (data.paymentMode === 'UPI' && !data.upiReference) {
    return false;
  }
  return true;
}, {
  message: "Required fields missing for selected payment mode",
});

export type InsertVendorPayment = z.infer<typeof insertVendorPaymentSchema>;
export type InsertRetailerPayment = z.infer<typeof insertRetailerPaymentSchema>;

// Bank transaction schemas
export const insertBankDepositSchema = z.object({
  amount: z.string().min(1, "Amount is required"),
  date: z.union([z.date(), z.string()]).transform((val) => {
    if (typeof val === 'string') {
      return new Date(val);
    }
    return val;
  }),
  description: z.string().min(1, "Description is required").transform(toUpperCase),
  source: z.enum(['cash', 'external'], {
    errorMap: () => ({ message: "Source must be either 'cash' or 'external'" })
  })
}).refine((data) => {
  const amount = parseFloat(data.amount);
  return !isNaN(amount) && amount > 0;
}, {
  message: "Amount must be a positive number",
  path: ["amount"]
});

export const insertBankWithdrawalSchema = z.object({
  amount: z.string().min(1, "Amount is required"),
  date: z.union([z.date(), z.string()]).transform((val) => {
    if (typeof val === 'string') {
      return new Date(val);
    }
    return val;
  }),
  description: z.string().min(1, "Description is required").transform(toUpperCase)
}).refine((data) => {
  const amount = parseFloat(data.amount);
  return !isNaN(amount) && amount > 0;
}, {
  message: "Amount must be a positive number",
  path: ["amount"]
});

export type InsertBankDeposit = z.infer<typeof insertBankDepositSchema>;
export type InsertBankWithdrawal = z.infer<typeof insertBankWithdrawalSchema>;

export type VendorPaymentDistributionResult = {
  totalAmount: string;
  distributedAmount: string;
  remainingAmount: string;
  paymentsCreated: Payment[];
  invoicesUpdated: string[];
  vendorBalanceAfter: string;
};

export type RetailerPaymentDistributionResult = {
  totalAmount: string;
  distributedAmount: string;
  remainingAmount: string;
  paymentsCreated: SalesPayment[];
  invoicesUpdated: string[];
  retailerBalanceAfter: string;
};

export const insertCrateTransactionSchema = createInsertSchema(crateTransactions, {
  partyType: z.enum(['retailer', 'vendor'], {
    required_error: "Party type is required",
    invalid_type_error: "Party type must be 'retailer' or 'vendor'"
  }),
  transactionType: z.enum([CRATE_TRANSACTION_TYPES.GIVEN, CRATE_TRANSACTION_TYPES.RECEIVED, CRATE_TRANSACTION_TYPES.RETURNED], {
    required_error: "Transaction type is required"
  }),
  transactionDate: z.union([z.string(), z.date()]).transform((val) => 
    typeof val === 'string' ? new Date(val) : val
  ),
  quantity: z.union([z.string(), z.number()]).transform((val) => {
    const num = typeof val === 'string' ? parseInt(val, 10) : val;
    if (isNaN(num) || num <= 0) {
      throw new Error("Quantity must be a positive integer");
    }
    return num;
  }),
  notes: z.string().nullable().optional().transform(toUpperCase),
}).omit({
  id: true,
  createdAt: true,
}).refine((data) => {
  // Ensure either retailerId or vendorId is provided based on partyType
  if (data.partyType === 'retailer' && !data.retailerId) {
    return false;
  }
  if (data.partyType === 'vendor' && !data.vendorId) {
    return false;
  }
  // Ensure the opposite party ID is not set
  if (data.partyType === 'retailer' && data.vendorId) {
    return false;
  }
  if (data.partyType === 'vendor' && data.retailerId) {
    return false;
  }
  return true;
}, {
  message: "Party ID must match the party type",
});

export const insertExpenseCategorySchema = createInsertSchema(expenseCategories).omit({
  id: true,
  createdAt: true,
}).extend({
  name: z.string().transform(toUpperCase),
  description: upperOpt(),
});

export const insertExpenseSchema = createInsertSchema(expenses, {
  paymentDate: z.union([z.string(), z.date()]).transform((val) => 
    typeof val === 'string' ? new Date(val) : val
  ),
}).omit({
  id: true,
  createdAt: true,
}).extend({
  chequeNumber: upperOpt(),
  upiReference: upperOpt(),
  description: z.string().transform(toUpperCase),
  notes: upperOpt(),
});

export const insertWhatsAppMessageSchema = createInsertSchema(whatsappMessages, {
  sentAt: z.union([z.string(), z.date()]).transform((val) => 
    typeof val === 'string' ? new Date(val) : val
  ).optional(),
  deliveredAt: z.union([z.string(), z.date()]).transform((val) => 
    typeof val === 'string' ? new Date(val) : val
  ).optional(),
}).omit({
  id: true,
  createdAt: true,
}).extend({
  referenceNumber: z.string().transform(toUpperCase),
  errorMessage: upperOpt(),
});

export const insertWhatsAppCreditTransactionSchema = createInsertSchema(whatsappCreditTransactions).omit({
  id: true,
  createdAt: true,
});

export const insertInvoiceShareLinkSchema = createInsertSchema(invoiceShareLinks, {
  invoiceType: z.enum(['purchase', 'sales']),
}).omit({
  id: true,
  createdAt: true,
  accessCount: true,
  lastAccessedAt: true,
});

// Types
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;

export type Tenant = typeof tenants.$inferSelect;
export type InsertTenant = z.infer<typeof insertTenantSchema>;

export type Vendor = typeof vendors.$inferSelect;
export type InsertVendor = z.infer<typeof insertVendorSchema>;

export type Item = typeof items.$inferSelect;
export type InsertItem = z.infer<typeof insertItemSchema>;

export type ItemWithVendor = Item & {
  vendor: Vendor | null;
};

export type BankAccount = typeof bankAccounts.$inferSelect;
export type InsertBankAccount = z.infer<typeof insertBankAccountSchema>;

export type PurchaseInvoice = typeof purchaseInvoices.$inferSelect;
export type InsertPurchaseInvoice = z.infer<typeof insertPurchaseInvoiceSchema>;

export type InvoiceItem = typeof invoiceItems.$inferSelect;
export type InsertInvoiceItem = z.infer<typeof insertInvoiceItemSchema>;

export type Payment = typeof payments.$inferSelect;
export type InsertPayment = z.infer<typeof insertPaymentSchema>;

export type Stock = typeof stock.$inferSelect;
export type InsertStock = z.infer<typeof insertStockSchema>;

export type StockMovement = typeof stockMovements.$inferSelect;
export type InsertStockMovement = z.infer<typeof insertStockMovementSchema>;

export type StockMovementWithItem = StockMovement & {
  item: Item & { vendor: Vendor };
};

export type Retailer = typeof retailers.$inferSelect;
export type InsertRetailer = z.infer<typeof insertRetailerSchema>;

export type SalesInvoice = typeof salesInvoices.$inferSelect;
export type InsertSalesInvoice = z.infer<typeof insertSalesInvoiceSchema>;

export type SalesInvoiceItem = typeof salesInvoiceItems.$inferSelect;
export type InsertSalesInvoiceItem = z.infer<typeof insertSalesInvoiceItemSchema>;

export type SalesPayment = typeof salesPayments.$inferSelect;
export type InsertSalesPayment = z.infer<typeof insertSalesPaymentSchema>;

export type CrateTransaction = typeof crateTransactions.$inferSelect;
export type InsertCrateTransaction = z.infer<typeof insertCrateTransactionSchema>;

export type ExpenseCategory = typeof expenseCategories.$inferSelect;
export type InsertExpenseCategory = z.infer<typeof insertExpenseCategorySchema>;

export type Expense = typeof expenses.$inferSelect;
export type InsertExpense = z.infer<typeof insertExpenseSchema>;

export type WhatsAppMessage = typeof whatsappMessages.$inferSelect;
export type InsertWhatsAppMessage = z.infer<typeof insertWhatsAppMessageSchema>;

export type WhatsAppCreditTransaction = typeof whatsappCreditTransactions.$inferSelect;
export type InsertWhatsAppCreditTransaction = z.infer<typeof insertWhatsAppCreditTransactionSchema>;

export type InvoiceShareLink = typeof invoiceShareLinks.$inferSelect;
export type InsertInvoiceShareLink = z.infer<typeof insertInvoiceShareLinkSchema>;

export type CashbookEntry = typeof cashbook.$inferSelect;
export type BankbookEntry = typeof bankbook.$inferSelect;

// Additional types for complex operations
export type InvoiceWithItems = PurchaseInvoice & {
  items: InvoiceItem[];
  vendor: Vendor;
};

export type PaymentWithDetails = Payment & {
  invoice: PurchaseInvoice;
  vendor: Vendor;
  bankAccount?: BankAccount;
};

export type StockWithItem = Stock & {
  item: Item & {
    vendor: Vendor;
  };
};

export type SalesInvoiceWithDetails = SalesInvoice & {
  retailer: Retailer;
  items: SalesInvoiceItem[];
  payments: SalesPayment[];
  crateTransaction?: CrateTransaction;
};

export type SalesPaymentWithDetails = SalesPayment & {
  invoice: SalesInvoice;
  retailer: Retailer;
  bankAccount?: BankAccount;
};

export type ExpenseWithCategory = Expense & {
  category: ExpenseCategory | null;
  bankAccount: BankAccount | null;
};

export type CrateTransactionWithRetailer = CrateTransaction & {
  retailer: Retailer;
};

export type CrateTransactionWithVendor = CrateTransaction & {
  vendor: Vendor;
};

export type CrateTransactionWithParty = CrateTransaction & {
  retailer: Retailer | null;
  vendor: Vendor | null;
};

export type WhatsAppCreditTransactionWithDetails = WhatsAppCreditTransaction & {
  performedByUser?: User;
  message?: WhatsAppMessage;
};

export type PublicInvoiceData = {
  invoice: PurchaseInvoice | SalesInvoice;
  items: InvoiceItem[] | SalesInvoiceItem[];
  payments: Payment[] | SalesPayment[];
  vendor?: Vendor;
  retailer?: Retailer;
  tenant: { name: string; slug: string; settings: any };
  invoiceType: 'purchase' | 'sales';
};

// Pagination types
export type SortOrder = 'asc' | 'desc';

export interface PaginationOptions {
  page?: number;
  limit?: number;
  search?: string;
  sortBy?: string;
  sortOrder?: SortOrder;
  status?: string; // Add this line: 'active', 'inactive', or 'all'
  isActive?: string; // Add this line: 'true', 'false', or undefined for all items
}

export interface PaginationMetadata {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: PaginationMetadata;
}

// Ledger Types
export interface VendorLedgerEntry {
  tenantId: string;
  date: Date;
  description: string;
  referenceType: 'Invoice' | 'Payment';
  referenceId: string;
  debit: number;
  credit: number;
  balance: number;
  invoiceNumber?: string;
  status?: string;
  paymentMode?: string;
  notes?: string | null;
  createdAt?: Date | null;
}

export interface RetailerLedgerEntry {
  tenantId: string;
  date: Date;
  description: string;
  referenceType: 'Sales Invoice' | 'Sales Payment';
  referenceId: string;
  debit: number;
  credit: number;
  balance: number;
  invoiceNumber?: string;
  status?: string;
  paymentMode?: string;
  notes?: string | null;
  createdAt?: Date | null;
}

export interface UdhaaarBookEntry {
  tenantId: string;
  retailerId: string;
  retailerName: string;
  phone: string | null;
  address: string | null;
  udhaarBalance: number;
  udhaaarBalance?: number; // Keep legacy field for backward compatibility
  totalBalance: number;
  shortfallBalance: number;
  crateBalance: number;
  isActive: boolean | null;
  createdAt: Date | null;
}

export interface CrateLedgerEntry {
  id: string;
  tenantId: string;
  retailerId: string;
  retailerName: string | null;
  phone: string | null;
  transactionType: string;
  quantity: number;
  depositAmount: number;
  transactionDate: Date;
  notes: string | null;
  runningBalance: number;
  createdAt: Date | null;
}

export interface BankAccountSummary {
  bankAccountId: string;
  bankName: string;
  accountNumber: string;
  accountHolderName: string;
  totalDebits: number;
  totalCredits: number;
  currentBalance: string;
  transactionCount: number;
}

export interface VendorSummary {
  vendorId: string;
  vendorName: string;
  phone: string | null;
  address: string | null;
  totalInvoices: number;
  totalPayments: number;
  currentBalance: string;
  invoiceCount: number;
  lastInvoiceDate: Date | null;
}

export interface RetailerSummary {
  retailerId: string;
  retailerName: string;
  phone: string | null;
  address: string | null;
  totalSales: number;
  totalPayments: number;
  udhaaarBalance: string;
  shortfallBalance: string;
  invoiceCount: number;
  lastSaleDate: Date | null;
}

// Dashboard Types
export interface RecentPurchase {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  vendorName: string;
  netAmount: string;
  status: string;
}

export interface RecentSale {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  retailerName: string;
  totalAmount: string;
  status: string;
}

export interface TopRetailerByUdhaar {
  id: string;
  name: string;
  phone: string | null;
  udhaaarBalance: string;
}

export interface FavouriteRetailer {
  id: string;
  name: string;
  phone: string | null;
  udhaaarBalance: string;
  shortfallBalance: string;
  crateBalance: number;
}

export interface FavouriteVendor {
  id: string;
  name: string;
  phone: string | null;
  balance: string;
  crateBalance: number;
}

export interface DashboardKPIs {
  todaysSales: string;
  todaysPurchases: string;
  totalUdhaar: string;
  todaysExpenses: string;
  recentPurchases: RecentPurchase[];
  recentSales: RecentSale[];
  favouriteRetailers: FavouriteRetailer[];
  favouriteVendors: FavouriteVendor[];
}

// Authentication Schemas
export const loginSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required')
});

export const refreshTokenSchema = z.object({
  // No body needed for refresh - refresh token comes from HttpOnly cookie
});

// Authentication Types
export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  user: {
    id: string;
    tenantId: string;
    username: string;
    name: string;
    role: string;
    permissions: string[];
  };
}

export interface RefreshTokenRequest {
  // Token from Authorization header
}

export interface RefreshTokenResponse {
  token: string;
  user: {
    id: string;
    tenantId: string;
    username: string;
    name: string;
    role: string;
    permissions: string[];
  };
}

// REPORT TYPES
export interface TurnoverReportEntry {
  date: string;
  salesAmount: string;
  purchaseAmount: string;
  netTurnover: string;
}

export interface TurnoverReportData {
  entries: TurnoverReportEntry[];
  totalSales: string;
  totalPurchases: string;
  netTurnover: string;
  fromDate?: string;
  toDate?: string;
}

export interface ProfitLossReportData {
  revenue: string;
  costs: string;
  grossProfit: string;
  expenses: string;
  netProfit: string;
  fromDate?: string;
  toDate?: string;
}

export interface CommissionReportEntry {
  invoiceNumber: string;
  invoiceDate: string;
  vendorName: string;
  retailerName?: string; // Backward compatibility alias for vendorName
  totalAmount: string;
  commissionRate: string;
  commissionAmount: string;
}

export interface CommissionReportData {
  entries: CommissionReportEntry[];
  totalCommission: string;
  fromDate?: string;
  toDate?: string;
}

export interface ShortfallReportEntry {
  retailerId: string;
  retailerName: string;
  shortfallBalance: string;
  lastTransactionDate: string;
}

export interface ShortfallReportData {
  entries: ShortfallReportEntry[];
  totalShortfall: string;
  fromDate?: string;
  toDate?: string;
}

export interface ExpensesSummaryEntry {
  category: string;
  amount: string;
  count: number;
  percentage: string;
}

export interface ExpensesSummaryData {
  entries: ExpensesSummaryEntry[];
  totalExpenses: string;
  fromDate?: string;
  toDate?: string;
}

export interface VendorListEntry {
  vendorId: string;
  vendorName: string;
  phone: string | null;
  address: string | null;
  balance: string;
}

export interface VendorsListData {
  entries: VendorListEntry[];
  totalPayable: string;
}

export interface RetailerListEntry {
  retailerId: string;
  retailerName: string;
  phone: string | null;
  address: string | null;
  udhaaarBalance: string;
}

export interface RetailersListData {
  entries: RetailerListEntry[];
  totalReceivable: string;
}

// Report query parameter validation schema
export const reportDateRangeSchema = z.object({
  fromDate: z.string().optional().refine(val => {
    if (!val) return true;
    const date = new Date(val);
    return !isNaN(date.getTime());
  }, 'Invalid date format for fromDate'),
  toDate: z.string().optional().refine(val => {
    if (!val) return true;
    const date = new Date(val);
    return !isNaN(date.getTime());
  }, 'Invalid date format for toDate'),
}).refine(({fromDate, toDate}) => !fromDate || !toDate || new Date(fromDate) <= new Date(toDate), {
  message: 'fromDate must be before or equal to toDate'
});


// Export everything as default for compatibility with tsx
export default {
  // Tables
  users, tenants, vendors, items, bankAccounts, purchaseInvoices, invoiceItems, 
  payments, stock, stockMovements, cashbook, bankbook, retailers, salesInvoices,
  salesInvoiceItems, salesPayments, crateTransactions, expenseCategories, expenses,
  whatsappMessages, whatsappCreditTransactions, invoiceShareLinks,
  
  // Constants
  CRATE_TRANSACTION_TYPES, INVOICE_STATUS,
  
  // Schemas
  insertUserSchema, insertTenantSchema, insertVendorSchema, insertItemSchema,
  insertBankAccountSchema, updateBankAccountSchema, insertBankDepositSchema,
  insertBankWithdrawalSchema, insertPurchaseInvoiceSchema, insertInvoiceItemSchema,
  insertPaymentSchema, insertStockSchema, insertStockMovementSchema, insertRetailerSchema,
  insertSalesInvoiceSchema, insertSalesInvoiceItemSchema, insertSalesPaymentSchema,
  insertVendorPaymentSchema, insertRetailerPaymentSchema, insertCrateTransactionSchema,
  insertExpenseCategorySchema, insertExpenseSchema, insertWhatsAppMessageSchema,
  insertWhatsAppCreditTransactionSchema, insertInvoiceShareLinkSchema,
  loginSchema, refreshTokenSchema, phoneNumberSchema, indianTenDigitPhone,
  tenantSettingsSchema, reportDateRangeSchema,
  
  // Types (interfaces need to be re-exported differently)
  PaginationOptions: {} as any,
  PaginatedResult: {} as any,
  // Add other interface types here
};