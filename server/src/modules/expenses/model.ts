import { eq, desc, asc, inArray, and, count } from 'drizzle-orm';
import { db } from '../../../db';
import schema from '../../../shared/schema.js';

const { expenseCategories, expenses, bankAccounts, cashbook, bankbook } = schema;

type ExpenseCategory = typeof schema.expenseCategories.$inferSelect;
type InsertExpenseCategory = typeof schema.insertExpenseCategorySchema._input;
type Expense = typeof schema.expenses.$inferSelect;
type InsertExpense = typeof schema.insertExpenseSchema._input;
type ExpenseWithCategory = typeof schema.ExpenseWithCategory;
type PaginationOptions = typeof schema.PaginationOptions;
type PaginatedResult<T> = typeof schema.PaginatedResult<T>;
import { withTenant, ensureTenantInsert } from '../../utils/tenant-scope';
import { BankAccountModel } from '../bank-accounts/model';
import { TenantModel } from '../tenants/model';
import { 
  normalizePaginationOptions, 
  buildPaginationMetadata, 
  applySorting, 
  applySearchFilter,
  withTenantPagination 
} from '../../utils/pagination';

export class ExpenseModel {
  async getExpenseCategories(tenantId: string): Promise<ExpenseCategory[]> {
    return await db.select().from(expenseCategories)
      .where(withTenant(expenseCategories, tenantId, eq(expenseCategories.isActive, true)))
      .orderBy(asc(expenseCategories.name));
  }

  async getExpenseCategory(tenantId: string, id: string): Promise<ExpenseCategory | undefined> {
    const [category] = await db.select().from(expenseCategories)
      .where(withTenant(expenseCategories, tenantId, eq(expenseCategories.id, id)));
    return category;
  }

  async createExpenseCategory(tenantId: string, categoryData: InsertExpenseCategory): Promise<ExpenseCategory> {
    const categoryWithTenant = ensureTenantInsert(categoryData, tenantId);
    const [category] = await db.insert(expenseCategories).values(categoryWithTenant).returning();
    return category;
  }

  async updateExpenseCategory(tenantId: string, id: string, categoryData: Partial<InsertExpenseCategory>): Promise<ExpenseCategory | undefined> {
    const [category] = await db.update(expenseCategories)
      .set(categoryData)
      .where(withTenant(expenseCategories, tenantId, eq(expenseCategories.id, id)))
      .returning();
    return category;
  }

  async deleteExpenseCategory(tenantId: string, id: string): Promise<boolean> {
    const [category] = await db.update(expenseCategories)
      .set({ isActive: false })
      .where(withTenant(expenseCategories, tenantId, eq(expenseCategories.id, id)))
      .returning();
    return !!category;
  }

  async getExpenses(tenantId: string): Promise<ExpenseWithCategory[]> {
    const expensesData = await db.select().from(expenses)
      .where(withTenant(expenses, tenantId))
      .orderBy(desc(expenses.createdAt));

    if (expensesData.length === 0) {
      return [];
    }

    // Batch fetch related data
    const categoryIds = expensesData.map(e => e.categoryId);
    const bankAccountIds = expensesData
      .map(e => e.bankAccountId)
      .filter(id => id !== null) as string[];

    const [categoriesData, bankAccountsData] = await Promise.all([
      categoryIds.length > 0 ? db.select().from(expenseCategories).where(withTenant(expenseCategories, tenantId, inArray(expenseCategories.id, categoryIds))) : [],
      bankAccountIds.length > 0 ? db.select().from(bankAccounts).where(withTenant(bankAccounts, tenantId, inArray(bankAccounts.id, bankAccountIds))) : []
    ]);

    // Create lookup maps
    const categoryMap = new Map(categoriesData.map(c => [c.id, c]));
    const bankAccountMap = new Map(bankAccountsData.map(b => [b.id, b]));

    // Assemble final data
    const result = expensesData.map(expense => ({
      ...expense,
      category: categoryMap.get(expense.categoryId) || null,
      bankAccount: expense.bankAccountId ? (bankAccountMap.get(expense.bankAccountId) || null) : null
    }));

    return result;
  }

  async getExpensesPaginated(
    tenantId: string, 
    options: PaginationOptions,
    categoryId?: string,
    paymentMode?: string
  ): Promise<PaginatedResult<ExpenseWithCategory>> {
    const { page, limit, offset, tenantCondition } = withTenantPagination(expenses, tenantId, options);
    
    // Define table columns for sorting and searching
    const tableColumns = {
      paymentDate: expenses.paymentDate,
      description: expenses.description,
      amount: expenses.amount,
      paymentMode: expenses.paymentMode,
      createdAt: expenses.createdAt
    };
    
    const searchableColumns = [expenses.description];
    
    // Build conditions
    let conditions = [tenantCondition];
    
    if (categoryId) {
      conditions.push(eq(expenses.categoryId, categoryId));
    }
    
    if (paymentMode) {
      conditions.push(eq(expenses.paymentMode, paymentMode));
    }
    
    const combinedCondition = and(...conditions);
    
    // Build base query
    let query = db.select().from(expenses).where(combinedCondition);
    
    // Apply search filter
    if (options.search) {
      query = applySearchFilter(query, options.search, searchableColumns, combinedCondition);
    }
    
    // Apply sorting (default to paymentDate desc)
    query = applySorting(query, options.sortBy || 'paymentDate', options.sortOrder || 'desc', tableColumns);
    
    // Execute paginated query
    const expensesData = await query.limit(limit).offset(offset);
    
    // Get total count with same filters
    let countQuery = db.select({ count: count() }).from(expenses).where(combinedCondition);
    
    if (options.search) {
      countQuery = applySearchFilter(countQuery, options.search, searchableColumns, combinedCondition);
    }
    
    const [{ count: total }] = await countQuery;
    
    if (expensesData.length === 0) {
      return {
        data: [],
        pagination: buildPaginationMetadata(page, limit, total)
      };
    }

    // Batch fetch related data
    const categoryIds = expensesData.map(e => e.categoryId);
    const bankAccountIds = expensesData
      .map(e => e.bankAccountId)
      .filter(id => id !== null) as string[];

    const [categoriesData, bankAccountsData] = await Promise.all([
      categoryIds.length > 0 ? db.select().from(expenseCategories).where(withTenant(expenseCategories, tenantId, inArray(expenseCategories.id, categoryIds))) : [],
      bankAccountIds.length > 0 ? db.select().from(bankAccounts).where(withTenant(bankAccounts, tenantId, inArray(bankAccounts.id, bankAccountIds))) : []
    ]);

    // Create lookup maps
    const categoryMap = new Map(categoriesData.map(c => [c.id, c]));
    const bankAccountMap = new Map(bankAccountsData.map(b => [b.id, b]));

    // Assemble final data
    const result = expensesData.map(expense => ({
      ...expense,
      category: categoryMap.get(expense.categoryId) || null,
      bankAccount: expense.bankAccountId ? (bankAccountMap.get(expense.bankAccountId) || null) : null
    }));

    return {
      data: result,
      pagination: buildPaginationMetadata(page, limit, total)
    };
  }

  async getExpense(tenantId: string, id: string): Promise<ExpenseWithCategory | undefined> {
    const [expense] = await db.select().from(expenses)
      .where(withTenant(expenses, tenantId, eq(expenses.id, id)));

    if (!expense) {
      return undefined;
    }

    // Get related data with tenant filtering
    const [category, bankAccount] = await Promise.all([
      db.select().from(expenseCategories).where(withTenant(expenseCategories, tenantId, eq(expenseCategories.id, expense.categoryId))).then(result => result[0]),
      expense.bankAccountId ? 
        db.select().from(bankAccounts).where(withTenant(bankAccounts, tenantId, eq(bankAccounts.id, expense.bankAccountId))).then(result => result[0]) : 
        undefined
    ]);

    return {
      ...expense,
      category: category || null,
      bankAccount: bankAccount || null
    } as ExpenseWithCategory;
  }

  async createExpense(tenantId: string, expenseData: InsertExpense): Promise<ExpenseWithCategory> {
    return await db.transaction(async (tx) => {
      // Validate category and bank account exist before creating with tenant filtering
      const [category, bankAccount] = await Promise.all([
        tx.select().from(expenseCategories).where(withTenant(expenseCategories, tenantId, eq(expenseCategories.id, expenseData.categoryId))).then(result => result[0]),
        expenseData.bankAccountId ? 
          tx.select().from(bankAccounts).where(withTenant(bankAccounts, tenantId, eq(bankAccounts.id, expenseData.bankAccountId))).then(result => result[0]) : 
          null
      ]);

      if (!category) {
        throw new Error('Invalid category');
      }

      if (expenseData.bankAccountId && !bankAccount) {
        throw new Error('Invalid bank account');
      }

      const expenseWithTenant = ensureTenantInsert(expenseData, tenantId);
      const [expense] = await tx.insert(expenses).values(expenseWithTenant).returning();

      // Add cashbook entry for cash payments
      if (expenseData.paymentMode === 'Cash') {
        // Query the last cashbook entry
        const lastCashEntry = await tx.select().from(cashbook)
          .where(withTenant(cashbook, tenantId))
          .orderBy(desc(cashbook.createdAt))
          .limit(1);

        // Calculate current balance
        const currentBalance = lastCashEntry.length > 0 ? parseFloat(lastCashEntry[0].balance) : 0;

        // Calculate new balance (expense is outflow)
        const newBalance = currentBalance - parseFloat(expenseData.amount);

        // Insert cashbook entry
        await tx.insert(cashbook).values(ensureTenantInsert({
          date: expenseData.paymentDate,
          description: `Expense - ${category.name}: ${expenseData.description}`,
          outflow: expenseData.amount,
          inflow: '0.00',
          balance: newBalance.toFixed(2),
          referenceType: 'Expense',
          referenceId: expense.id,
        }, tenantId));

        // Update tenant cash balance
        await TenantModel.setCashBalance(tx, tenantId, newBalance.toFixed(2));
      }

      // Add bankbook entry for bank payments
      if (expenseData.paymentMode === 'Bank' && expenseData.bankAccountId) {
        // Query the last bankbook entry for this bank account
        const lastBankEntry = await tx.select().from(bankbook)
          .where(withTenant(bankbook, tenantId, eq(bankbook.bankAccountId, expenseData.bankAccountId)))
          .orderBy(desc(bankbook.date), desc(bankbook.id))
          .limit(1)
          .for('update');

        // Calculate current balance
        const currentBalance = lastBankEntry.length > 0 ? parseFloat(lastBankEntry[0].balance) : 0;

        // Calculate new balance (expense is outflow)
        const newBalance = currentBalance - parseFloat(expenseData.amount);

        // Insert bankbook entry
        await tx.insert(bankbook).values(ensureTenantInsert({
          bankAccountId: expenseData.bankAccountId,
          date: expenseData.paymentDate,
          description: `Expense - ${category.name}: ${expenseData.description}`,
          credit: expenseData.amount,
          debit: '0.00',
          balance: newBalance.toFixed(2),
          referenceType: 'Expense',
          referenceId: expense.id,
        }, tenantId));

        // Align bank account balance with bankbook running balance
        await BankAccountModel.setBankAccountBalance(tx, tenantId, expenseData.bankAccountId, newBalance.toFixed(2));
      }

      return {
        ...expense,
        category: category || null,
        bankAccount: bankAccount || null
      };
    });
  }
}