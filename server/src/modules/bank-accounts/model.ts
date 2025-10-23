import { eq, asc, and, count, sum, sql, desc, isNull } from 'drizzle-orm';
import { db } from '../../../db';
import schema from '../../../shared/schema.js';
import { TenantModel } from '../tenants/model';
import { withTenant, ensureTenantInsert } from '../../utils/tenant-scope';
import { applySorting, applySearchFilter, getCountWithSearch, buildPaginationMetadata, withTenantPagination } from '../../utils/pagination';
import { BadRequestError, NotFoundError } from '../../types';

// Destructure what you need from the default export
const { 
  bankAccounts, 
  payments,
  salesPayments,
  bankbook,
  cashbook,
  expenses
} = schema;

// Define types from the schema
type BankAccount = typeof schema.bankAccounts.$inferSelect;
type InsertBankAccount = typeof schema.insertBankAccountSchema._input;
type PaginationOptions = typeof schema.PaginationOptions;
type PaginatedResult<T> = typeof schema.PaginatedResult<T>;

export class BankAccountModel {
  async getBankAccounts(tenantId: string): Promise<BankAccount[]> {
    return await db.select().from(bankAccounts)
      .where(withTenant(bankAccounts, tenantId, eq(bankAccounts.isActive, true)))
      .orderBy(asc(bankAccounts.name));
  }

  async getBankAccountById(tenantId: string, id: string): Promise<BankAccount | undefined> {
    const [bankAccount] = await db.select().from(bankAccounts)
      .where(withTenant(bankAccounts, tenantId, eq(bankAccounts.id, id)));
    return bankAccount;
  }

  async createBankAccount(tenantId: string, insertBankAccount: InsertBankAccount & { openingDate?: Date }): Promise<BankAccount> {
    return await db.transaction(async (tx) => {
      // Insert the bank account with the provided balance
      const [created] = await tx.insert(bankAccounts)
        .values(ensureTenantInsert(insertBankAccount, tenantId))
        .returning();

      // Check if the balance is greater than 0 and create opening balance entry
      const balance = parseFloat(insertBankAccount.balance || '0');
      if (balance > 0) {
        await tx.insert(bankbook)
          .values(ensureTenantInsert({
            bankAccountId: created.id,
            date: insertBankAccount.openingDate || created.createdAt || new Date(),
            description: "Opening Balance",
            debit: balance.toFixed(2),
            credit: "0.00",
            balance: balance.toFixed(2),
            referenceType: "Opening Balance",
            referenceId: null
          }, tenantId));

        // Recalculate balance to ensure consistency
        await BankAccountModel.recalculateBankAccountBalance(tx, tenantId, created.id);
      }

      return created;
    });
  }

  async updateBankAccount(tenantId: string, id: string, insertBankAccount: Partial<InsertBankAccount>): Promise<BankAccount | undefined> {
    const [updated] = await db.update(bankAccounts)
      .set(insertBankAccount)
      .where(withTenant(bankAccounts, tenantId, eq(bankAccounts.id, id)))
      .returning();
    return updated;
  }

  async deleteBankAccount(tenantId: string, id: string): Promise<boolean> {
    return await db.transaction(async (tx) => {
      // Check if bank account is referenced in payments table
      const paymentReferences = await tx.select({ count: count() }).from(payments)
        .where(withTenant(payments, tenantId, eq(payments.bankAccountId, id)));
      
      if (paymentReferences[0].count > 0) {
        throw new BadRequestError('Cannot delete bank account: it is referenced in payments');
      }

      // Check if bank account is referenced in salesPayments table
      const salesPaymentReferences = await tx.select({ count: count() }).from(salesPayments)
        .where(withTenant(salesPayments, tenantId, eq(salesPayments.bankAccountId, id)));
      
      if (salesPaymentReferences[0].count > 0) {
        throw new BadRequestError('Cannot delete bank account: it is referenced in sales payments');
      }

      // Check if bank account is referenced in bankbook table
      const bankbookReferences = await tx.select({ count: count() }).from(bankbook)
        .where(withTenant(bankbook, tenantId, eq(bankbook.bankAccountId, id)));
      
      if (bankbookReferences[0].count > 0) {
        throw new BadRequestError('Cannot delete bank account: it is referenced in bank book entries');
      }

      // Check if bank account is referenced in expenses table
      const expenseReferences = await tx.select({ count: count() }).from(expenses)
        .where(withTenant(expenses, tenantId, eq(expenses.bankAccountId, id)));
      
      if (expenseReferences[0].count > 0) {
        throw new BadRequestError('Cannot delete bank account: it is referenced in expenses');
      }

      // If no references found, delete the bank account
      const [deletedBankAccount] = await tx.delete(bankAccounts)
        .where(withTenant(bankAccounts, tenantId, eq(bankAccounts.id, id)))
        .returning();
      
      return !!deletedBankAccount;
    });
  }

  static async getBankAccountsPaginated(tenantId: string, options: PaginationOptions): Promise<PaginatedResult<BankAccount>> {
    const { page, limit, offset, tenantCondition } = withTenantPagination(bankAccounts, tenantId, options);
    
    // Define table columns for sorting and searching
    const tableColumns = {
      name: bankAccounts.name,
      accountNumber: bankAccounts.accountNumber,
      bankName: bankAccounts.bankName,
      balance: bankAccounts.balance,
      createdAt: bankAccounts.createdAt
    };
    
    const searchableColumns = [bankAccounts.name, bankAccounts.accountNumber, bankAccounts.bankName];
    
    // Build WHERE conditions array starting with tenant filtering
    const whereConditions = [tenantCondition];
    
    // Filter by active bank accounts by default unless status is 'all'
    if (options.status !== 'all') {
      const isActive = options.status === 'inactive' ? false : true;
      whereConditions.push(eq(bankAccounts.isActive, isActive));
    }
    
    // Combine all conditions
    const combinedCondition = and(...whereConditions)!;
    
    let query = db.select().from(bankAccounts).where(combinedCondition);
    
    // Apply search filter using helper
    if (options.search) {
      query = applySearchFilter(query, options.search, searchableColumns, combinedCondition);
    }
    
    // Apply sorting using helper
    query = applySorting(query, options.sortBy || 'name', options.sortOrder || 'asc', tableColumns);
    
    // Apply pagination and execute
    const data = await query.limit(limit).offset(offset);
    
    // Get total count with tenant and isActive filtering
    const total = await getCountWithSearch(
      bankAccounts, 
      options.search ? searchableColumns : undefined, 
      options.search,
      combinedCondition
    );
    
    const pagination = buildPaginationMetadata(page, limit, total);
    
    return { data, pagination };
  }

  async getBankAccountStats(tenantId: string): Promise<{ totalAccounts: number; totalBalance: string }> {
    const [stats] = await db.select({
      totalAccounts: count(),
      totalBalance: sum(bankAccounts.balance)
    }).from(bankAccounts)
      .where(withTenant(bankAccounts, tenantId, eq(bankAccounts.isActive, true)));

    return {
      totalAccounts: stats.totalAccounts,
      totalBalance: stats.totalBalance || '0.00'
    };
  }

  static async updateBankAccountBalance(tx: any, tenantId: string, bankAccountId: string, amountDelta: number): Promise<void> {
    // Use atomic SQL increment to avoid concurrent update races
    const result = await tx.update(bankAccounts)
      .set({ 
        balance: sql`ROUND(COALESCE(${bankAccounts.balance}, 0)::numeric + ${amountDelta}, 2)::text`
      })
      .where(withTenant(bankAccounts, tenantId, eq(bankAccounts.id, bankAccountId)));
    
    // Check if bank account exists (affected rows)
    if (result.rowCount === 0) {
      throw new Error('Bank account not found');
    }
  }

  static async setBankAccountBalance(tx: any, tenantId: string, bankAccountId: string, newBalance: string): Promise<void> {
    // Set bank account balance to specific value to align with bankbook running balance
    const result = await tx.update(bankAccounts)
      .set({ balance: newBalance })
      .where(withTenant(bankAccounts, tenantId, eq(bankAccounts.id, bankAccountId)));
    
    // Check if bank account exists (affected rows)
    if (result.rowCount === 0) {
      throw new Error('Bank account not found');
    }
  }

  static async recalculateBankAccountBalance(tx: any, tenantId: string, bankAccountId: string): Promise<string> {
    // Fetch all bankbook entries for the given bank account ordered chronologically
    const allBankEntries = await tx.select().from(bankbook)
      .where(withTenant(bankbook, tenantId, eq(bankbook.bankAccountId, bankAccountId)))
      .orderBy(asc(bankbook.date), asc(bankbook.id));
    
    let runningBalance = 0.00;
    for (const entry of allBankEntries) {
      // Calculate balance using formula: balance = previous_balance + debit - credit
      runningBalance += parseFloat(entry.debit || '0') - parseFloat(entry.credit || '0');
      
      // Update the bankbook entry with corrected balance
      await tx.update(bankbook)
        .set({ balance: runningBalance.toFixed(2) })
        .where(withTenant(bankbook, tenantId, eq(bankbook.id, entry.id)));
    }
    
    const finalBalance = runningBalance.toFixed(2);
    
    // Update the bank account's balance to match the final bankbook balance
    await this.setBankAccountBalance(tx, tenantId, bankAccountId, finalBalance);
    
    return finalBalance;
  }

  async createDeposit(tenantId: string, bankAccountId: string, depositData: { amount: string, date: Date, description: string, source: 'cash' | 'external' }): Promise<void> {
    try {
      await db.transaction(async (tx) => {
        // Validate that bank account exists
        const bankAccount = await tx.select().from(bankAccounts)
          .where(withTenant(bankAccounts, tenantId, eq(bankAccounts.id, bankAccountId)))
          .limit(1);
        
        if (!bankAccount.length) {
          throw new BadRequestError('Bank account not found');
        }

        // Parse and validate amount
        const depositAmount = parseFloat(depositData.amount);
        if (isNaN(depositAmount) || depositAmount <= 0) {
          throw new BadRequestError('Invalid deposit amount');
        }

        // Handle cash deposits - create cashbook entry and update cash balance
        if (depositData.source === 'cash') {
          // Get current cash balance using consistent method
          const currentCashBalance = await TenantModel.getCashBalance(tenantId);
          const newCashBalance = currentCashBalance - depositAmount;

          // Validate sufficient cash balance
          if (newCashBalance < 0) {
            throw new BadRequestError('Insufficient cash balance for deposit');
          }

          // Create cashbook entry
          await tx.insert(cashbook).values(ensureTenantInsert({
            date: depositData.date,
            description: `Transfer to Bank - ${bankAccount[0].name}`,
            outflow: depositAmount.toFixed(2),
            inflow: '0.00',
            balance: newCashBalance.toFixed(2),
            referenceType: 'Bank Deposit',
            referenceId: null
          }, tenantId));

          // Update tenant cash balance
          await TenantModel.setCashBalance(tx, tenantId, newCashBalance.toFixed(2));
        }

        // Get last bankbook entry for current balance with row locking
        const lastBankEntry = await tx.select()
          .from(bankbook)
          .where(withTenant(bankbook, tenantId, eq(bankbook.bankAccountId, bankAccountId)))
          .orderBy(desc(bankbook.date), desc(bankbook.id))
          .limit(1)
          .for('update');

        const currentBankBalance = lastBankEntry.length > 0 ? parseFloat(lastBankEntry[0].balance) : 0;
        const newBankBalance = currentBankBalance + depositAmount;

        // Create bankbook entry
        await tx.insert(bankbook).values(ensureTenantInsert({
          bankAccountId,
          date: depositData.date,
          description: depositData.source === 'cash' ? `Deposit from Cash - ${depositData.description}` : depositData.description,
          debit: depositAmount.toFixed(2),
          credit: '0.00',
          balance: newBankBalance.toFixed(2),
          referenceType: 'Bank Deposit',
          referenceId: null
        }, tenantId));

        // Check if entry is back-dated and recompute balances if needed
        const isBackDated = lastBankEntry.length > 0 && depositData.date < lastBankEntry[0].date;
        
        if (isBackDated) {
          // Recompute all balances from this date forward
          await BankAccountModel.recalculateBankAccountBalance(tx, tenantId, bankAccountId);
        } else {
          // Update bank account balance normally
          await BankAccountModel.setBankAccountBalance(tx, tenantId, bankAccountId, newBankBalance.toFixed(2));
        }
      });
    } catch (error) {
      if (error instanceof BadRequestError) {
        throw error;
      }
      throw new BadRequestError(`Failed to record deposit: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async createWithdrawal(tenantId: string, bankAccountId: string, withdrawalData: { amount: string, date: Date, description: string }): Promise<void> {
    try {
      await db.transaction(async (tx) => {
        // Validate that bank account exists
        const bankAccount = await tx.select().from(bankAccounts)
          .where(withTenant(bankAccounts, tenantId, eq(bankAccounts.id, bankAccountId)))
          .limit(1);
        
        if (!bankAccount.length) {
          throw new BadRequestError('Bank account not found');
        }

        // Parse and validate amount
        const withdrawalAmount = parseFloat(withdrawalData.amount);
        if (isNaN(withdrawalAmount) || withdrawalAmount <= 0) {
          throw new BadRequestError('Invalid withdrawal amount');
        }

        // Get last bankbook entry for current balance with row locking
        const lastBankEntry = await tx.select()
          .from(bankbook)
          .where(withTenant(bankbook, tenantId, eq(bankbook.bankAccountId, bankAccountId)))
          .orderBy(desc(bankbook.date), desc(bankbook.id))
          .limit(1)
          .for('update');

        const currentBankBalance = lastBankEntry.length > 0 ? parseFloat(lastBankEntry[0].balance) : 0;
        const newBankBalance = currentBankBalance - withdrawalAmount;

        // Validate sufficient bank balance
        if (newBankBalance < 0) {
          throw new BadRequestError('Insufficient bank account balance for withdrawal');
        }

        // Create bankbook entry
        await tx.insert(bankbook).values(ensureTenantInsert({
          bankAccountId,
          date: withdrawalData.date,
          description: withdrawalData.description,
          credit: withdrawalAmount.toFixed(2),
          debit: '0.00',
          balance: newBankBalance.toFixed(2),
          referenceType: 'Bank Withdrawal',
          referenceId: null
        }, tenantId));

        // Check if entry is back-dated and recompute balances if needed
        const isBackDated = lastBankEntry.length > 0 && withdrawalData.date < lastBankEntry[0].date;
        
        if (isBackDated) {
          // Recompute all balances from this date forward
          await BankAccountModel.recalculateBankAccountBalance(tx, tenantId, bankAccountId);
        } else {
          // Update bank account balance normally
          await BankAccountModel.setBankAccountBalance(tx, tenantId, bankAccountId, newBankBalance.toFixed(2));
        }
      });
    } catch (error) {
      if (error instanceof BadRequestError) {
        throw error;
      }
      throw new BadRequestError(`Failed to record withdrawal: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Delete a manually created bank deposit or withdrawal transaction.
   * Only allows deletion if referenceType is 'Bank Deposit' or 'Bank Withdrawal' and referenceId is null.
   * Also reverses associated cashbook entry for cash deposits.
   */
  async deleteManualTransaction(tenantId: string, bankAccountId: string, transactionId: string): Promise<void> {
    try {
      await db.transaction(async (tx) => {
        // Fetch the bankbook entry
        const [bankEntry] = await tx.select().from(bankbook)
          .where(withTenant(bankbook, tenantId, and(eq(bankbook.id, transactionId), eq(bankbook.bankAccountId, bankAccountId))));
        if (!bankEntry) throw new NotFoundError('Bank transaction not found');
        
        // Validate manual transaction
        if (!(bankEntry.referenceId == null && (bankEntry.referenceType === 'Bank Deposit' || bankEntry.referenceType === 'Bank Withdrawal'))) {
          throw new BadRequestError('Only manually created deposits and withdrawals can be deleted');
        }

        // If deposit from cash, reverse the cashbook entry
        if (bankEntry.referenceType === 'Bank Deposit') {
          // Get bank account name for precise cashbook matching
          const [bankAccount] = await tx.select().from(bankAccounts)
            .where(withTenant(bankAccounts, tenantId, eq(bankAccounts.id, bankAccountId)));
          if (!bankAccount) throw new NotFoundError('Bank account not found');
          
          const expectedDescription = `Transfer to Bank - ${bankAccount.name}`;
          const [cashEntry] = await tx.select().from(cashbook)
            .where(withTenant(cashbook, tenantId, and(
              eq(cashbook.referenceType, 'Bank Deposit'),
              isNull(cashbook.referenceId),
              eq(cashbook.date, bankEntry.date),
              eq(cashbook.outflow, bankEntry.debit || '0.00'),
              eq(cashbook.description, expectedDescription)
            )));
          if (cashEntry) {
            // Get and update cash balance
            const currentCashBalance = await TenantModel.getCashBalance(tenantId);
            const newCashBalance = currentCashBalance + parseFloat(cashEntry.outflow || '0');
            await tx.delete(cashbook).where(eq(cashbook.id, cashEntry.id));
            await TenantModel.setCashBalance(tx, tenantId, newCashBalance.toFixed(2));
            
            // Recalculate cashbook balances from the deleted entry position forward
            await this.recalculateCashbookBalances(tx, tenantId, cashEntry.date);
          }
        }

        // Delete the bankbook entry
        await tx.delete(bankbook).where(withTenant(bankbook, tenantId, eq(bankbook.id, transactionId)));

        // Recalculate bankbook balances and update bank account
        await BankAccountModel.recalculateBankAccountBalance(tx, tenantId, bankAccountId);
      });
    } catch (error) {
      if (error instanceof BadRequestError || error instanceof NotFoundError) {
        throw error;
      }
      throw new BadRequestError(`Failed to delete transaction: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Recalculate cashbook balances from a specific date forward.
   * Helper method to optimize balance recalculation after cashbook entry deletion.
   */
  private async recalculateCashbookBalances(tx: any, tenantId: string, fromDate: Date): Promise<void> {
    // Get all cashbook entries from the specified date forward, ordered chronologically
    const cashEntries = await tx.select().from(cashbook)
      .where(withTenant(cashbook, tenantId, sql`${cashbook.date} >= ${fromDate}`))
      .orderBy(asc(cashbook.date), asc(cashbook.id));

    if (cashEntries.length === 0) return;

    // Get the balance from the entry just before the fromDate to start with correct running balance
    const previousEntry = await tx.select().from(cashbook)
      .where(withTenant(cashbook, tenantId, sql`${cashbook.date} < ${fromDate}`))
      .orderBy(desc(cashbook.date), desc(cashbook.id))
      .limit(1);

    let runningBalance = previousEntry.length > 0 ? parseFloat(previousEntry[0].balance || '0') : 0.0;

    // Recalculate balances for all entries from the specified date forward
    for (const entry of cashEntries) {
      runningBalance += parseFloat(entry.inflow || '0') - parseFloat(entry.outflow || '0');
      await tx.update(cashbook)
        .set({ balance: runningBalance.toFixed(2) })
        .where(eq(cashbook.id, entry.id));
    }
  }
}