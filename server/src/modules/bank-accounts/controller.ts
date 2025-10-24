import { Request, Response } from 'express';
import { BaseController } from '../../utils/base';
import { BankAccountModel } from './model';
import { ForbiddenError, BadRequestError, NotFoundError } from '../../types/index';
import schema from '../../../shared/schema.js';

const { insertBankAccountSchema, updateBankAccountSchema, insertBankDepositSchema, insertBankWithdrawalSchema } = schema;

export class BankAccountController extends BaseController {
  private bankAccountModel: BankAccountModel;

  constructor() {
    super();
    this.bankAccountModel = new BankAccountModel();
  }

  async getAll(req: Request, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;

    const isPaginated = req.query.page || req.query.limit || req.query.paginated === 'true';

    if (!isPaginated) {
      const bankAccounts = await this.bankAccountModel.getBankAccounts(tenantId);
      return res.json(bankAccounts);
    }

    const opts = {
      ...this.getPaginationOptions(req.query),
      status: req.query.status as string,
      search: req.query.search as string
    };

    const page = opts.page || 1;
    const limit = opts.limit || 10;

    if (page < 1) throw new BadRequestError("Page must be >= 1");
    if (limit < 1 || limit > 100) throw new BadRequestError("Limit must be between 1 and 100");

    const validSortFields = ['name', 'accountNumber', 'bankName', 'balance', 'createdAt'];
    if (opts.sortBy && !validSortFields.includes(opts.sortBy)) throw new BadRequestError("Invalid sortBy field");

    const result = await BankAccountModel.getBankAccountsPaginated(tenantId, opts);
    this.sendPaginatedResponse(res, result.data, result.pagination);
  }

  async getById(req: Request, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;

    const bankAccount = await this.bankAccountModel.getBankAccountById(tenantId, req.params.id);
    this.ensureResourceExists(bankAccount, "Bank Account");

    res.json(bankAccount);
  }

  async create(req: Request, res: Response) {
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

  async update(req: Request, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;

    const validatedData = this.validateZodSchema(updateBankAccountSchema.partial(), { ...req.body, tenantId });

    const bankAccount = await this.bankAccountModel.updateBankAccount(tenantId, req.params.id, validatedData);
    this.ensureResourceExists(bankAccount, "Bank Account");

    res.json(bankAccount);
  }

  async delete(req: Request, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;

    const result = await this.wrapDatabaseOperation(() =>
      this.bankAccountModel.deleteBankAccount(tenantId, req.params.id)
    );

    if (!result) throw new NotFoundError("Bank Account");

    res.json({ message: "Bank account deleted successfully" });
  }

  async deposit(req: Request, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;

    const bankAccountId = this.sanitizeAndValidateUUID(req.params.id, 'Bank Account ID');
    const validatedData = this.validateZodSchema(insertBankDepositSchema, req.body);

    const bankAccount = await this.wrapDatabaseOperation(() =>
      this.bankAccountModel.getBankAccountById(tenantId, bankAccountId)
    );
    this.ensureResourceExists(bankAccount, 'Bank Account');

    // Ensure required fields exist
    const depositData = {
      amount: validatedData.amount!,
      description: validatedData.description || '',
      source: validatedData.source || 'cash',
      date: validatedData.date instanceof Date ? validatedData.date : new Date(validatedData.date)
    };

    await this.wrapDatabaseOperation(() =>
      this.bankAccountModel.createDeposit(tenantId, bankAccountId, depositData)
    );

    res.json({ message: 'Deposit recorded successfully' });
  }

  async withdrawal(req: Request, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;

    const bankAccountId = this.sanitizeAndValidateUUID(req.params.id, 'Bank Account ID');
    const validatedData = this.validateZodSchema(insertBankWithdrawalSchema, req.body);

    const bankAccount = await this.wrapDatabaseOperation(() =>
      this.bankAccountModel.getBankAccountById(tenantId, bankAccountId)
    );
    this.ensureResourceExists(bankAccount, 'Bank Account');

    // Ensure required fields exist
    const withdrawalData = {
      amount: validatedData.amount!,
      description: validatedData.description || '',
      date: validatedData.date instanceof Date ? validatedData.date : new Date(validatedData.date)
    };

    await this.wrapDatabaseOperation(() =>
      this.bankAccountModel.createWithdrawal(tenantId, bankAccountId, withdrawalData)
    );

    res.json({ message: 'Withdrawal recorded successfully' });
  }

  async deleteTransaction(req: Request, res: Response) {
    if (!req.tenantId) throw new ForbiddenError('No tenant context found');
    const tenantId = req.tenantId;

    const bankAccountId = this.sanitizeAndValidateUUID(req.params.id, 'Bank Account ID');
    const transactionId = this.sanitizeAndValidateUUID(req.params.transactionId, 'Transaction ID');

    const bankAccount = await this.wrapDatabaseOperation(() =>
      this.bankAccountModel.getBankAccountById(tenantId, bankAccountId)
    );
    this.ensureResourceExists(bankAccount, 'Bank Account');

    await this.wrapDatabaseOperation(() =>
      this.bankAccountModel.deleteManualTransaction(tenantId, bankAccountId, transactionId)
    );

    res.json({ message: 'Transaction deleted successfully' });
  }
}
