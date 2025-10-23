import { Request, Response } from 'express';
import { BaseController } from '../../utils/base';
import { BankAccountModel } from './model';
import { type AuthenticatedRequest, ForbiddenError, BadRequestError, NotFoundError } from '../../types';
import schema from '../../../shared/schema.js';

const { insertBankAccountSchema, updateBankAccountSchema, insertBankDepositSchema, insertBankWithdrawalSchema } = schema;
export class BankAccountController extends BaseController {
  private bankAccountModel: BankAccountModel;

  constructor() {
    super();
    this.bankAccountModel = new BankAccountModel();
  }

  async getAll(req: AuthenticatedRequest, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    
    // Check if pagination is requested
    const isPaginated = req.query.page || req.query.limit || req.query.paginated === 'true';

    if (!isPaginated) {
      // Return simple array response
      const bankAccounts = await this.bankAccountModel.getBankAccounts(tenantId);
      return res.json(bankAccounts);
    }

    // Use base controller utilities for pagination parsing
    const opts = {
      ...this.getPaginationOptions(req.query),
      status: req.query.status as string,
      search: req.query.search as string
    };

    // Validate pagination parameters (with defaults from getPaginationOptions)
    const page = opts.page || 1;
    const limit = opts.limit || 10;

    if (page < 1) {
      throw new BadRequestError("Page must be >= 1");
    }

    if (limit < 1 || limit > 100) {
      throw new BadRequestError("Limit must be between 1 and 100");
    }

    // Validate sortBy if provided
    const validSortFields = ['name', 'accountNumber', 'bankName', 'balance', 'createdAt'];
    if (opts.sortBy && !validSortFields.includes(opts.sortBy)) {
      throw new BadRequestError("Invalid sortBy field");
    }

    const result = await BankAccountModel.getBankAccountsPaginated(tenantId, opts);

    this.sendPaginatedResponse(res, result.data, result.pagination);
  }

  async getById(req: AuthenticatedRequest, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    
    const bankAccount = await this.bankAccountModel.getBankAccountById(tenantId, req.params.id);
    this.ensureResourceExists(bankAccount, "Bank Account");
    
    res.json(bankAccount);
  }

  /**
   * Create a new bank account with optional initial balance.
   * If initial balance > 0, an opening balance entry will be created in bankbook.
   */
  async create(req: AuthenticatedRequest, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    
    const validatedData = this.validateZodSchema(insertBankAccountSchema, { 
      ...req.body, 
      tenantId,
      balance: req.body.balance || "0.00"
    });
    
    const bankAccount = await this.bankAccountModel.createBankAccount(tenantId, validatedData);
    
    res.status(201).json(bankAccount);
  }

  async update(req: AuthenticatedRequest, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    
    const validatedData = this.validateZodSchema(updateBankAccountSchema.partial(), { ...req.body, tenantId });
    
    const bankAccount = await this.bankAccountModel.updateBankAccount(tenantId, req.params.id, validatedData);
    this.ensureResourceExists(bankAccount, "Bank Account");
    
    res.json(bankAccount);
  }

  async delete(req: AuthenticatedRequest, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;
    
    const result = await this.wrapDatabaseOperation(() =>
      this.bankAccountModel.deleteBankAccount(tenantId, req.params.id)
    );
    
    if (!result) {
      throw new NotFoundError("Bank Account");
    }
    
    res.json({ message: "Bank account deleted successfully" });
  }

  async deposit(req: AuthenticatedRequest, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;

    const bankAccountId = this.sanitizeAndValidateUUID(req.params.id, 'Bank Account ID');
    const validatedData = this.validateZodSchema(insertBankDepositSchema, req.body);

    // Verify bank account exists
    const bankAccount = await this.wrapDatabaseOperation(() =>
      this.bankAccountModel.getBankAccountById(tenantId, bankAccountId)
    );
    this.ensureResourceExists(bankAccount, 'Bank Account');

    await this.wrapDatabaseOperation(() =>
      this.bankAccountModel.createDeposit(tenantId, bankAccountId, {
        ...validatedData,
        date: validatedData.date instanceof Date ? validatedData.date : new Date(validatedData.date)
      })
    );

    res.json({ message: 'Deposit recorded successfully' });
  }

  async withdrawal(req: AuthenticatedRequest, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;

    const bankAccountId = this.sanitizeAndValidateUUID(req.params.id, 'Bank Account ID');
    const validatedData = this.validateZodSchema(insertBankWithdrawalSchema, req.body);

    // Verify bank account exists
    const bankAccount = await this.wrapDatabaseOperation(() =>
      this.bankAccountModel.getBankAccountById(tenantId, bankAccountId)
    );
    this.ensureResourceExists(bankAccount, 'Bank Account');

    await this.wrapDatabaseOperation(() =>
      this.bankAccountModel.createWithdrawal(tenantId, bankAccountId, {
        ...validatedData,
        date: validatedData.date instanceof Date ? validatedData.date : new Date(validatedData.date)
      })
    );

    res.json({ message: 'Withdrawal recorded successfully' });
  }

  /**
   * Delete a manually created bank deposit or withdrawal transaction.
   * Only allows deletion if referenceType is 'Bank Deposit' or 'Bank Withdrawal' and referenceId is null.
   * Also reverses associated cashbook entry for cash deposits.
   */
  async deleteTransaction(req: AuthenticatedRequest, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;

    // Extract and validate params
    const bankAccountId = this.sanitizeAndValidateUUID(req.params.id, 'Bank Account ID');
    const transactionId = this.sanitizeAndValidateUUID(req.params.transactionId, 'Transaction ID');

    // Verify bank account exists
    const bankAccount = await this.wrapDatabaseOperation(() =>
      this.bankAccountModel.getBankAccountById(tenantId, bankAccountId)
    );
    this.ensureResourceExists(bankAccount, 'Bank Account');

    // Delete the manual transaction (and reverse cashbook if needed)
    await this.wrapDatabaseOperation(() =>
      this.bankAccountModel.deleteManualTransaction(tenantId, bankAccountId, transactionId)
    );

    res.json({ message: 'Transaction deleted successfully' });
  }
}